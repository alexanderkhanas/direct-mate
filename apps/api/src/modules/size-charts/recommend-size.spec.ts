import { parseNumericSizeChart, recommendSize } from './recommend-size';

const CHART = {
  S: { heightMin: 165, heightMax: 175, weightMin: 55, weightMax: 70 },
  M: { heightMin: 170, heightMax: 180, weightMin: 65, weightMax: 80 },
  L: { heightMin: 175, heightMax: 185, weightMin: 75, weightMax: 90 },
};

describe('recommendSize', () => {
  it('picks the first size where both height and weight fit', () => {
    expect(recommendSize({ heightCm: 182, weightKg: 85 }, CHART)).toBe('L');
  });

  it('prefers a two-point match over an earlier one-point match', () => {
    expect(recommendSize({ heightCm: 172, weightKg: 78 }, CHART)).toBe('M');
  });

  it('falls back to the closest height when nothing fits', () => {
    expect(recommendSize({ heightCm: 200, weightKg: 140 }, CHART)).toBe('L');
  });

  it('returns null without measurements', () => {
    expect(recommendSize({}, CHART)).toBeNull();
  });
});

describe('parseNumericSizeChart', () => {
  it('keeps valid ranges and drops malformed ones', () => {
    expect(parseNumericSizeChart({ ...CHART, XL: { heightMin: '180' } })).toEqual(CHART);
  });

  it('returns null for anything that is not a chart', () => {
    expect(parseNumericSizeChart(null)).toBeNull();
    expect(parseNumericSizeChart([])).toBeNull();
    expect(parseNumericSizeChart({ M: 'big' })).toBeNull();
  });
});
