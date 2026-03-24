#!/usr/bin/env ts-node
/**
 * Conversation Replay Script
 *
 * Usage:
 *   npm run replay                  # replay last conversation
 *   npm run replay -- --last 3      # replay last 3 conversations
 *   npm run replay -- --id <uuid>   # replay specific conversation
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.resolve(__dirname, '../../conversations.log');

interface LogEntry {
  ts: string;
  event: string;
  conversationId: string;
  inbound?: string;
  outbound?: string;
  classification?: {
    intent: string;
    entities: Record<string, string>;
    stage: string;
    sentiment: string;
    confidence: number;
    dialogueAct: string;
    action: string;
    slotAction?: string;
  };
  memory?: Record<string, any>;
  keywords?: string[];
  found?: number | boolean;
  templateId?: string;
  reason?: string;
  classifierSaid?: string;
  engineDid?: string;
  selectionState?: string;
  primarySaysEscalate?: boolean;
  fallbackIntent?: string;
  fallbackAction?: string;
  [key: string]: any;
}

// ─── Colors ──────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

function truncate(s: string, len: number): string {
  if (!s) return '-';
  const single = s.replace(/\n/g, ' ');
  return single.length > len ? single.slice(0, len) + '...' : single;
}

function shortId(id: string): string {
  return id ? id.slice(0, 8) : '-';
}

function formatEntities(entities: Record<string, string>): string {
  const parts = Object.entries(entities)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length > 0 ? `{${parts.join(', ')}}` : '';
}

function printState(memory: Record<string, any> | undefined): void {
  if (!memory) return;
  const sel = memory.selectionState || '-';
  const prod = memory.selectedProductTitle || '-';
  const variant = memory.selectedVariantName || '-';
  const prodId = memory.selectedProductId ? `✓` : `${c.red}null${c.reset}`;

  console.log(
    `    ${c.gray}→ STATE: ${c.cyan}${sel}${c.reset} | product=${c.bold}${prod}${c.reset} | variant=${c.bold}${variant}${c.reset} | prodId=${prodId}`,
  );

  // Show key memory fields
  if (memory.lastAction || memory.awaitingField) {
    console.log(
      `    ${c.gray}  MEMORY: lastAction=${memory.lastAction || '-'} awaiting=${memory.awaitingField || '-'}${c.reset}`,
    );
  }

  // Show presented products if they exist
  if (memory.lastPresentedProducts?.length) {
    const names = memory.lastPresentedProducts.map((p: any) => p.title);
    console.log(
      `    ${c.gray}  PRODUCTS: [${names.join(', ')}]${c.reset}`,
    );
  }

  // Show available variants if set
  if (Array.isArray(memory.availableVariants) && memory.availableVariants.length > 0) {
    const varNames = memory.availableVariants.map((v: any) => v.name);
    console.log(
      `    ${c.gray}  VARIANTS: [${varNames.join(', ')}]${c.reset}`,
    );
  }

  // Bug detection
  if (
    (sel === 'awaiting_confirmation' || sel === 'confirmed') &&
    !memory.selectedProductId
  ) {
    console.log(
      `    ${c.bgRed}${c.white} ❌ BUG: selectionState=${sel} but selectedProductId is null ${c.reset}`,
    );
  }

  if (
    sel === 'confirmed' &&
    !memory.selectedVariantId
  ) {
    console.log(
      `    ${c.bgYellow}${c.white} ⚠ WARN: selectionState=confirmed but selectedVariantId is null ${c.reset}`,
    );
  }
}

function replayConversation(events: LogEntry[]): void {
  const first = events[0];
  const ts = new Date(first.ts).toLocaleString('uk-UA', {
    timeZone: 'Europe/Kyiv',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  console.log(
    `\n${c.bold}${c.blue}=== Conversation ${shortId(first.conversationId)} (${ts}) ===${c.reset}`,
  );

  let msgNum = 0;
  let lastTemplateId: string | undefined;
  let templateRepeatCount = 0;

  for (const entry of events) {
    switch (entry.event) {
      case 'classification': {
        msgNum++;
        const cl = entry.classification!;
        const entities = formatEntities(cl.entities);
        const confColor = cl.confidence >= 0.9 ? c.green : cl.confidence >= 0.7 ? c.yellow : c.red;

        console.log(
          `\n${c.bold}[${msgNum}] 👤 "${truncate(entry.inbound || '', 80)}"${c.reset}`,
        );
        console.log(
          `    CLASSIFY: intent=${c.cyan}${cl.intent}${c.reset} slot=${c.magenta}${cl.slotAction || '?'}${c.reset} act=${cl.dialogueAct} ${confColor}conf=${cl.confidence}${c.reset}`,
        );
        if (entities) {
          console.log(`    ENTITIES: ${c.yellow}${entities}${c.reset}`);
        }
        break;
      }

      case 'product_search': {
        const count = typeof entry.found === 'number' ? entry.found : entry.found ? '✓' : '0';
        console.log(
          `    ${c.gray}SEARCH: ${count} products found (kw: ${(entry.keywords || []).join(', ')})${c.reset}`,
        );
        break;
      }

      case 'flow_override': {
        console.log(
          `    ${c.bgYellow}${c.white} ⛔ OVERRIDE: ${entry.reason} | classifier=${entry.classifierSaid} → engine=${entry.engineDid} ${c.reset}`,
        );
        break;
      }

      case 'reply': {
        const tplId = entry.templateId || '?';
        const isAiFallback = tplId === 'ai_fallback';
        const tplLabel = isAiFallback
          ? `${c.yellow}ai_fallback${c.reset}`
          : `${c.green}${shortId(tplId)}${c.reset}`;

        // Detect template repetition
        if (tplId === lastTemplateId && !isAiFallback) {
          templateRepeatCount++;
          if (templateRepeatCount >= 2) {
            console.log(
              `    ${c.bgRed}${c.white} ❌ REPEATED TEMPLATE: ${shortId(tplId)} used ${templateRepeatCount + 1}x in a row ${c.reset}`,
            );
          }
        } else {
          templateRepeatCount = 0;
        }
        lastTemplateId = tplId;

        console.log(
          `    TEMPLATE: ${tplLabel}`,
        );
        console.log(
          `    💬 ${c.dim}"${truncate(entry.outbound || '', 100)}"${c.reset}`,
        );
        printState(entry.memory);
        break;
      }

      case 'handoff': {
        console.log(
          `    ${c.bgRed}${c.white} 🚨 HANDOFF: ${entry.reason} ${c.reset}`,
        );
        break;
      }

      case 'handoff_verification': {
        console.log(
          `    ${c.yellow}HANDOFF_VERIFY: primary_escalate=${entry.primarySaysEscalate} fallback_intent=${entry.fallbackIntent} fallback_action=${entry.fallbackAction}${c.reset}`,
        );
        break;
      }
    }
  }

  console.log(`\n${c.gray}${'─'.repeat(60)}${c.reset}`);
}

// ─── Main ────────────────────────────────────────────────────────

function main(): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`Log file not found: ${LOG_FILE}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let targetId: string | undefined;
  let lastN = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) {
      targetId = args[i + 1];
      i++;
    } else if (args[i] === '--last' && args[i + 1]) {
      lastN = parseInt(args[i + 1], 10) || 1;
      i++;
    } else if (args[i] === '--all') {
      lastN = 999;
    }
  }

  const raw = fs.readFileSync(LOG_FILE, 'utf-8');
  const lines = raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as LogEntry;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as LogEntry[];

  if (lines.length === 0) {
    console.log('No conversation logs found.');
    process.exit(0);
  }

  // Group by conversationId, preserving order
  const grouped = new Map<string, LogEntry[]>();
  for (const entry of lines) {
    if (!entry.conversationId) continue;
    if (!grouped.has(entry.conversationId)) {
      grouped.set(entry.conversationId, []);
    }
    grouped.get(entry.conversationId)!.push(entry);
  }

  if (targetId) {
    // Find by ID (partial match)
    const match = [...grouped.entries()].find(([id]) =>
      id.startsWith(targetId!),
    );
    if (!match) {
      console.error(`No conversation found matching ID: ${targetId}`);
      process.exit(1);
    }
    replayConversation(match[1]);
  } else {
    // Last N conversations
    const convIds = [...grouped.keys()];
    const selected = convIds.slice(-lastN);
    console.log(
      `${c.bold}Replaying ${selected.length} conversation(s) from ${convIds.length} total${c.reset}`,
    );
    for (const id of selected) {
      replayConversation(grouped.get(id)!);
    }
  }
}

main();
