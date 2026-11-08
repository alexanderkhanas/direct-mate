import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SizeChartReaderService, toTable, type ChartReading } from './size-chart-reader.service';
import type { SizeChart } from './size-chart.entity';

const USAGE = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 200, text: 200, reasoning: 0 },
};
const answer = (reading: ChartReading) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(reading) }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});

const DRESS_READING: ChartReading = {
  isSizeChart: true,
  measurements: [
    { key: 'chest', label: 'Обхват грудей', unit: 'cm' },
    { key: 'waist', label: 'Обхват талії', unit: 'cm' },
    { key: 'hips', label: 'Обхват стегон', unit: 'cm' },
  ],
  rows: [
    {
      size: 'S',
      cells: [
        { key: 'chest', min: 84, max: 88, uncertain: false },
        { key: 'waist', min: 66, max: 70, uncertain: false },
        { key: 'hips', min: 90, max: 94, uncertain: false },
      ],
    },
    {
      size: 'L',
      cells: [
        { key: 'chest', min: 92, max: 96, uncertain: false },
        { key: 'waist', min: 74, max: 78, uncertain: false },
        { key: 'hips', min: 98, max: 102, uncertain: true },
      ],
    },
  ],
};

describe('SizeChartReaderService', () => {
  let cwd: string;
  let dir: string;

  beforeAll(async () => {
    cwd = process.cwd();
    dir = await mkdtemp(join(tmpdir(), 'size-chart-'));
    process.chdir(dir);
    // Charts are read from `<cwd>/uploads`; one also sits outside it.
    await mkdir(join(dir, 'uploads'));
    await writeFile(join(dir, 'uploads', 'chart.png'), 'not really a png');
    await writeFile(join(dir, 'chart.png'), 'not really a png');
  });
  afterAll(async () => {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  });

  function setup(model: MockLanguageModelV4, imagePath = 'uploads/chart.png') {
    const chart = { id: 'c1', tenantId: 't1', imagePath, table: null, status: 'image' } as unknown as SizeChart;
    const repo = {
      findOne: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.id === 'c1' && where.tenantId === 't1' ? chart : null,
      ),
      save: jest.fn(async (c: SizeChart) => c),
    };
    const service = new SizeChartReaderService(repo as never, { get: (key: string) => (key === 'sizeCharts.reasoningEffort' ? 'low' : undefined) } as never);
    jest.spyOn(service as unknown as { model: () => unknown }, 'model').mockReturnValue(model);
    return { service, repo };
  }

  it('reads the image into a draft table, keeping the cells it was unsure of', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer(DRESS_READING)] });
    const { service, repo } = setup(model);

    const saved = await service.read('t1', 'c1', ['S', 'M', 'L']);

    expect(saved.status).toBe('draft');
    expect(saved.table).toEqual({
      measurements: DRESS_READING.measurements,
      rows: [
        { size: 'S', values: { chest: { min: 84, max: 88 }, waist: { min: 66, max: 70 }, hips: { min: 90, max: 94 } } },
        { size: 'L', values: { chest: { min: 92, max: 96 }, waist: { min: 74, max: 78 }, hips: { min: 98, max: 102 } } },
      ],
      uncertain: [{ size: 'L', key: 'hips' }],
    });
    expect(repo.save).toHaveBeenCalledTimes(1);

    // The model got the picture from disk and the shop's sizes.
    const prompt = model.doGenerateCalls[0].prompt;
    const user = prompt.find((m) => m.role === 'user')!;
    expect(JSON.stringify(user.content)).toContain('S, M, L');
    expect((user.content as Array<{ type: string }>).some((part) => part.type === 'file')).toBe(true);
    // A stalled read is cut off, and the reasoning effort is pinned.
    expect(model.doGenerateCalls[0].abortSignal).toBeInstanceOf(AbortSignal);
    expect(model.doGenerateCalls[0].providerOptions).toEqual({ openai: { reasoningEffort: 'low' } });
  });

  it('refuses an image that is not a size chart', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [answer({ isSizeChart: false, measurements: [], rows: [] })] });
    const { service, repo } = setup(model);
    await expect(service.read('t1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('reports a failed model call as unavailable, without saving', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('rate limited');
      },
    });
    const { service, repo } = setup(model);
    await expect(service.read('t1', 'c1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses an image outside uploads/ or missing from disk', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [] });
    await expect(setup(model, '../chart.png').service.read('t1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(model, 'uploads/gone.png').service.read('t1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('toTable', () => {
  it('converts inches and pounds in code, and keeps one of each measurement and size', () => {
    const table = toTable({
      isSizeChart: true,
      measurements: [
        { key: 'chest', label: 'Груди', unit: 'in' },
        { key: 'weight', label: '', unit: 'lb' },
        { key: 'chest', label: 'Груди (см)', unit: 'cm' },
      ],
      rows: [
        {
          size: ' M ',
          cells: [
            { key: 'chest', min: 36, max: 34, uncertain: false },
            { key: 'weight', min: 132, max: 132, uncertain: false },
            { key: 'hips', min: 90, max: 94, uncertain: false },
          ],
        },
        { size: 'm', cells: [{ key: 'chest', min: 1, max: 2, uncertain: false }] },
      ],
    });
    expect(table).toEqual({
      measurements: [
        { key: 'chest', label: 'Груди', unit: 'cm' },
        { key: 'weight', label: 'Вага', unit: 'kg' },
      ],
      // 34–36 in → 86.5–91.5 cm; 132 lb → 60 kg. Hips isn't a listed column.
      rows: [{ size: 'M', values: { chest: { min: 86.5, max: 91.5 }, weight: { min: 60, max: 60 } } }],
      uncertain: [],
    });
  });

  it('reads millimetres as centimetres', () => {
    const table = toTable({
      isSizeChart: true,
      measurements: [{ key: 'foot', label: 'Довжина стопи', unit: 'mm' }],
      rows: [{ size: '38', cells: [{ key: 'foot', min: 245, max: 245, uncertain: false }] }],
    });
    expect(table?.rows[0].values.foot).toEqual({ min: 24.5, max: 24.5 });
    expect(table?.measurements[0].unit).toBe('cm');
  });

  it('returns null when nothing usable was read', () => {
    expect(toTable({ isSizeChart: true, measurements: [{ key: 'chest', label: 'Груди', unit: 'cm' }], rows: [] })).toBeNull();
    expect(toTable({ ...DRESS_READING, isSizeChart: false })).toBeNull();
  });
});
