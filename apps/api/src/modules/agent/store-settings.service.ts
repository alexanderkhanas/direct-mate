import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { DEFAULT_CHECKOUT_FIELDS } from '../orders/order-draft.service';
import { NumericSizeChart, parseNumericSizeChart } from '../size-charts/recommend-size';

/** Everything store-specific the agent reads, already validated. */
export interface AgentStoreSettings {
  tenantName: string;
  timezone: string;
  knowledgeDoc: string | null;
  brandTone: string | null;
  managerExamples: Array<{ customer: string; manager: string }>;
  /** Rendered "label: value" lines; stores have saved more than one shape here. */
  businessHours: string[];
  welcomeLine: string | null;
  disallowedPhrases: string[];
  checkoutFields: string[];
  paymentDetails: string | null;
  handoffAnnounce: string | null;
  sizeChart: NumericSizeChart | null;
  sizing: SizingSettings;
  conversationIdleHours: number;
  modelOverride: string | null;
  operatingMode: 'learning' | 'active' | 'paused';
}

/**
 * How the store wants size questions handled (`flow_config.sizing`).
 *
 * - `recommend` (default): the agent recommends a size from the store's
 *   ranges and offers a manager's check for anyone who wants to be sure.
 * - `consult`: sizes need a person (custom or unusual sizing). The agent
 *   collects measurements and hands off; it has no size tool to guess with.
 *
 * `askMeasurementsFirst`: ask height and weight before suggesting clothes
 * (the old engine's `before_search`).
 */
export interface SizingSettings {
  advice: 'recommend' | 'consult';
  askMeasurementsFirst: boolean;
}

const MAX_MANAGER_EXAMPLES = 8;
const DEFAULT_IDLE_HOURS = 24;

// Owners edit these, so every key is optional and a malformed value is dropped
// (`.catch`) instead of failing the turn.
const text = z.string().trim().min(1).optional().catch(undefined);
const brandSchema = z.object({
  welcomeLine: text,
  disallowedPhrases: z.array(z.string().min(1)).optional().catch(undefined),
});
const checkoutSchema = z.object({
  fields: z.array(z.string().min(1)).min(1).optional().catch(undefined),
  paymentDetails: text,
});
const handoffSchema = z.object({ announceText: text });
const sizingSchema = z.object({
  advice: z.enum(['recommend', 'consult']).optional().catch(undefined),
  askMeasurementsFirst: z.boolean().optional().catch(undefined),
});
const flowSchema = z.object({
  sizeChart: z.unknown().optional(),
  sizing: sizingSchema.optional().catch(undefined),
  conversationIdleHours: z.number().positive().optional().catch(undefined),
});

/** `flow_config.sizing` with defaults; a malformed value falls back to the default. */
export function parseSizing(raw: unknown): SizingSettings {
  const parsed = sizingSchema.safeParse(raw ?? {});
  const sizing = parsed.success ? parsed.data : {};
  return { advice: sizing.advice ?? 'recommend', askMeasurementsFirst: sizing.askMeasurementsFirst ?? false };
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw ?? {});
  return result.success ? result.data : schema.parse({});
}

function renderBusinessHours(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const hours = raw as Record<string, unknown>;
  // Typed shape: { timezone, days: [1..7], start, end }.
  if (Array.isArray(hours.days) && typeof hours.start === 'string' && typeof hours.end === 'string') {
    return [`days ${hours.days.join(', ')}: ${hours.start}–${hours.end}`];
  }
  // Seeded shape: { mon_fri: '09:00-18:00', sat: ..., sun: 'closed' }.
  return Object.entries(hours)
    .filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => `${k}: ${v}`);
}

@Injectable()
export class AgentStoreSettingsService {
  private readonly logger = new Logger(AgentStoreSettingsService.name);

  constructor(
    @InjectRepository(StoreConfig) private readonly storeConfigs: Repository<StoreConfig>,
    @InjectRepository(TenantSettings) private readonly tenantSettings: Repository<TenantSettings>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(ManagerExample) private readonly managerExamples: Repository<ManagerExample>,
  ) {}

  async load(tenantId: string): Promise<AgentStoreSettings> {
    const [tenant, config, settings, examples] = await Promise.all([
      this.tenants.findOne({ where: { id: tenantId } }),
      this.storeConfigs.findOne({ where: { tenantId } }),
      this.tenantSettings.findOne({ where: { tenantId } }),
      this.managerExamples.find({
        where: { tenantId, isActive: true },
        order: { createdAt: 'DESC' },
        take: MAX_MANAGER_EXAMPLES,
      }),
    ]);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    if (!config) this.logger.warn(`Tenant ${tenant.slug} has no store_config; using defaults`);

    const brand = parse(brandSchema, config?.brandConfig);
    const checkout = parse(checkoutSchema, config?.checkoutConfig);
    const handoff = parse(handoffSchema, config?.handoffConfig);
    const flow = parse(flowSchema, config?.flowConfig);

    return {
      tenantName: tenant.name,
      timezone: tenant.timezone || 'Europe/Kyiv',
      knowledgeDoc: config?.knowledgeDoc?.trim() || null,
      brandTone: settings?.brandTonePrompt?.trim() || null,
      managerExamples: examples
        .filter((e) => e.customerMessage?.trim() && e.managerReply?.trim())
        .map((e) => ({ customer: e.customerMessage.trim(), manager: e.managerReply.trim() })),
      businessHours: renderBusinessHours(settings?.businessHours),
      welcomeLine: brand.welcomeLine ?? null,
      disallowedPhrases: brand.disallowedPhrases ?? [],
      checkoutFields: checkout.fields ?? DEFAULT_CHECKOUT_FIELDS,
      paymentDetails: checkout.paymentDetails ?? null,
      handoffAnnounce: handoff.announceText ?? null,
      sizeChart: parseNumericSizeChart(flow.sizeChart),
      sizing: parseSizing(flow.sizing),
      conversationIdleHours: flow.conversationIdleHours ?? DEFAULT_IDLE_HOURS,
      modelOverride: settings?.aiSettings?.model?.trim() || null,
      operatingMode: config?.operatingMode ?? 'active',
    };
  }
}
