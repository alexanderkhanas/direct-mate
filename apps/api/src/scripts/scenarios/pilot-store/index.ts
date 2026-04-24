// Pilot Store — beauty products (lipsticks), color variants.

import { PILOT_STORE, SimulatorScenario } from '../types';

export const PILOT_STORE_SCENARIOS: Record<string, SimulatorScenario> = {
  beauty_standard: {
    name: 'Beauty — Standard Order Flow',
    description: 'Greeting → show products → pick color → confirm → delivery → order',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'Привіт, хочу помаду' },
      { message: 'Silk Color, Nude Pink' },
      { message: 'так' },
      { message: 'Іван Петренко, 0991234567, Київ, НП 5' },
    ],
  },

  adds_to_cart: {
    name: 'Multi-Cart — Two products',
    description: 'Pick product → confirm → add another → confirm → checkout',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color Nude Pink' },
      { message: 'так' },
      { message: 'і ще Rosewood' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Марія Шевченко, 0501234567, Одеса, НП 3' },
    ],
  },

  cart_remove_buy_one: {
    name: 'Multi-Cart — Add two, buy only one',
    description: 'Add Nude Pink + Rosewood to cart → "хочу тільки Nude Pink" → cart filtered to 1 → checkout',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color' },
      // Explicit variant pick to avoid classifier non-determinism on bare "так".
      { message: 'Nude Pink' },
      // adds_to_cart while awaiting_confirmation → 4.6 commits Nude Pink, searches Rosewood.
      { message: 'і ще Rosewood' },
      // 5.5a commits Rosewood → cart=[Nude Pink, Rosewood].
      { message: 'так' },
      {
        message: 'хочу тільки Nude Pink',
        expect: {
          state: { cartLength: 1, cartHasVariant: 'Nude Pink' },
          note: 'Cart correction: Rosewood removed, only Nude Pink remains',
        },
      },
      { message: 'оформлюємо' },
      { message: 'Марія Шевченко, 0501234567, Одеса, НП 3' },
    ],
  },

  cart_abandon_pick_new: {
    name: 'Multi-Cart — Add two, abandon cart, buy third',
    description: 'Add Nude Pink + Rosewood → "ні, хочу Color Veil Terracotta" → cart cleared, fresh search',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color Nude Pink' },
      { message: 'так' },
      { message: 'і ще Rosewood' },
      { message: 'так' },
      {
        message: 'ні, давайте тільки Color Veil Terracotta',
        expect: {
          note: 'Cart correction: neither Silk Color item matches Color Veil → cart cleared, fresh product search',
        },
      },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Марія Шевченко, 0501234567, Одеса, НП 3' },
    ],
  },

  adds_to_cart_different_product: {
    name: 'Multi-Cart — Two DIFFERENT products (beauty)',
    description: 'Pick Silk Color Nude Pink → confirm → add Color Veil Terracotta → confirm → checkout → order',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color' },
      // Explicit variant pick to force awaiting_confirmation deterministically.
      { message: 'Nude Pink' },
      // adds_to_cart while awaiting_confirmation: 4.6 commits Nude Pink, then clears for new product.
      { message: 'і ще Color Veil Terracotta' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'оформлюємо' },
      {
        message: 'Марія Шевченко, 0501234567, Одеса, НП 3',
        expect: {
          decision: 'create_draft_order',
          state: { orderCreated: true, cartLength: 2 },
          note: 'Cart must contain 2 different products (Silk Color + Color Veil)',
        },
      },
    ],
  },

  beauty_color_variant: {
    name: 'Beauty — Direct color variant pick',
    description: 'User asks for specific lipstick color → should match variant and confirm',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color Nude Pink' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Анна Петренко, 0991234567, Київ, НП 5' },
    ],
  },

  // ─── Customer photo ─────────────────────────────────────────────

  customer_photo_unrelated_beauty: {
    name: 'Customer Photo — Unrelated image (handoff)',
    description: 'Customer sends a random photo (not a product) → vision finds no match → handoff',
    tenantId: PILOT_STORE,
    turns: [
      {
        message: 'це у вас є?',
        mediaReference: {
          mediaId: 'https://placehold.co/600x400/EEE/31343C.png?text=Random+Photo',
          type: 'customer_photo',
        },
        expect: {
          decision: 'handoff',
          note: 'Random image must not match any linked product → handoff with holding message',
        },
      },
    ],
  },

  // ─── Size chart tenant isolation ────────────────────────────────

  size_chart_tenant_isolation: {
    name: 'Size Chart — Tenant isolation (must not leak another tenant\'s chart)',
    description:
      'Pilot Store has no size charts configured. Even if Clothes Store has charts, they must not leak here — must silent-handoff.',
    tenantId: PILOT_STORE,
    turns: [
      {
        message: 'розмірна сітка є?',
        expect: {
          decision: 'handoff',
          replyNotContains: ['uploads/', 'розмірна сітка'],
          note: 'Size chart lookup must be scoped by tenant_id — Pilot Store should never see a Clothes Store chart.',
        },
      },
    ],
  },
};
