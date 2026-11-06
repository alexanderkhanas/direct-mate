import { createHash } from 'crypto';
import {
  applyManualPatch,
  attributesInputHash,
  describeLook,
  mergeExtracted,
  normalizeAttributeValue,
  parseAttributePatch,
} from './product-attributes';

describe('normalizeAttributeValue', () => {
  it('accepts listed values in any case and rejects others', () => {
    expect(normalizeAttributeValue('formality', 'Святкова')).toBe('святкова');
    expect(normalizeAttributeValue('formality', 'вечірня')).toBeNull();
    expect(normalizeAttributeValue('collar', 'BUTTON-DOWN')).toBe('button-down');
  });

  it('takes colour as free text, capitalised', () => {
    expect(normalizeAttributeValue('colour', ' темно-синій ')).toBe('Темно-синій');
    expect(normalizeAttributeValue('colour', '')).toBeNull();
  });
});

describe('parseAttributePatch', () => {
  it('validates every key and value, and lets null clear one', () => {
    expect(parseAttributePatch({ formality: 'святкова', collar: null })).toEqual({
      patch: { formality: 'святкова', collar: null },
    });
    expect(parseAttributePatch({ occasion: 'весілля' })).toEqual({ error: 'Unknown attribute "occasion".' });
    expect(parseAttributePatch({ fit: 'skinny' })).toMatchObject({ error: expect.stringContaining('Allowed:') });
    expect(parseAttributePatch('святкова')).toMatchObject({ error: expect.any(String) });
  });
});

describe('manual edits and extraction', () => {
  it('marks an edited attribute manual, including a cleared one', () => {
    const { attributes, meta } = applyManualPatch(
      { formality: 'повсякденна', collar: 'кент' },
      { sources: { formality: 'ai', collar: 'ai' } },
      { formality: 'святкова', collar: null },
    );
    expect(attributes).toEqual({ formality: 'святкова' });
    expect(meta.sources).toEqual({ formality: 'manual', collar: 'manual' });
  });

  it('never overwrites a manual value, and refills everything else', () => {
    const { attributes, sources } = mergeExtracted(
      { formality: 'святкова', pattern: 'смужка' },
      { sources: { formality: 'manual', pattern: 'ai' } },
      { formality: 'повсякденна', pattern: 'однотонний', fit: 'прямий', collar: null },
    );
    expect(attributes).toEqual({ formality: 'святкова', pattern: 'однотонний', fit: 'прямий' });
    expect(sources).toMatchObject({ formality: 'manual', pattern: 'ai', fit: 'ai', collar: 'ai' });
  });

  it('replaces manual values too when asked to read the photo again', () => {
    const { attributes, sources } = mergeExtracted(
      { formality: 'святкова' },
      { sources: { formality: 'manual' } },
      { formality: 'повсякденна' },
      { overwriteManual: true },
    );
    expect(attributes.formality).toBe('повсякденна');
    expect(sources.formality).toBe('ai');
  });

  it('drops values outside the lists instead of storing them', () => {
    const { attributes } = mergeExtracted({}, null, { formality: 'вечірня', fit: 'вільний' });
    expect(attributes).toEqual({ fit: 'вільний' });
  });
});

describe('attributesInputHash', () => {
  it("matches Postgres md5(concat_ws('|', …)), which skips NULLs", () => {
    const expected = createHash('md5').update('Сорочка льон|Опис|/uploads/a.jpg').digest('hex');
    expect(
      attributesInputHash({ title: 'Сорочка льон', category: null, description: 'Опис', imageUrl: '/uploads/a.jpg' }),
    ).toBe(expected);
  });
});

describe('describeLook', () => {
  it('lists values in a fixed order and leaves colour out unless asked', () => {
    const attrs = { fit: 'прямий', colour: 'Білий', formality: 'святкова', pattern: 'однотонний' };
    expect(describeLook(attrs)).toBe('святкова, однотонний, прямий');
    expect(describeLook(attrs, { withColour: true })).toBe('святкова, однотонний, Білий, прямий');
    expect(describeLook({})).toBeUndefined();
  });
});
