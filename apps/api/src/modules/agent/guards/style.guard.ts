import type { StyleViolation } from '../agent.types';
import { BANNED_PHRASES, RUSSISMS } from './style-guide.uk';

const MAX_REPLY_CHARS = 900;

/**
 * Deterministic style check before sending: russisms, call-centre phrases,
 * and anything the store banned (`brandConfig.disallowedPhrases`, e.g. 💛 for
 * a menswear store). Adds no latency to a clean reply.
 */
export function checkStyle(text: string, opts: { disallowedPhrases: string[] }): StyleViolation[] {
  const violations: StyleViolation[] = [];
  for (const rule of [...RUSSISMS, ...BANNED_PHRASES]) {
    const match = text.match(rule.pattern);
    if (match) violations.push({ rule: rule.id, match: match[0], fix: `use ${rule.right} instead` });
  }
  // Instagram splits a text over 1,000 bytes (~500 Cyrillic characters) into
  // separate DMs; a reply this long is no longer a chat message.
  if (text.length > MAX_REPLY_CHARS) {
    violations.push({
      rule: 'too_long',
      match: `${text.length} characters`,
      fix: `keep the reply under ${MAX_REPLY_CHARS} characters: fewer products, shorter sentences`,
    });
  }
  const lower = text.toLowerCase();
  for (const phrase of opts.disallowedPhrases) {
    if (phrase && lower.includes(phrase.toLowerCase())) {
      violations.push({ rule: 'store_disallowed', match: phrase, fix: 'this store never uses it; remove it' });
    }
  }
  return violations;
}
