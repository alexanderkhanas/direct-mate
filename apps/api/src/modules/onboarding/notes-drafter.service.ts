import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { generateText, isStepCount, Output, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { AgentModelFactory } from '../agent/model.factory';
import { readWebsite, type WebsitePage } from './website-reader';
import type { HistoryFact, HistoryFactSection } from './history/history-import.types';
import {
  CHECKOUT_FIELDS,
  emptyDraft,
  KEY_SECTIONS,
  NOTE_SECTIONS,
  renderKnowledgeDoc,
  SECTION_TITLE,
  WEEK_DAYS,
  type NotesDraft,
} from './store-notes';

const DRAFT_INSTRUCTIONS = `You prepare the store notes an AI sales assistant answers customers from, for a small Ukrainian shop that sells on Instagram. The sources are the shop's own website pages, text the owner pasted (what they already send customers), and facts its managers told customers in Instagram chats; nothing else.

Rules:
- Use only what the sources state. Never invent carriers, timings, prices, conditions, bank details or hours. If a source is vague, write what it says and add a question.
- Chat facts come with how many conversations said them: one said more often is more likely true today. When chat facts disagree, write the more frequent one and ask the owner about the difference.
- Write each section in Ukrainian as 2–6 short bullet lines ("- …"): plain facts a manager would tell a customer, no marketing.
- delivery: carriers (Нова Пошта, Укрпошта…), how fast orders ship, who pays for delivery, any free-delivery threshold.
- payment: ways to pay (накладений платіж, передоплата на картку, оплата онлайн), whether prepayment is required.
- returns: the exchange and return period and conditions.
- sizes: how sizing works, only if the sources say something.
- contacts: phone, email, the address of a physical shop, if given.
- other: anything else customers often ask that the sources answer.
- Leave a section null when the sources say nothing about it.
- paymentDetails: the exact bank details for card prepayment (recipient, IBAN or card number) only when a source states them; otherwise null.
- checkoutFields: fullName, phone, city, novaPoshtaBranch unless the shop clearly doesn't ship by Nova Poshta; add paymentMethod when the shop offers more than one way to pay.
- businessHours: when managers answer, per day, only if stated (the chats' working-hours facts count).
- sizingAdvice: "recommend" for a clothing shop with standard sizes, otherwise null.
- questions: up to 6 short questions in Ukrainian, to the owner, about what customers will ask that the sources don't answer — who pays for delivery, how fast orders ship, prepayment, the return period, bank details when card prepayment is offered without them, working hours. Plain and specific.`;

const draftSchema = z.object({
  delivery: z.string().nullable(),
  payment: z.string().nullable(),
  returns: z.string().nullable(),
  sizes: z.string().nullable(),
  contacts: z.string().nullable(),
  other: z.string().nullable(),
  paymentDetails: z.string().nullable(),
  checkoutFields: z.array(z.enum(CHECKOUT_FIELDS)),
  businessHours: z.array(z.object({ day: z.enum(WEEK_DAYS), hours: z.string().describe('"09:00-18:00" or "closed"') })).nullable(),
  sizingAdvice: z.enum(['recommend', 'consult']).nullable(),
  questions: z.array(z.string()).max(8),
});

const interviewInstructions = (shop: string, draft: NotesDraft) => `You help the owner of «${shop}» finish the notes their AI sales assistant answers customers from.

- Write in Ukrainian, warmly and briefly. Ask at most two questions per message, the most important unknowns first (delivery and payment before anything else).
- You have no gender. Never use gendered past-tense forms about yourself (not «записала» / «записав», «зрозуміла» / «зрозумів»); use impersonal forms: «Записано», «Додано в «Доставку»», «Зрозуміло».
- When the owner tells you something, record it straight away with the tools: update_section with the whole new text of that section (keep what was already right), set_payment_details with the exact details they give, set_business_hours, set_checkout_fields, set_sizing. Then ask the next question.
- Never write anything the owner didn't say. Don't ask about what the notes already cover.
- Ask about every section listed under «Sections still empty» before you call finish. If the owner says there's nothing for one (no phone or shop address, no returns), record exactly that in the section, e.g. «- Зв'язок лише через Direct в Instagram.», so it isn't empty any more.
- When nothing important is left, call finish and tell the owner to check the draft and press «Зберегти і далі».

## Current notes
${renderKnowledgeDoc(draft) || '(empty)'}

Payment details for card prepayment: ${draft.paymentDetails ?? '(none)'}
Asked at checkout: ${draft.checkoutFields.join(', ')}
Working hours: ${draft.businessHours ? Object.entries(draft.businessHours).map(([d, h]) => `${d} ${h}`).join(', ') : '(unknown)'}

## Sections still empty
${emptyKeySections(draft).map((s) => `- ${SECTION_TITLE[s]}`).join('\n') || '(none)'}

## Still unknown
${draft.questions.length > 0 ? draft.questions.map((q) => `- ${q}`).join('\n') : '(nothing listed)'}`;

/** The key sections (the chips the owner sees) with nothing in them yet. */
function emptyKeySections(draft: NotesDraft) {
  return KEY_SECTIONS.filter((s) => !draft.sections[s]?.trim());
}

export interface InterviewMessage {
  role: 'owner' | 'assistant';
  text: string;
}

/**
 * Store notes for setup: a first draft written from the store's website (and,
 * once the Instagram history import has run, what its managers wrote in
 * chats), then a short chat that asks the owner only what is still missing.
 * Drafts live in `tenant_onboarding` until the owner saves them.
 */
@Injectable()
export class NotesDrafterService {
  private readonly logger = new Logger(NotesDrafterService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly models: AgentModelFactory,
  ) {}

  async get(tenantId: string): Promise<{ draft: NotesDraft | null; messages: InterviewMessage[]; websiteUrl: string | null }> {
    const [row]: Array<{ notes_draft: NotesDraft | null; interview: { messages?: InterviewMessage[] } | null; feed_url: string | null }> =
      await this.dataSource.query(
        `SELECT o.notes_draft, o.interview,
                (SELECT metadata->>'url' FROM connections WHERE tenant_id = $1 AND type = 'product_feed' LIMIT 1) AS feed_url
           FROM tenant_onboarding o WHERE o.tenant_id = $1`,
        [tenantId],
      );
    return {
      draft: row?.notes_draft ?? null,
      messages: row?.interview?.messages ?? [],
      websiteUrl: websiteFromFeed(row?.feed_url ?? null),
    };
  }

  /**
   * Draft the notes from what the owner gave (their website, or text they
   * already send customers; neither for the short interview) plus the terms
   * the Instagram history import found in their chats, and open the chat with
   * the questions left.
   */
  async draft(
    tenantId: string,
    source: { websiteUrl?: string | null; text?: string | null },
  ): Promise<{ draft: NotesDraft; messages: InterviewMessage[] }> {
    const pages = source.websiteUrl ? await readWebsite(source.websiteUrl).catch(() => [] as WebsitePage[]) : [];
    const pasted = source.text?.trim().slice(0, 8000) || null;
    const facts = await this.historyFacts(tenantId);
    const shop = await this.shop(tenantId);

    let draft = emptyDraft();
    if (pages.length > 0 || pasted || facts.length > 0) {
      const sources = [
        ...pages.map((p) => `## Page: ${p.url}\n${p.text}`),
        ...(pasted ? [`## Text the shop already sends customers\n${pasted}`] : []),
        ...(facts.length > 0 ? [renderFacts(facts)] : []),
      ].join('\n\n');
      const resolved = this.models.resolve({});
      const result = await generateText({
        model: resolved.model,
        instructions: DRAFT_INSTRUCTIONS,
        output: Output.object({ schema: draftSchema, name: 'store_notes' }),
        messages: [{ role: 'user', content: `Shop: ${shop.name}. Sells: ${shop.businessType}.\n\n${sources}` }],
        providerOptions: resolved.providerOptions,
        maxRetries: 2,
      });
      if (result.output) draft = fromModel(result.output, pages.map((p) => p.url));
    } else {
      draft.questions = DEFAULT_QUESTIONS;
      draft.sizingAdvice = shop.businessType === 'fashion' ? 'recommend' : null;
    }

    const from = pages.length > 0 ? 'website' : pasted ? 'text' : facts.length > 0 ? 'history' : null;
    // Nothing was drafted because the site couldn't be read (not because the draft came from chat history).
    const unreadSite = !!source.websiteUrl && pages.length === 0 && !pasted && facts.length === 0;
    const messages: InterviewMessage[] = [{ role: 'assistant', text: opening(draft, from, unreadSite) }];
    await this.save(tenantId, draft, messages);
    return { draft, messages };
  }

  /** One owner message: record what they said in the draft and ask the next question. */
  async chat(tenantId: string, message: string): Promise<{ reply: string; draft: NotesDraft; messages: InterviewMessage[]; finished: boolean }> {
    const current = await this.get(tenantId);
    const draft: NotesDraft = current.draft ?? { ...emptyDraft(), questions: DEFAULT_QUESTIONS };
    const shop = await this.shop(tenantId);
    let finished = false;

    const tools = {
      update_section: tool({
        description: 'Replace one section of the notes with its full new text (bullet lines in Ukrainian).',
        inputSchema: z.object({ section: z.enum(NOTE_SECTIONS), text: z.string().max(2000) }),
        execute: async ({ section, text }) => {
          draft.sections[section] = text.trim() || undefined;
          return { ok: true };
        },
      }),
      set_payment_details: tool({
        description: 'Save the exact bank details for card prepayment the owner gave (or null to remove them).',
        inputSchema: z.object({ details: z.string().max(1000).nullable() }),
        execute: async ({ details }) => {
          draft.paymentDetails = details?.trim() || null;
          return { ok: true };
        },
      }),
      set_business_hours: tool({
        description: "Save the managers' working hours, per day.",
        inputSchema: z.object({ hours: z.array(z.object({ day: z.enum(WEEK_DAYS), hours: z.string() })) }),
        execute: async ({ hours }) => {
          draft.businessHours = Object.fromEntries(hours.map((h) => [h.day, h.hours]));
          return { ok: true };
        },
      }),
      set_checkout_fields: tool({
        description: 'Which details to ask the customer before placing an order.',
        inputSchema: z.object({ fields: z.array(z.enum(CHECKOUT_FIELDS)).min(1) }),
        execute: async ({ fields }) => {
          draft.checkoutFields = fields;
          return { ok: true };
        },
      }),
      set_sizing: tool({
        description: 'recommend = the bot recommends a size from height and weight; consult = a manager advises.',
        inputSchema: z.object({ advice: z.enum(['recommend', 'consult']) }),
        execute: async ({ advice }) => {
          draft.sizingAdvice = advice;
          return { ok: true };
        },
      }),
      finish: tool({
        description: 'Nothing important is left to ask.',
        inputSchema: z.object({}),
        execute: async () => {
          finished = true;
          draft.questions = [];
          return { ok: true };
        },
      }),
    };

    const history: ModelMessage[] = [...current.messages, { role: 'owner' as const, text: message }].map((m) =>
      m.role === 'owner' ? { role: 'user' as const, content: m.text } : { role: 'assistant' as const, content: m.text },
    );
    const resolved = this.models.resolve({});
    const result = await generateText({
      model: resolved.model,
      instructions: interviewInstructions(shop.name, draft),
      messages: history,
      tools,
      stopWhen: isStepCount(5),
      providerOptions: resolved.providerOptions,
      maxRetries: 2,
    });
    const reply = result.text.trim() || 'Записано. Перевірте чернетку й натисніть «Зберегти і далі».';
    const messages: InterviewMessage[] = [...current.messages, { role: 'owner', text: message }, { role: 'assistant', text: reply }];
    await this.save(tenantId, draft, messages);
    return { reply, draft, messages, finished };
  }

  /** The owner's edits to the draft, kept until they save. */
  async update(tenantId: string, draft: NotesDraft): Promise<void> {
    const current = await this.get(tenantId);
    await this.save(tenantId, draft, current.messages);
  }

  /** Write the notes and the settings they decide into the store. */
  async apply(tenantId: string, draft: NotesDraft): Promise<void> {
    const knowledgeDoc = renderKnowledgeDoc(draft);
    const checkout: Record<string, unknown> = {
      fields: draft.checkoutFields.length > 0 ? draft.checkoutFields : emptyDraft().checkoutFields,
    };
    await this.dataSource.query(
      `UPDATE store_configs
          SET knowledge_doc = $2,
              checkout_config = (COALESCE(checkout_config, '{}'::jsonb) - 'paymentDetails') || $3::jsonb
                                || CASE WHEN $4::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('paymentDetails', $4::text) END,
              flow_config = CASE WHEN $5::text IS NULL THEN flow_config
                                 ELSE COALESCE(flow_config, '{}'::jsonb) || jsonb_build_object('sizing',
                                        COALESCE(flow_config->'sizing', '{}'::jsonb) || jsonb_build_object('advice', $5::text)) END,
              updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, knowledgeDoc || null, JSON.stringify(checkout), draft.paymentDetails, draft.sizingAdvice],
    );
    if (draft.businessHours && Object.keys(draft.businessHours).length > 0) {
      await this.dataSource.query(`UPDATE tenant_settings SET business_hours = $2 WHERE tenant_id = $1`, [
        tenantId,
        JSON.stringify(draft.businessHours),
      ]);
    }
    this.logger.log(`Store notes saved for ${tenantId} (${knowledgeDoc.length} chars)`);
  }

  private async save(tenantId: string, draft: NotesDraft, messages: InterviewMessage[]): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO tenant_onboarding (tenant_id, notes_draft, interview) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET notes_draft = $2, interview = $3, updated_at = now()`,
      [tenantId, JSON.stringify(draft), JSON.stringify({ messages: messages.slice(-40) })],
    );
  }

  private async shop(tenantId: string): Promise<{ name: string; businessType: string }> {
    const [row]: Array<{ name: string; business_type: string }> = await this.dataSource.query(
      `SELECT name, business_type FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return { name: row?.name ?? '', businessType: row?.business_type ?? 'fashion' };
  }

  /** The shop's terms the Instagram history import found in its chats, if it has run and the owner still agrees. */
  private async historyFacts(tenantId: string): Promise<HistoryFact[]> {
    const [row]: Array<{ facts: unknown }> = await this.dataSource.query(
      `SELECT CASE WHEN history_import->>'consent' = 'true' THEN history_import->'facts' END AS facts
         FROM tenant_onboarding WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!Array.isArray(row?.facts)) return [];
    return row.facts
      .filter(
        (f): f is HistoryFact =>
          !!f && typeof f === 'object' && FACT_SECTIONS.includes(f.section) && typeof f.text === 'string' && !!f.text.trim(),
      )
      .map((f) => ({ section: f.section, text: f.text.trim(), count: typeof f.count === 'number' && f.count > 0 ? f.count : 1 }))
      .slice(0, 30);
  }
}

const FACT_SECTIONS: readonly HistoryFactSection[] = ['delivery', 'payment', 'returns', 'contacts', 'hours'];

const FACT_HEADING: Record<HistoryFactSection, string> = {
  delivery: 'Delivery',
  payment: 'Payment',
  returns: 'Returns and exchange',
  contacts: 'Contacts',
  hours: 'Working hours',
};

/** The chat facts for the draft prompt, grouped by section, each with how many conversations said it. */
function renderFacts(facts: HistoryFact[]): string {
  const groups = FACT_SECTIONS.map((section) => {
    const lines = facts
      .filter((f) => f.section === section)
      .sort((a, b) => b.count - a.count)
      .map((f) => `- ${f.text} (${f.count === 1 ? 'one conversation' : `${f.count} conversations`})`);
    return lines.length > 0 ? `### ${FACT_HEADING[section]}\n${lines.join('\n')}` : null;
  }).filter(Boolean);
  return `## What the shop's managers told customers in Instagram chats\n${groups.join('\n\n')}`;
}

const DEFAULT_QUESTIONS = [
  'Якою службою відправляєте замовлення і за скільки днів після оформлення?',
  'Хто оплачує доставку — ви чи покупець? Чи є безкоштовна доставка від певної суми?',
  'Як можна оплатити: накладений платіж, передоплата на картку? Якщо передоплата — які реквізити надсилати?',
  'Чи можна обміняти або повернути товар, і протягом скількох днів?',
  'Як клієнтам з вами зв\'язатися, крім Direct: телефон, адреса магазину? Якщо лише через Instagram — так і напишіть.',
];

function fromModel(out: z.infer<typeof draftSchema>, sources: string[]): NotesDraft {
  const sections: NotesDraft['sections'] = {};
  for (const s of NOTE_SECTIONS) if (out[s]?.trim()) sections[s] = out[s]!.trim();
  return {
    sections,
    paymentDetails: out.paymentDetails?.trim() || null,
    checkoutFields: out.checkoutFields.length > 0 ? [...new Set(out.checkoutFields)] : emptyDraft().checkoutFields,
    businessHours: out.businessHours?.length ? Object.fromEntries(out.businessHours.map((h) => [h.day, h.hours])) : null,
    sizingAdvice: out.sizingAdvice,
    questions: out.questions.slice(0, 6),
    sources,
  };
}

/** The chat's first message, without a model call: what was found and the first questions. */
function opening(draft: NotesDraft, from: 'website' | 'text' | 'history' | null, unreadSite = false): string {
  const found = NOTE_SECTIONS.filter((s) => draft.sections[s]).map((s) => SECTION_TITLE[s].toLowerCase());
  // Working hours aren't a notes section, but the chats are where they're usually found.
  if (from === 'history' && draft.businessHours && Object.keys(draft.businessHours).length > 0) found.push('години роботи');
  // Owner-facing: the AI agent learned from their Instagram; never «ваші переписки».
  const where = { website: 'вашого сайту', text: 'вашого тексту', history: 'того, що AI-агент дізнався з вашого Instagram' };
  const nothing = { website: 'На сайті', text: 'У тексті', history: 'В Instagram' };
  const intro = from
    ? found.length > 0
      ? `Чернетку складено з ${where[from]}: ${found.join(', ')}. Перевірте її.`
      : `${nothing[from]} немає умов доставки й оплати, тож спитаю вас.`
    : unreadSite
      ? 'Не вдалося відкрити ваш сайт, тож спитаю вас — це кілька коротких питань.'
      : 'Розкажіть кілька речей про магазин — я запишу їх для AI-агента.';
  const asks = draft.questions.slice(0, 2);
  return asks.length > 0 ? `${intro}\n\n${asks.join('\n')}` : `${intro}\n\nЯкщо все вірно — натисніть «Зберегти і далі».`;
}

/** The shop's site from its feed link («https://shop.ua/feed.xml» → «https://shop.ua»), but not Google Sheets. */
function websiteFromFeed(feedUrl: string | null): string | null {
  if (!feedUrl) return null;
  try {
    const url = new URL(feedUrl);
    return /google\.com$/.test(url.hostname) ? null : url.origin;
  } catch {
    return null;
  }
}
