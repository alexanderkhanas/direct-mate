import { tool } from 'ai';
import { z } from 'zod';
import { CheckoutSessionStatus } from '@direct-mate/shared';
import { colorsMatch, localizeColor } from '../../../common/color-i18n';
import { DraftPatch, OrderDraftView } from '../../orders/order-draft.service';
import { productRef } from '../catalog/catalog-reader.service';
import { sameSize } from '../catalog/catalog-format';
import { pickVariant } from './product-shapes';
import type { StagedEffect } from '../agent.types';
import type { AgentToolDeps, ToolScope } from './tool-deps';
import type { AgentStoreSettings } from '../store-settings.service';

/** The draft as the model sees it. Key names feed the fact ledger. */
export function draftForModel(view: OrderDraftView | null) {
  if (!view) return null;
  return {
    status:
      view.status === CheckoutSessionStatus.DraftCreated ? 'placed' : view.complete ? 'complete' : 'collecting',
    items: view.items.map((i) => ({
      productRef: productRef(i.productId),
      title: i.title,
      color: localizeColor(i.color) || null,
      size: i.size,
      quantity: i.qty,
      price: i.unitPrice,
      lineTotal: i.unitPrice * i.qty,
    })),
    total: view.total,
    currency: view.currency,
    customer: {
      fullName: view.customer.fullName,
      phone: view.customer.phone,
      city: view.customer.city,
      novaPoshtaBranch: view.customer.branch,
      paymentMethod: view.customer.paymentMethod,
    },
    missingFields: view.missingFields,
    paymentDetailsSent: view.paymentDetailsSentAt !== null,
  };
}

export function getOrderDraftTool(deps: AgentToolDeps, scope: ToolScope, settings: AgentStoreSettings) {
  return tool({
    description:
      "The customer's current order draft: items, customer details, total, which details are still " +
      'missing, and whether it has been placed. Check it before talking about the order or its total.',
    inputSchema: z.object({}),
    execute: async () => ({ draft: draftForModel(await deps.drafts.getCurrentDraft(scope, settings.checkoutFields)) }),
  });
}

export function updateOrderDraftTool(deps: AgentToolDeps, scope: ToolScope, settings: AgentStoreSettings) {
  return tool({
    description:
      'Change the order draft. Add an item once the customer has chosen the product and, where the product ' +
      'has them, the colour and size. Remove an item they no longer want. Save customer details as soon as ' +
      'they give them. Pass only what the customer actually said. Returns the updated draft with ' +
      'missingFields — ask for those next.',
    inputSchema: z.object({
      addItem: z
        .object({
          productRef: z.string(),
          color: z.string().optional(),
          size: z.string().optional(),
          quantity: z.number().int().min(1).max(20).optional(),
        })
        .optional(),
      removeItem: z
        .object({ productRef: z.string(), color: z.string().optional(), size: z.string().optional() })
        .optional(),
      customer: z
        .object({
          fullName: z.string().optional().describe('Surname and first name (ПІБ).'),
          phone: z.string().optional(),
          city: z.string().optional(),
          novaPoshtaBranch: z.string().optional().describe('Nova Poshta branch or parcel locker number/address.'),
          comment: z.string().optional(),
        })
        .optional(),
      paymentMethod: z
        .enum(['cod', 'prepay'])
        .optional()
        .describe('cod = pay on delivery (накладений платіж), prepay = card prepayment.'),
    }),
    execute: async ({ addItem, removeItem, customer, paymentMethod }) => {
      const patch: DraftPatch = {};

      if (addItem) {
        const resolved = await deps.catalog.resolveProductRef(scope.tenantId, addItem.productRef);
        if ('error' in resolved) return { ok: false, error: resolved.error };
        const [product] = await deps.catalog.loadProducts(scope.tenantId, [resolved.id]);
        if (!product) return { ok: false, error: 'This product has no active variants.' };
        const pick = pickVariant(product, addItem.color, addItem.size);
        if ('error' in pick) return { ok: false, error: pick.error };
        patch.addItem = { variantId: pick.variant.id, qty: addItem.quantity };
      }

      if (removeItem) {
        const resolved = await deps.catalog.resolveProductRef(scope.tenantId, removeItem.productRef);
        if ('error' in resolved) return { ok: false, error: resolved.error };
        const current = await deps.drafts.getCurrentDraft(scope, settings.checkoutFields);
        const matches = (current?.status !== CheckoutSessionStatus.DraftCreated ? current?.items ?? [] : []).filter(
          (i) =>
            i.productId === resolved.id &&
            (!removeItem.color || colorsMatch(i.color, removeItem.color)) &&
            (!removeItem.size || sameSize(i.size, removeItem.size)),
        );
        if (matches.length === 0) return { ok: false, error: 'That item is not in the order draft.' };
        if (matches.length > 1) {
          return { ok: false, error: 'More than one variant of that product is in the draft; name the colour or size.' };
        }
        patch.removeVariantId = matches[0].variantId;
      }

      if (customer) {
        patch.customer = {
          fullName: customer.fullName,
          phone: customer.phone,
          city: customer.city,
          branch: customer.novaPoshtaBranch,
          comment: customer.comment,
        };
      }
      if (paymentMethod) patch.paymentMethod = paymentMethod;

      if (!patch.addItem && !patch.removeVariantId && !patch.customer && !patch.paymentMethod) {
        return { ok: false, error: 'Nothing to change.' };
      }
      const result = await deps.drafts.update(scope, patch, settings.checkoutFields);
      // The answer must match what is stored: an add that didn't land is a failure.
      const added = patch.addItem;
      if (result.ok && added && !result.draft.items.some((i) => i.variantId === added.variantId)) {
        return { ok: false, error: 'The item was not added to the draft.', draft: draftForModel(result.draft) };
      }
      return result.ok
        ? { ok: true, draft: draftForModel(result.draft) }
        : { ok: false, error: result.error, draft: draftForModel(result.draft) };
    },
  });
}

export function placeOrderTool(deps: AgentToolDeps, scope: ToolScope, settings: AgentStoreSettings) {
  return tool({
    description:
      'Place the order from the draft. Only after the customer has seen a summary of the items, sizes and ' +
      'total and clearly said yes. Refuses while details are missing. A manager confirms every order ' +
      'afterwards.',
    inputSchema: z.object({}),
    execute: async () => {
      const draft = await deps.drafts.getCurrentDraft(scope, settings.checkoutFields);
      if (!draft) return { ok: false, error: 'There is no order draft.' };
      if (draft.status === CheckoutSessionStatus.DraftCreated) {
        return { ok: false, error: 'This order is already placed.', draft: draftForModel(draft) };
      }
      if (!draft.complete) {
        return {
          ok: false,
          error: `The draft is missing: ${draft.missingFields.join(', ')}.`,
          draft: draftForModel(draft),
        };
      }
      const staged: StagedEffect = { type: 'place_order', checkoutSessionId: draft.sessionId };
      return {
        ok: true,
        staged,
        note: 'The order is placed when your reply is sent. A manager confirms it and sends the tracking number.',
        draft: draftForModel(draft),
      };
    },
  });
}

export function sendPaymentDetailsTool(deps: AgentToolDeps, scope: ToolScope, settings: AgentStoreSettings) {
  return tool({
    description:
      "Send this store's exact bank details for card prepayment, as a separate message after your reply. " +
      'Only when the customer pays by prepayment and the order draft is complete or placed. Never type bank ' +
      'details yourself.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!settings.paymentDetails) {
        return { ok: false, error: 'This store has no payment details set up. Offer payment on delivery or hand off.' };
      }
      const draft = await deps.drafts.getCurrentDraft(scope, settings.checkoutFields);
      if (!draft) return { ok: false, error: 'Create the order draft first.' };
      if (draft.customer.paymentMethod === 'cod') {
        return { ok: false, error: 'The customer chose to pay on delivery.' };
      }
      if (draft.paymentDetailsSentAt) {
        return { ok: false, error: 'Payment details were already sent for this order.' };
      }
      if (!draft.complete && draft.status !== CheckoutSessionStatus.DraftCreated) {
        return { ok: false, error: `The draft is missing: ${draft.missingFields.join(', ')}.` };
      }
      const staged: StagedEffect = {
        type: 'send_payment_details',
        checkoutSessionId: draft.sessionId,
        text: settings.paymentDetails,
      };
      return {
        ok: true,
        staged,
        note: 'The payment details are sent as a separate message after your reply. Do not repeat them.',
      };
    },
  });
}
