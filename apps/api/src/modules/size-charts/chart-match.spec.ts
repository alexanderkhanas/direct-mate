import { formatRange, matchSize } from './chart-match';
import { DRESS_TABLE, TROUSERS_TABLE } from './__fixtures__/tables';

describe('matchSize', () => {
  it('picks the size whose ranges hold every measurement', () => {
    expect(matchSize(DRESS_TABLE, { chest: 86, waist: 68, hips: 92 })).toEqual({
      kind: 'size',
      size: 'S',
      matchedOn: ['chest', 'waist', 'hips'],
      outside: [],
    });
  });

  it('works for number sizes', () => {
    expect(matchSize(TROUSERS_TABLE, { waist: 91, hips: 107 })).toMatchObject({ kind: 'size', size: '52' });
    expect(matchSize(TROUSERS_TABLE, { waist: 100 })).toMatchObject({ kind: 'size', size: '56', matchedOn: ['waist'] });
  });

  it('prefers the size holding the most measurements and reports the ones outside it', () => {
    const match = matchSize(DRESS_TABLE, { chest: 90, waist: 72, hips: 100 });
    expect(match).toMatchObject({ kind: 'size', size: 'M' });
    expect(match.kind === 'size' && match.outside).toEqual([{ key: 'hips', value: 100, range: { min: 94, max: 98 } }]);
  });

  it('gives both sizes, the larger first choice, when a value sits on the boundary', () => {
    expect(matchSize(DRESS_TABLE, { chest: 88 })).toMatchObject({ kind: 'size', size: 'M', between: ['S', 'M'] });
  });

  it('gives both sizes when the measurements split between two neighbours', () => {
    // Chest says M, hips say L, by about the same margin.
    expect(matchSize(DRESS_TABLE, { chest: 91, hips: 99 })).toMatchObject({ kind: 'size', size: 'L', between: ['M', 'L'] });
  });

  it('takes the nearest size when no range holds a value', () => {
    expect(matchSize(TROUSERS_TABLE, { waist: 80 })).toMatchObject({
      kind: 'size',
      size: '48',
      outside: [{ key: 'waist', value: 80, range: { min: 82, max: 85 } }],
    });
    // 85.5 is in the gap between 48 (82–85) and 50 (86–89): both fit about as well.
    expect(matchSize(TROUSERS_TABLE, { waist: 85.5 })).toMatchObject({ kind: 'size', size: '50', between: ['48', '50'] });
  });

  it('breaks a tie toward the larger size', () => {
    // Chest says S, hips say L, equally far: never the smaller size with the hips 6 cm over it.
    const match = matchSize(DRESS_TABLE, { chest: 86, hips: 100 });
    expect(match).toMatchObject({ kind: 'size', size: 'L' });
    expect(match.kind === 'size' && match.between).toBeUndefined();
    expect(match.kind === 'size' && match.outside).toEqual([{ key: 'chest', value: 86, range: { min: 92, max: 96 } }]);
  });

  it('moves up a size when one measurement is well above the best match', () => {
    // Chest and waist fit M; hips 103 are over M by more than a size and over L by a quarter step.
    const match = matchSize(DRESS_TABLE, { chest: 90, waist: 72, hips: 103 });
    expect(match).toMatchObject({ kind: 'size', size: 'L' });
    expect(match.kind === 'size' && match.outside.map((o) => o.key)).toEqual(['chest', 'waist', 'hips']);
  });

  it('says so when the measurements are beyond the chart, instead of naming the end size', () => {
    expect(matchSize(DRESS_TABLE, { chest: 120, waist: 100, hips: 125 })).toEqual({
      kind: 'out_of_range',
      matchedOn: ['chest', 'waist', 'hips'],
    });
    // One measurement far past the largest size is enough.
    expect(matchSize(DRESS_TABLE, { chest: 98, hips: 130 })).toMatchObject({ kind: 'out_of_range' });
    // Just past XL still gets XL, with the measurement flagged.
    expect(matchSize(DRESS_TABLE, { chest: 101 })).toMatchObject({ kind: 'size', size: 'XL' });
  });

  it('judges the edge of the chart by the farthest measurement, not the sum', () => {
    const toL = { ...DRESS_TABLE, rows: DRESS_TABLE.rows.slice(0, 4) };
    // Each half a step above L: close enough to recommend L.
    expect(matchSize(toL, { chest: 98, waist: 80, hips: 104 })).toMatchObject({ kind: 'size', size: 'L' });
  });

  it("returns none when no given measurement is on the chart", () => {
    expect(matchSize(DRESS_TABLE, { height: 170, weight: 60 })).toEqual({ kind: 'none' });
    expect(matchSize(DRESS_TABLE, {})).toEqual({ kind: 'none' });
  });

  it('formats ranges and single values', () => {
    expect(formatRange({ min: 84, max: 88 })).toBe('84–88');
    expect(formatRange({ min: 25.5, max: 25.5 })).toBe('25.5');
  });
});
