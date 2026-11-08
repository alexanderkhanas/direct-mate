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
