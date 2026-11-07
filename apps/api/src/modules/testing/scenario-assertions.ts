import { colorsMatch, findColorWords } from '../../common/color-i18n';
import { findSizes, normSize, sameSize } from '../agent/catalog/catalog-format';
import type { SimulatorTurnExpect } from '../../scripts/scenarios/types';
import type { StyleViolation } from '../agent/agent.types';
import type { OutgoingMessage, TurnHandoff, TurnRunResult } from '../conversations/turn-runner.service';
import type { OrderDraftView } from '../orders/order-draft.service';
import { describeLook } from '../catalog/attributes/product-attributes';
import type { ShortlistItem } from './shortlist';

export interface AssertionResult {
  field: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

/** What a turn produced, read back from the result and the database. */
export interface TurnOutcome {
  status: TurnRunResult['status'];
  messages: OutgoingMessage[];
  handoff: TurnHandoff | null;
  toolCalls: string[];
  /** The conversation's open draft, or else its last placed one. */
  draft: OrderDraftView | null;
  orderPlaced: boolean;
  paymentDetailsSent: boolean;
  /** Style problems left in the reply that was sent. */
  finalStyle: StyleViolation[];
  /** The turn's message landed in a different conversation than the previous turn's. */
  newConversation: boolean;
  /** Products the bot offered this turn (`shortlist.ts`). */
  shortlist?: ShortlistItem[];
}

export type OutcomeExpect = Pick<
  SimulatorTurnExpect,
  | 'handoff'
  | 'newConversation'
  | 'handoffReason'
  | 'replyContains'
  | 'replyNotContains'
  | 'replyMaxChars'
  | 'replyMentionsSize'
  | 'replyMentionsColor'
  | 'imageCount'
  | 'imageCountMin'
  | 'imageContains'
  | 'toolCalled'
  | 'toolNotCalled'
  | 'orderDraft'
  | 'orderPlaced'
  | 'paymentDetailsSent'
  | 'shortlist'
>;

const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const SIZE_TOKEN = /^(XXXL|XXL|XL|XXS|XS|[2-6]XL|S|M|L|\d{2})$/;

/** Handoffs that mean the agent failed rather than chose to hand off. */
const FAILURE_HANDOFFS = new Set([
  'agent_error',
  'runner_error',
  'step_limit',
  'empty_reply',
  'ungrounded_reply',
  'order_failed',
]);

/** Engine-memory fields with no outcome equivalent; reported when dropped. */
const ROUTE_ONLY_STATE_FIELDS = [
  'selectionState',
  'selectedProductId',
  'selectedVariantName',
  'selectedColor',
  'selectedSize',
  'variantStep',
  'lastAction',
  'awaitingField',
  'preQualifyCollected',
  'recommendedSkinType',
  'shouldOfferSizeHelp',
  'awaitingPreQualifyAnswer',
] as const;

/**
 * Turns a classifier-era `expect` into outcome assertions. Fields that only
 * described the old engine's route have no equivalent; they're returned in
 * `dropped` so a turn left with nothing real to check is visible.
 */
export function mapLegacyExpect(expect: SimulatorTurnExpect): { expect: OutcomeExpect; dropped: string[] } {
  const {
    decision,
    scenario,
    extraReplyCount,
    extraReplyImageContains,
    state,
    note: _note,
    ...outcomes
  } = expect;
  const out: OutcomeExpect = { ...outcomes, ...(outcomes.orderDraft && { orderDraft: { ...outcomes.orderDraft } }) };
  const dropped: string[] = [];

  // The engine printed catalog values verbatim («Білий», "M"); the agent
  // writes Ukrainian («біла», «M і L»). A `replyContains` that is only a colour
  // or only sizes means "mentions that colour/size", so check it that way.
  if (outcomes.replyContains !== undefined) {
    const original = list(outcomes.replyContains);
    const substrings: string[] = [];
    for (const s of original) {
      const parts = s.split(/[,\s]+/).filter(Boolean);
      const colors = findColorWords(s);
      if (parts.length > 0 && parts.every((p) => SIZE_TOKEN.test(p))) {
        out.replyMentionsSize = [...list(out.replyMentionsSize), ...parts];
      } else if (colors.length === 1 && colors[0].word === s.trim().toLowerCase()) {
        out.replyMentionsColor = [...list(out.replyMentionsColor), s.trim()];
      } else {
        substrings.push(s);
      }
    }
    if (substrings.length !== original.length) {
      if (substrings.length > 0) out.replyContains = substrings;
      else delete out.replyContains;
    }
  }

  if (decision === 'handoff') out.handoff ??= true;
  else if (decision === 'reply') out.handoff ??= false;
  else if (decision === 'create_draft_order') {
    out.orderPlaced ??= true;
    out.handoff ??= false;
  }
  if (scenario !== undefined) dropped.push('scenario');
  if (extraReplyCount !== undefined) dropped.push('extraReplyCount');
  if (extraReplyImageContains !== undefined) out.imageContains ??= extraReplyImageContains;

  if (state) {
    if (state.orderCreated !== undefined) out.orderPlaced ??= state.orderCreated;
    if (state.cartLength !== undefined) out.orderDraft = { ...out.orderDraft, itemCount: state.cartLength };
    if (state.cartHasVariant !== undefined) {
      out.orderDraft = {
        ...out.orderDraft,
        items: [...(out.orderDraft?.items ?? []), { variantIncludes: state.cartHasVariant }],
      };
    }
    if (state.recommendedSize !== undefined) {
      const sizes = out.replyMentionsSize === undefined ? [] : ([] as string[]).concat(out.replyMentionsSize);
      out.replyMentionsSize = [...sizes, state.recommendedSize];
    }
    for (const field of ROUTE_ONLY_STATE_FIELDS) {
      if (state[field] !== undefined) dropped.push(`state.${field}`);
    }
  }
  return { expect: out, dropped };
}

export function evaluateExpect(expect: OutcomeExpect, o: TurnOutcome): AssertionResult[] {
  const results: AssertionResult[] = [];
  const push = (field: string, pass: boolean, expected: unknown, actual: unknown) =>
    results.push({ field, pass, expected, actual });

  const text = o.messages.map((m) => m.text).join('\n');
  const lower = text.toLowerCase();
  const preview = () => o.messages.map((m) => m.text.slice(0, 100)).join(' ‖ ') || '(no messages)';
  const images = o.messages.flatMap((m) => m.imageUrls ?? []);

  if (expect.handoff !== undefined) {
    push('handoff', !!o.handoff === expect.handoff, expect.handoff, o.handoff?.reason ?? false);
  }
  if (expect.newConversation !== undefined) {
    push('newConversation', o.newConversation === expect.newConversation, expect.newConversation, o.newConversation);
  }
  if (expect.handoffReason !== undefined) {
    push('handoffReason', o.handoff?.reason === expect.handoffReason, expect.handoffReason, o.handoff?.reason ?? null);
  }
  for (const sub of list(expect.replyContains)) {
    push('replyContains', lower.includes(sub.toLowerCase()), sub, preview());
  }
  for (const sub of list(expect.replyNotContains)) {
    push('replyNotContains', !lower.includes(sub.toLowerCase()), `NOT ${sub}`, preview());
  }
  if (expect.replyMaxChars !== undefined) {
    const reply = o.messages.filter((m) => m.kind === 'reply').map((m) => m.text).join('\n');
    push('replyMaxChars', reply.length <= expect.replyMaxChars, `≤ ${expect.replyMaxChars}`, reply.length);
  }
  const mentioned = findSizes(text).map(normSize);
  for (const size of list(expect.replyMentionsSize)) {
    // Two-digit sizes (jeans, shoes) also count when written bare: «28 є».
    const bare = /^\d{2}$/.test(size) && new RegExp(`(?<!\\d)${size}(?!\\d)`).test(text);
    push('replyMentionsSize', bare || mentioned.includes(normSize(size)), size, mentioned);
  }
  const colorsSaid = findColorWords(text).map((c) => c.color);
  for (const color of list(expect.replyMentionsColor)) {
    push('replyMentionsColor', colorsSaid.some((c) => colorsMatch(c, color)), color, colorsSaid);
  }
  if (expect.imageCount !== undefined) push('imageCount', images.length === expect.imageCount, expect.imageCount, images.length);
  if (expect.imageCountMin !== undefined) {
    push('imageCountMin', images.length >= expect.imageCountMin, `>= ${expect.imageCountMin}`, images.length);
  }
  if (expect.imageContains !== undefined) {
    const sub = expect.imageContains.toLowerCase();
    push('imageContains', images.some((u) => u.toLowerCase().includes(sub)), sub, images);
  }
  for (const tool of list(expect.toolCalled)) push('toolCalled', o.toolCalls.includes(tool), tool, o.toolCalls);
  for (const tool of list(expect.toolNotCalled)) push('toolNotCalled', !o.toolCalls.includes(tool), `NOT ${tool}`, o.toolCalls);

  const draft = expect.orderDraft;
  if (draft) {
    const items = o.draft?.items ?? [];
    const described = items.map((i) => `${i.title} (${[i.color, i.size].filter(Boolean).join(', ')})`);
    if (draft.itemCount !== undefined) push('orderDraft.itemCount', items.length === draft.itemCount, draft.itemCount, items.length);
    for (const want of draft.items ?? []) {
      const found = items.some(
        (i) =>
          (!want.titleIncludes || i.title.toLowerCase().includes(want.titleIncludes.toLowerCase())) &&
          (!want.variantIncludes ||
            want.variantIncludes
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
              .every((part) => colorsMatch(i.color, part) || sameSize(i.size, part))),
      );
      push('orderDraft.items', found, want, described);
    }
    if (draft.complete !== undefined) push('orderDraft.complete', (o.draft?.complete ?? false) === draft.complete, draft.complete, o.draft?.missingFields ?? 'no draft');
    for (const [field, want] of Object.entries(draft.customer ?? {})) {
      const c = o.draft?.customer;
      const actual = field === 'novaPoshtaBranch' ? c?.branch : (c as Record<string, string | null> | undefined)?.[field];
      const pass =
        field === 'phone'
          ? !!actual && actual.replace(/\D/g, '').endsWith(want.replace(/\D/g, '').slice(-9))
          : !!actual && actual.toLowerCase().includes(want.toLowerCase());
      push(`orderDraft.customer.${field}`, pass, want, actual ?? null);
    }
  }
  if (expect.orderPlaced !== undefined) push('orderPlaced', o.orderPlaced === expect.orderPlaced, expect.orderPlaced, o.orderPlaced);
  if (expect.paymentDetailsSent !== undefined) {
    push('paymentDetailsSent', o.paymentDetailsSent === expect.paymentDetailsSent, expect.paymentDetailsSent, o.paymentDetailsSent);
  }

  const shortlist = expect.shortlist;
  if (shortlist) {
    const items = o.shortlist ?? [];
    const described = items.map((i) => `${i.title} [${describeLook(i.attributes, { withColour: true }) ?? 'no look'}]`);
    if (shortlist.min !== undefined) push('shortlist.min', items.length >= shortlist.min, `>= ${shortlist.min}`, described);
    if (shortlist.max !== undefined) push('shortlist.max', items.length <= shortlist.max, `<= ${shortlist.max}`, described);
    if (shortlist.category !== undefined) {
      const want = shortlist.category.toLowerCase();
      push(
        'shortlist.category',
        items.length > 0 && items.every((i) => i.category?.toLowerCase() === want),
        shortlist.category,
        items.map((i) => `${i.title}: ${i.category ?? '—'}`),
      );
    }
    for (const [key, allowed] of Object.entries(shortlist.attributes ?? {})) {
      const off = items.filter((i) => !allowed.includes(i.attributes[key as keyof typeof i.attributes] ?? ''));
      push(
        `shortlist.${key}`,
        items.length > 0 && off.length === 0,
        allowed,
        off.length > 0 ? off.map((i) => `${i.title}: ${i.attributes[key as keyof typeof i.attributes] ?? '—'}`) : described,
      );
    }
  }
  return results;
}

/**
 * Checked on every turn, whatever the scenario says: the turn was answered,
 * didn't fail into a handoff (unless that exact reason is expected), and the
 * sent reply has no style problems left.
 */
export function implicitChecks(o: TurnOutcome, expect: OutcomeExpect): AssertionResult[] {
  const reason = o.handoff?.reason;
  return [
    {
      field: 'implicit.answered',
      pass: o.status === 'replied' || o.status === 'handed_off',
      expected: 'replied or handed_off',
      actual: o.status,
    },
    {
      field: 'implicit.noFailureHandoff',
      pass: !reason || !FAILURE_HANDOFFS.has(reason) || expect.handoffReason === reason,
      expected: 'no failure handoff',
      actual: reason ?? null,
    },
    {
      field: 'implicit.style',
      pass: o.finalStyle.length === 0,
      expected: 'no style problems',
      actual: o.finalStyle.map((s) => s.match),
    },
  ];
}
