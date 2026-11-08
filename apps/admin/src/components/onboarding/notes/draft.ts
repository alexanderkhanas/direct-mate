// The store notes drafted during setup. Mirrors apps/api/src/modules/onboarding/store-notes.ts.

export const NOTE_SECTIONS = ['delivery', 'payment', 'returns', 'sizes', 'contacts', 'other'] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];

/** The sections the found/missing chips track: what customers ask about most. */
export const KEY_SECTIONS: NoteSection[] = ['delivery', 'payment', 'returns', 'contacts'];

/** The longest pasted text the drafter accepts (DraftNotesDto). */
export const TEXT_MAX = 8000;

export interface NotesDraft {
  sections: Partial<Record<NoteSection, string>>;
  /** Sent to customers word for word when they choose prepayment. */
  paymentDetails: string | null;
  checkoutFields: string[];
  businessHours: Record<string, string> | null;
  sizingAdvice: 'recommend' | 'consult' | null;
  questions: string[];
  sources: string[];
}

export interface NotesMessage {
  role: 'owner' | 'assistant';
  text: string;
}

/** GET /onboarding/notes */
export interface NotesState {
  draft: NotesDraft | null;
  messages: NotesMessage[];
  /** The shop's site, from the product feed's domain. */
  websiteUrl: string | null;
}

/** How the owner gives the assistant what it needs; `history` = the terms found in their Instagram chats. */
export type NotesWay = 'interview' | 'text' | 'website' | 'history';

/** A part of the draft that can show «щойно оновлено». */
export type FreshKey = NoteSection | 'paymentDetails';

export function filled(value: string | null | undefined): boolean {
  return !!value?.trim();
}

export function isDraftEmpty(draft: NotesDraft): boolean {
  return !NOTE_SECTIONS.some((s) => filled(draft.sections[s])) && !filled(draft.paymentDetails);
}

function valueOf(draft: NotesDraft, key: FreshKey): string {
  return (key === 'paymentDetails' ? draft.paymentDetails : draft.sections[key]) ?? '';
}

const FRESH_KEYS: FreshKey[] = [...NOTE_SECTIONS, 'paymentDetails'];

/** What the server changed between the draft it was sent and the one it returned. */
export function changedKeys(sent: NotesDraft, returned: NotesDraft): FreshKey[] {
  return FRESH_KEYS.filter((k) => valueOf(sent, k).trim() !== valueOf(returned, k).trim());
}

/**
 * The chat's answer, keeping whatever the owner typed into the draft while
 * waiting for it: a field they changed since sending stays theirs.
 */
export function mergeDraft(sent: NotesDraft, local: NotesDraft, returned: NotesDraft): { draft: NotesDraft; kept: FreshKey[] } {
  const kept = FRESH_KEYS.filter((k) => valueOf(local, k) !== valueOf(sent, k));
  const sections = { ...returned.sections };
  for (const s of NOTE_SECTIONS) if (kept.includes(s)) sections[s] = local.sections[s];
  const paymentDetails = kept.includes('paymentDetails') ? local.paymentDetails : returned.paymentDetails;
  return { draft: { ...returned, sections, paymentDetails }, kept };
}

/** «shop.com.ua» → «https://shop.com.ua»; the site reader needs a scheme. */
export function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
