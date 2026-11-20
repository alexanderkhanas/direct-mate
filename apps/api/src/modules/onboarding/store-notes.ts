import { BadRequestException } from '@nestjs/common';

/**
 * The store notes being written during setup: sections of plain bullet lines,
 * plus the structured settings the same answers decide. Saved into
 * `store_configs.knowledge_doc` (rendered), `checkout_config` and
 * `tenant_settings.business_hours` when the owner presses «Зберегти».
 */

export const NOTE_SECTIONS = ['delivery', 'payment', 'returns', 'sizes', 'contacts', 'other'] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];

/** The sections every store should have; setup shows a chip for each (admin: notes/draft.ts KEY_SECTIONS). */
export const KEY_SECTIONS: readonly NoteSection[] = ['delivery', 'payment', 'returns', 'contacts'];

export const SECTION_TITLE: Record<NoteSection, string> = {
  delivery: 'Доставка',
  payment: 'Оплата',
  returns: 'Обмін і повернення',
  sizes: 'Розміри',
  contacts: 'Контакти',
  other: 'Інше',
};

/** Only these mean anything to the order draft (`order-draft.service.ts`). */
export const CHECKOUT_FIELDS = ['fullName', 'phone', 'city', 'novaPoshtaBranch', 'paymentMethod'] as const;
export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

export const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export interface NotesDraft {
  sections: Partial<Record<NoteSection, string>>;
  /** Sent word for word by send_payment_details; only real details a source or the owner gave. */
  paymentDetails: string | null;
  checkoutFields: CheckoutField[];
  /** `mon`…`sun` → `'09:00-18:00'` or `'closed'`. */
  businessHours: Record<string, string> | null;
  sizingAdvice: 'recommend' | 'consult' | null;
  /** What's still unknown, as questions for the owner. */
  questions: string[];
  /** Pages the draft was written from. */
  sources: string[];
}

/** A partial change to the notes: only what is given changes. An empty section text removes that section. */
export interface NotesPatch {
  sections?: Partial<Record<NoteSection, string>>;
  /** `null` removes the details. */
  paymentDetails?: string | null;
  checkoutFields?: CheckoutField[];
  businessHours?: Record<string, string>;
}

export function emptyDraft(): NotesDraft {
  return {
    sections: {},
    paymentDetails: null,
    checkoutFields: ['fullName', 'phone', 'city', 'novaPoshtaBranch'],
    businessHours: null,
    sizingAdvice: null,
    questions: [],
    sources: [],
  };
}

/** The draft as the knowledge doc the agent reads: «# Доставка\n- …». */
export function renderKnowledgeDoc(draft: NotesDraft): string {
  return NOTE_SECTIONS.filter((s) => draft.sections[s]?.trim())
    .map((s) => `# ${SECTION_TITLE[s]}\n${draft.sections[s]!.trim()}`)
    .join('\n\n');
}

/** Keep only the known fields, with the right types and sane lengths. */
export function validDraft(raw: unknown): NotesDraft {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('No notes to save');
  const d = raw as Record<string, any>;
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const sections: NotesDraft['sections'] = {};
  for (const key of NOTE_SECTIONS) {
    const value = text(d.sections?.[key], 3000);
    if (value) sections[key] = value;
  }
  const hours =
    d.businessHours && typeof d.businessHours === 'object'
      ? Object.fromEntries(
          Object.entries(d.businessHours as Record<string, unknown>)
            .filter(([day, h]) => (WEEK_DAYS as readonly string[]).includes(day) && typeof h === 'string')
            .map(([day, h]) => [day, (h as string).slice(0, 20)]),
        )
      : null;
  return {
    sections,
    paymentDetails: text(d.paymentDetails, 1000),
    checkoutFields: Array.isArray(d.checkoutFields)
      ? d.checkoutFields.filter((f: unknown): f is NotesDraft['checkoutFields'][number] => (CHECKOUT_FIELDS as readonly unknown[]).includes(f))
      : [],
    businessHours: hours && Object.keys(hours).length > 0 ? hours : null,
    sizingAdvice: d.sizingAdvice === 'recommend' || d.sizingAdvice === 'consult' ? d.sizingAdvice : null,
    questions: Array.isArray(d.questions) ? d.questions.filter((q: unknown) => typeof q === 'string').slice(0, 8) : [],
    sources: Array.isArray(d.sources) ? d.sources.filter((q: unknown) => typeof q === 'string').slice(0, 10) : [],
  };
}

/**
 * The knowledge doc back into sections, for when it was edited in Settings
 * after the draft was saved. Headings this file writes («# Доставка») open
 * their section; anything else, an unknown heading included, is kept under
 * `other` so nothing the owner wrote is lost.
 */
export function parseKnowledgeDoc(doc: string | null | undefined): NotesDraft['sections'] {
  const byTitle = new Map(NOTE_SECTIONS.map((s) => [SECTION_TITLE[s].toLowerCase(), s]));
  const lines: Partial<Record<NoteSection, string[]>> = {};
  let current: NoteSection = 'other';
  for (const line of (doc ?? '').split('\n')) {
    const heading = /^#\s+(.+?)\s*$/.exec(line);
    const known = heading ? byTitle.get(heading[1].toLowerCase()) : undefined;
    if (known) {
      current = known;
      continue;
    }
    if (heading) current = 'other';
    (lines[current] ??= []).push(line);
  }
  const sections: NotesDraft['sections'] = {};
  for (const key of NOTE_SECTIONS) {
    const text = (lines[key] ?? []).join('\n').trim();
    if (text) sections[key] = text;
  }
  return sections;
}
