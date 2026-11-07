// Give demo stores seeded before the v2 agent what it answers from: the store
// notes (knowledge_doc), the welcome line, the handoff line and the payment
// details for card prepayment.
//
// Not a reseed: reseeding hard-deletes a store with CASCADE, taking its
// conversations, and men-demo-store can't be rebuilt from this repo at all.
// Keyed on slug: only the stores listed below, and a store that isn't in the
// database is skipped. Fills only what is empty, so edits made in the admin
// panel survive; --force overwrites them. --dry prints the plan and writes
// nothing. Idempotent: a second run reports nothing to fill.
//
// Run via: npm run backfill:agent-config [-- --dry] [-- --force]
//          (prod: backfill:prod:agent-config)

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { CLOTHING_KNOWLEDGE_DOC } from './seed/knowledge/clothing';
import { COSMETICS_KNOWLEDGE_DOC } from './seed/knowledge/cosmetics';
import { ALTAMEN_KNOWLEDGE_DOC } from './seed/knowledge/clothing-men';
import { MEN_DEMO_STORE_KNOWLEDGE_DOC, MEN_DEMO_STORE_WELCOME_LINE } from './seed/knowledge/men-demo-store';
import {
  DEMO_HANDOFF_ANNOUNCE,
  DEMO_HANDOFF_ANNOUNCE_NO_EMOJI,
  DEMO_PAYMENT_DETAILS,
  DEMO_WELCOME_LINE,
} from './seed/knowledge/demo-store-copy';

interface StorePreset {
  knowledgeDoc: string;
  welcomeLine: string;
  announceText: string;
  paymentDetails: string;
  /** brand_config.disallowedPhrases, written only when the store has none. */
  disallowedPhrases?: string[];
}

const PRESETS: Record<string, StorePreset> = {
  'demo-women-clothes': {
    knowledgeDoc: CLOTHING_KNOWLEDGE_DOC,
    welcomeLine: DEMO_WELCOME_LINE,
    announceText: DEMO_HANDOFF_ANNOUNCE,
    paymentDetails: DEMO_PAYMENT_DETAILS,
  },
  'showcase-women-clothes': {
    knowledgeDoc: CLOTHING_KNOWLEDGE_DOC,
    welcomeLine: DEMO_WELCOME_LINE,
    announceText: DEMO_HANDOFF_ANNOUNCE,
    paymentDetails: DEMO_PAYMENT_DETAILS,
  },
  'demo-cosmetics': {
    knowledgeDoc: COSMETICS_KNOWLEDGE_DOC,
    welcomeLine: DEMO_WELCOME_LINE,
    announceText: DEMO_HANDOFF_ANNOUNCE,
    paymentDetails: DEMO_PAYMENT_DETAILS,
  },
  'showcase-cosmetics': {
    knowledgeDoc: COSMETICS_KNOWLEDGE_DOC,
    welcomeLine: DEMO_WELCOME_LINE,
    announceText: DEMO_HANDOFF_ANNOUNCE,
    paymentDetails: DEMO_PAYMENT_DETAILS,
  },
  'demo-altamen': {
    knowledgeDoc: ALTAMEN_KNOWLEDGE_DOC,
    welcomeLine: DEMO_WELCOME_LINE,
    announceText: DEMO_HANDOFF_ANNOUNCE_NO_EMOJI,
    paymentDetails: DEMO_PAYMENT_DETAILS,
    disallowedPhrases: ['💛'],
  },
  'men-demo-store': {
    knowledgeDoc: MEN_DEMO_STORE_KNOWLEDGE_DOC,
    welcomeLine: MEN_DEMO_STORE_WELCOME_LINE,
    announceText: DEMO_HANDOFF_ANNOUNCE,
    paymentDetails: DEMO_PAYMENT_DETAILS,
  },
};

interface ConfigRow {
  tenant_id: string;
  knowledge_doc: string | null;
  brand_config: Record<string, unknown> | null;
  handoff_config: Record<string, unknown> | null;
  checkout_config: Record<string, unknown> | null;
}

const isEmpty = (v: unknown) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

async function backfill(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const force = process.argv.includes('--force');
  await AppDataSource.initialize();
  try {
    for (const [slug, preset] of Object.entries(PRESETS)) {
      const [row]: ConfigRow[] = await AppDataSource.query(
        `SELECT sc.tenant_id, sc.knowledge_doc, sc.brand_config, sc.handoff_config, sc.checkout_config
           FROM tenants t JOIN store_configs sc ON sc.tenant_id = t.id
          WHERE t.slug = $1`,
        [slug],
      );
      if (!row) {
        console.log(`${slug}: not in this database — skipped`);
        continue;
      }

      const brand = row.brand_config ?? {};
      const handoff = row.handoff_config ?? {};
      const checkout = row.checkout_config ?? {};
      const fill = (current: unknown) => force || isEmpty(current);
      const changes: string[] = [];

      const knowledgeDoc = fill(row.knowledge_doc) ? preset.knowledgeDoc : row.knowledge_doc;
      if (knowledgeDoc !== row.knowledge_doc) changes.push('store notes');
      const brandPatch: Record<string, unknown> = {};
      if (fill(brand.welcomeLine) && brand.welcomeLine !== preset.welcomeLine) {
        brandPatch.welcomeLine = preset.welcomeLine;
        changes.push('welcome line');
      }
      if (preset.disallowedPhrases && fill(brand.disallowedPhrases)) {
        brandPatch.disallowedPhrases = preset.disallowedPhrases;
        changes.push('disallowed phrases');
      }
      const handoffPatch: Record<string, unknown> = {};
      if (fill(handoff.announceText) && handoff.announceText !== preset.announceText) {
        handoffPatch.announceText = preset.announceText;
        changes.push('handoff line');
      }
      const checkoutPatch: Record<string, unknown> = {};
      if (fill(checkout.paymentDetails) && checkout.paymentDetails !== preset.paymentDetails) {
        checkoutPatch.paymentDetails = preset.paymentDetails;
        changes.push('payment details');
      }

      if (changes.length === 0) {
        console.log(`${slug}: nothing to fill`);
        continue;
      }
      console.log(`${slug}: ${dry ? 'would fill' : 'filling'} ${changes.join(', ')}`);
      if (dry) continue;
      await AppDataSource.query(
        `UPDATE store_configs
            SET knowledge_doc = $2,
                brand_config = COALESCE(brand_config, '{}'::jsonb) || $3::jsonb,
                handoff_config = COALESCE(handoff_config, '{}'::jsonb) || $4::jsonb,
                checkout_config = COALESCE(checkout_config, '{}'::jsonb) || $5::jsonb,
                updated_at = now()
          WHERE tenant_id = $1`,
        [row.tenant_id, knowledgeDoc, JSON.stringify(brandPatch), JSON.stringify(handoffPatch), JSON.stringify(checkoutPatch)],
      );
    }
  } finally {
    await AppDataSource.destroy();
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
