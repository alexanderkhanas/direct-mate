import { CheckoutSessionStatus } from '@direct-mate/shared';
import { localizeColor } from '../../../common/color-i18n';
import type { OrderDraftView } from '../../orders/order-draft.service';
import { money } from '../catalog/catalog-format';

/**
 * The per-turn context message, appended after the history as a system
 * message. Kept out of the system prompt so that prompt stays cacheable.
 */
export function buildTurnContext(opts: {
  now: Date;
  timezone: string;
  draft: OrderDraftView | null;
  notes: string[];
}): string {
  const lines = ['Context for this turn (the customer does not see this):'];
  lines.push(`- Shop's local time: ${localTime(opts.now, opts.timezone)}.`);
  lines.push(`- ${describeDraft(opts.draft)}`);
  for (const note of opts.notes) lines.push(`- ${note}`);
  return lines.join('\n');
}

function localTime(now: Date, timezone: string): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat('uk-UA', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(now);
  try {
    return format(timezone);
  } catch {
    // An invalid timezone on the tenant row shouldn't fail the turn.
    return format('Europe/Kyiv');
  }
}

function describeDraft(draft: OrderDraftView | null): string {
  if (!draft) return 'Order draft: none yet.';
  const items = draft.items
    .map((i) => {
      const variant = [localizeColor(i.color), i.size].filter(Boolean).join(', ');
      return `${i.title}${variant ? ` (${variant})` : ''} ×${i.qty} — ${money(i.unitPrice * i.qty, i.currency)}`;
    })
    .join('; ');
  const total = draft.items.length > 0 ? `; total ${money(draft.total, draft.currency)}` : '';

  if (draft.status === CheckoutSessionStatus.DraftCreated) {
    return `The customer's last order was placed: ${items}${total}. It can't be changed by you; changes go to a manager.`;
  }
  const missing = draft.missingFields.length > 0 ? `; still needed: ${draft.missingFields.join(', ')}` : '; complete';
  return `Order draft: ${items || 'no items yet'}${total}${missing}.`;
}
