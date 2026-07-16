// Cosmetics-vertical simulator scenarios. Run against demo-cosmetics tenant
// (resolved by slug at boot, no env-specific UUID hardcoding).
// demo-cosmetics defaults to preQualifyStrategy='before_search' — so T1
// product inquiry without a skin type triggers the bot's skin-type ask.
//
// Split into PRIMARY (gating, must pass reliably) and EDGE CASE (flaky,
// best-effort tests of classifier robustness on natural Ukrainian phrasing).

import { DEMO_COSMETICS_SLUG, SimulatorScenario } from '../types';

export const COSMETICS_SCENARIOS: Record<string, SimulatorScenario> = {
  // ─── PRIMARY (gating) ──────────────────────────────────────────

  cosmetics_pre_qualify_before_search: {
    name: 'Cosmetics — Before-search ask, then provide skin type',
    description:
      'Default before_search flow: T1 product inquiry → bot asks skin type → user provides → recommend',
    tenantId: DEMO_COSMETICS_SLUG,
    turns: [
      {
        message: 'хочу крем',
        expect: {
          replyContains: ['тип шкіри'],
          state: { lastAction: 'asked_pre_qualify', awaitingField: 'pre_qualify_data' },
        },
      },
      {
        message: 'жирна',
        expect: {
          replyContains: ['Для жирної шкіри'],
          state: { recommendedSkinType: 'жирна', preQualifyCollected: true },
        },
      },
    ],
  },

  cosmetics_skin_type_in_first_message: {
    name: 'Cosmetics — Skin type extracted from first turn (short-circuit)',
    description:
      'User says skin type explicitly upfront — engine captures, prefixes recommendation, no offer',
    tenantId: DEMO_COSMETICS_SLUG,
    turns: [
      {
        message: 'хочу крем для жирної шкіри',
        expect: {
          replyContains: ['Для жирної шкіри'],
          replyNotContains: ['Хочете, допоможу'],
          state: { recommendedSkinType: 'жирна', preQualifyCollected: true },
        },
      },
    ],
  },

  cosmetics_mask_variant_choice: {
    name: 'Cosmetics — Multi-variant mask selection (productName short-circuit)',
    description:
      'User asks for specific variant → productName short-circuits gate → variant resolved → confirm → checkout',
    tenantId: DEMO_COSMETICS_SLUG,
    turns: [
      { message: 'хочу маску зволожуючу' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
    ],
  },

  cosmetics_handoff_safety: {
    name: 'Cosmetics — Allergy concern escalates, and the customer is told',
    description:
      'A safety/allergy question is never the bot\'s to answer — it escalates ' +
      'to a human. It must also SAY so.\n' +
      'This scenario used to assert the opposite (replyNotContains "Передаю ' +
      'розмову менеджеру"), enforcing the old silent-handoff convention where ' +
      'the manager slid into the thread unannounced. That is gone: a customer ' +
      'who raises an allergy and then hears nothing at all has been abandoned ' +
      'mid-sentence on the one topic where being ignored actually matters. ' +
      'Handoffs announce now — see CLAUDE.md.',
    tenantId: DEMO_COSMETICS_SLUG,
    turns: [
      {
        message: 'у мене сильна алергія на парабени',
        expect: {
          decision: 'handoff',
          replyContains: ['менеджер'],
          note: 'Escalates AND tells the customer a human is picking it up.',
        },
      },
    ],
  },

  // ─── EDGE CASE (flaky, non-gating) ─────────────────────────────

  cosmetics_natural_phrasing_t_zone: {
    name: 'Cosmetics — Natural phrasing: Т-зона блищить',
    description:
      'Indirect skin-type description — verifies few-shot example "Т-зона блищить → комбінована" works.',
    tenantId: DEMO_COSMETICS_SLUG,
    flaky: true,
    turns: [
      {
        message: 'Т-зона блищить, що порадите?',
        expect: {
          replyContains: ['Для комбінованої шкіри'],
          state: { recommendedSkinType: 'комбінована' },
        },
      },
    ],
  },

  cosmetics_natural_phrasing_dry: {
    name: 'Cosmetics — Natural phrasing: dry skin (age-related)',
    description:
      'Age-related dry skin phrasing not directly in few-shot examples — best-effort extraction.',
    tenantId: DEMO_COSMETICS_SLUG,
    flaky: true,
    turns: [
      {
        message: 'після 30 не вистачає вологи',
        expect: {
          replyContains: ['Для сухої шкіри'],
          state: { recommendedSkinType: 'суха' },
        },
      },
    ],
  },

  cosmetics_no_chart_attach: {
    name: 'Cosmetics — variant choice does NOT attach a size chart (no charts seeded)',
    description:
      'Cosmetics tenant has no size_charts rows. Even when asking for a variant, resolveForContext returns null → silent skip. Confirms cosmetics never gets a chart bubble.',
    tenantId: DEMO_COSMETICS_SLUG,
    turns: [
      { message: 'хочу маску' },
      {
        message: 'першу',
        expect: {
          extraReplyCount: 0,
        },
      },
    ],
  },
};
