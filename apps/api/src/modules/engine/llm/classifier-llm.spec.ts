/**
 * The Anthropic Messages API is stricter than Chat Completions in three ways our
 * real conversation data violates. OpenAI silently tolerates all three; Anthropic
 * returns 400. If these are wrong, an A/B run fails with transport errors that
 * look like "the model is bad" — so pin them deterministically, before spending
 * a single API call.
 */
import { normalizeForAnthropic, isAnthropicModel } from './classifier-llm';

describe('isAnthropicModel', () => {
  it.each(['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-4-8'])(
    'routes %s to Anthropic',
    (m) => expect(isAnthropicModel(m)).toBe(true),
  );

  // The fallback model MUST stay on OpenAI even when the primary classifier is
  // Claude — classifyWithFallback swaps in gpt-5.4 for the second-opinion pass.
  it.each(['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.6-luna', 'gpt-4o'])(
    'routes %s to OpenAI',
    (m) => expect(isAnthropicModel(m)).toBe(false),
  );
});

describe('normalizeForAnthropic', () => {
  it('drops empty and whitespace-only turns', () => {
    // `messages.text` is nullable in our schema and the classifier sends
    // `msg.text ?? ''` — an image-only inbound message produces exactly this.
    expect(
      normalizeForAnthropic([
        { role: 'user', content: 'привіт' },
        { role: 'assistant', content: '' },
        { role: 'user', content: '   ' },
        { role: 'user', content: 'є розмір M?' },
      ]),
    ).toEqual([{ role: 'user', content: 'привіт\nє розмір M?' }]);
  });

  it('merges consecutive same-role turns', () => {
    // A debounced burst ("Привіт" + "є M?") lands as two user rows in the DB.
    expect(
      normalizeForAnthropic([
        { role: 'user', content: 'Привіт' },
        { role: 'user', content: 'є M?' },
        { role: 'assistant', content: 'Так, є' },
        { role: 'assistant', content: 'Оформлюємо?' },
        { role: 'user', content: 'так' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Привіт\nє M?' },
      { role: 'assistant', content: 'Так, є\nОформлюємо?' },
      { role: 'user', content: 'так' },
    ]);
  });

  it('drops a leading assistant turn so the list opens with user', () => {
    // Conversations we open with a welcome message start with assistant.
    expect(
      normalizeForAnthropic([
        { role: 'assistant', content: 'Вітаю, з вами АІ асистент' },
        { role: 'user', content: 'хочу джинси' },
      ]),
    ).toEqual([{ role: 'user', content: 'хочу джинси' }]);
  });

  it('drops a leading assistant run that only becomes leading after empties are removed', () => {
    // Ordering matters: filter empties FIRST, then the leading-assistant drop.
    expect(
      normalizeForAnthropic([
        { role: 'user', content: '' },
        { role: 'assistant', content: 'Вітаю' },
        { role: 'user', content: 'привіт' },
      ]),
    ).toEqual([{ role: 'user', content: 'привіт' }]);
  });

  it('preserves an already-valid alternating list', () => {
    const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'хочу джинси' },
      { role: 'assistant', content: 'Є S, M, L' },
      { role: 'user', content: 'M' },
    ];
    expect(normalizeForAnthropic(msgs)).toEqual(msgs);
  });

  it('never emits empty content, consecutive roles, or a leading assistant', () => {
    // Property check over an adversarial list.
    const out = normalizeForAnthropic([
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'Вітаю' },
      { role: 'assistant', content: '  ' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'user', content: '' },
    ]);
    expect(out.every((m) => m.content.trim().length > 0)).toBe(true);
    expect(out.some((m, i) => i > 0 && out[i - 1].role === m.role)).toBe(false);
    expect(out[0]?.role).toBe('user');
  });

  it('returns an empty list rather than throwing when everything is dropped', () => {
    expect(
      normalizeForAnthropic([{ role: 'assistant', content: '' }]),
    ).toEqual([]);
  });
});
