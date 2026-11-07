import { IG_TEXT_LIMIT_BYTES, splitForInstagram } from './instagram-sender.service';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('splitForInstagram', () => {
  it('leaves a message that fits alone', () => {
    expect(splitForInstagram('  Так, є в L — 3300 грн.  ')).toEqual(['Так, є в L — 3300 грн.']);
  });

  it("splits Ukrainian text by Meta's byte limit, not by characters, at a paragraph or sentence", () => {
    const paragraph = 'Сорочка льон, чорна, L — 3300 грн. Є в наявності, відправимо завтра. ';
    const text = `${paragraph.repeat(6).trim()}\n\n${paragraph.repeat(4).trim()}`;
    expect(text.length).toBeLessThan(1000); // fits by characters…
    const parts = splitForInstagram(text);

    expect(parts.length).toBeGreaterThan(1); // …but not by bytes
    for (const part of parts) {
      expect(bytes(part)).toBeLessThanOrEqual(IG_TEXT_LIMIT_BYTES);
      expect(part).toMatch(/[.!?]$/);
    }
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('cuts inside a word only when there is nowhere else to cut', () => {
    const parts = splitForInstagram('я'.repeat(700));
    expect(parts.map(bytes)).toEqual([1000, 400]);
  });
});
