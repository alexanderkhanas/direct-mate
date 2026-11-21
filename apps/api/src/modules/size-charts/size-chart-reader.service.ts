import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { extname, join, resolve, sep } from 'path';
import { SizeChart } from './size-chart.entity';
import { MEASUREMENT_KEYS, type ChartMeasurement, type ChartRow, type SizeChartTable } from './size-chart-table';
import { DEFAULT_LABELS } from './table-schema';

const INSTRUCTIONS = `You read a clothing or footwear size chart from an image, for a shop's assistant that recommends a size from a customer's body measurements.

- isSizeChart: false when the image is not a size chart; then return empty lists.
- rows: one per size, in the order printed. size: the size label exactly as printed («S», «42», «W30»). A bra chart (underbust bands × cups) is one row per band and cup, labelled band then cup («75B»), band by band, cups in order; skip combinations the chart leaves empty. When the chart has several size systems side by side (letters and numbers), label rows in the system the shop's products use (listed below, when known); otherwise the first size column.
- measurements: the body measurements the chart gives, in column order, each mapped to one key:
  chest = chest or bust (груди, обхват грудей; on a bra chart the bust over the cup, «по чашці»); underbust = underbust (під грудьми, обхват під грудьми), on bra charts; waist = waist (талія); hips = hips (стегна, обхват стегон); height = body height (зріст); weight = body weight (вага); inseam = inside leg length (довжина по внутрішньому шву); foot = foot length (довжина стопи, устілка); other = one more body measurement that matters for fit (neck, shoulders), at most one.
  Leave out measurements of the garment itself (length of the item, sleeve length) and columns that only convert between size systems.
- label: the measurement's name in Ukrainian, as a customer would understand it: «Обхват грудей», «Обхват талії», «Обхват стегон», «Зріст», «Вага», «Довжина по внутрішньому шву», «Довжина стопи».
- unit: as printed: cm, mm, in, kg or lb. When the chart gives both centimetres and inches, read only the centimetres.
- cells: for every measurement the row has a value for. A range «84–88» or «84-88» is min 84, max 88; a single value «84» is min 84, max 84. Leave out cells that are empty on the chart.
- uncertain: true when you can't read a cell with confidence (blurred, cut off, digits that could be read two ways). Give your best reading and mark it. Never guess silently.`;

const readSchema = z.object({
  isSizeChart: z.boolean(),
  measurements: z.array(z.object({ key: z.enum(MEASUREMENT_KEYS), label: z.string(), unit: z.enum(['cm', 'mm', 'in', 'kg', 'lb']) })),
  rows: z.array(
    z.object({
      size: z.string(),
      cells: z.array(z.object({ key: z.enum(MEASUREMENT_KEYS), min: z.number(), max: z.number(), uncertain: z.boolean() })),
    }),
  ),
});
export type ChartReading = z.infer<typeof readSchema>;

const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** To cm (weight to kg). A foot length printed «245» in mm is 24.5 cm. */
const FACTOR: Record<ChartReading['measurements'][number]['unit'], number> = { cm: 1, kg: 1, mm: 0.1, in: 2.54, lb: 0.4536 };
/** A read that takes longer has stalled; the owner can try again. */
const READ_TIMEOUT_MS = 45_000;

/** Converted values are rounded to half a unit, as charts print them. */
const half = (n: number) => Math.round(n * 2) / 2;

/**
 * The model's reading → a table in cm and kg: units converted in code (not
 * by the model), a measurement only once, cells only for listed
 * measurements, ranges the right way round. Null when nothing usable is left.
 */
export function toTable(reading: ChartReading): SizeChartTable | null {
  if (!reading.isSizeChart) return null;

  const factor = new Map<string, number>();
  const measurements: ChartMeasurement[] = [];
  for (const m of reading.measurements) {
    if (measurements.some((x) => x.key === m.key)) continue;
    const isWeight = m.key === 'weight';
    factor.set(m.key, FACTOR[m.unit]);
    measurements.push({ key: m.key, label: m.label.trim() || DEFAULT_LABELS[m.key], unit: isWeight ? 'kg' : 'cm' });
  }

  const rows: ChartRow[] = [];
  const uncertain: SizeChartTable['uncertain'] = [];
  for (const r of reading.rows) {
    const size = r.size.trim();
    if (!size || rows.some((x) => x.size.toUpperCase() === size.toUpperCase())) continue;
    const row: ChartRow = { size, values: {} };
    for (const cell of r.cells) {
      const f = factor.get(cell.key);
      if (f === undefined || row.values[cell.key]) continue;
      const [a, b] = [cell.min, cell.max].map((v) => (f === 1 ? v : half(v * f)));
      if (!(a > 0 && b > 0)) continue;
      row.values[cell.key] = { min: Math.min(a, b), max: Math.max(a, b) };
      if (cell.uncertain) uncertain.push({ size, key: cell.key });
    }
    rows.push(row);
  }

  const used = measurements.filter((m) => rows.some((r) => r.values[m.key]));
  if (used.length === 0 || rows.length === 0) return null;
  return { measurements: used, rows, uncertain };
}

/**
 * Reads a size chart's image into a table with a vision model (POST
 * /size-charts/:id/read). The result is a `draft`: the owner checks the
 * cells, uncertain ones first, before the bot uses it.
 */
@Injectable()
export class SizeChartReaderService {
  private readonly logger = new Logger(SizeChartReaderService.name);
  private openai: OpenAIProvider | null = null;

  constructor(
    @InjectRepository(SizeChart)
    private readonly repo: Repository<SizeChart>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Read the chart and store the table as a draft. `productSizes` are the
   * sizes of the products in the chart's scope, so the model labels rows in
   * the shop's own size system.
   */
  async read(tenantId: string, id: string, productSizes: string[] = []): Promise<SizeChart> {
    const chart = await this.repo.findOne({ where: { id, tenantId } });
    if (!chart) throw new NotFoundException('Size chart not found');

    const image = chart.imagePath ? await this.imagePart(chart.imagePath) : null;
    if (!image) {
      throw new BadRequestException({ message: 'The chart image is missing; upload it again.', details: { reason: 'image_missing' } });
    }

    let reading: ChartReading;
    try {
      reading = await this.callModel(image, productSizes);
    } catch (err) {
      this.logger.warn(`Reading size chart ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new ServiceUnavailableException({ message: 'The chart could not be read. Try again.', details: { reason: 'read_failed' } });
    }

    const table = toTable(reading);
    if (!table) {
      throw new BadRequestException({ message: 'No sizes and measurements found on this image.', details: { reason: 'not_a_chart' } });
    }
    chart.table = table;
    chart.status = 'draft';
    return this.repo.save(chart);
  }

  private async callModel(image: { type: 'file'; data: URL | Uint8Array; mediaType: string }, productSizes: string[]): Promise<ChartReading> {
    const sizes = productSizes.length > 0 ? `The shop's products for this chart come in sizes: ${productSizes.join(', ')}.` : 'Read the chart.';
    const effort = this.config.get<string>('sizeCharts.reasoningEffort');
    const result = await generateText({
      model: this.model(),
      instructions: INSTRUCTIONS,
      output: Output.object({ schema: readSchema, name: 'size_chart' }),
      messages: [{ role: 'user', content: [{ type: 'text', text: sizes }, image] }],
      ...(effort && { providerOptions: { openai: { reasoningEffort: effort } } }),
      abortSignal: AbortSignal.timeout(READ_TIMEOUT_MS),
      maxRetries: 2,
    });
    if (!result.output) throw new Error('The model returned no table');
    return result.output;
  }

  /** The vision model: `SIZE_CHART_MODEL`, else the attributes model. */
  protected model(): LanguageModel {
    if (!this.openai) {
      const apiKey = this.config.get<string>('openai.apiKey');
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
      this.openai = createOpenAI({ apiKey });
    }
    return this.openai(this.config.get<string>('sizeCharts.model') ?? 'gpt-6.1-terra');
  }

  /** Uploaded charts are read from disk (`uploads/…`, not reachable by the model); a remote image goes as its URL. */
  private async imagePart(imagePath: string): Promise<{ type: 'file'; data: URL | Uint8Array; mediaType: string } | null> {
    if (/^https?:\/\//i.test(imagePath)) {
      const ext = extname(new URL(imagePath).pathname).toLowerCase();
      return { type: 'file', data: new URL(imagePath), mediaType: MEDIA_TYPES[ext] ?? 'image/jpeg' };
    }
    const root = resolve(process.cwd(), 'uploads');
    const file = resolve(join(process.cwd(), imagePath.replace(/^\//, '')));
    if (!file.startsWith(root + sep)) return null;
    try {
      const bytes = await readFile(file);
      return { type: 'file', data: new Uint8Array(bytes), mediaType: MEDIA_TYPES[extname(file).toLowerCase()] ?? 'image/jpeg' };
    } catch {
      return null;
    }
  }
}
