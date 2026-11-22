import type { SizeChartTable } from '../size-chart-table';

/** Size chart tables for tests. */

/** The design's dress chart: XS–XL by chest, waist, hips. */
export const DRESS_TABLE: SizeChartTable = {
  measurements: [
    { key: 'chest', label: 'Обхват грудей', unit: 'cm' },
    { key: 'waist', label: 'Обхват талії', unit: 'cm' },
    { key: 'hips', label: 'Обхват стегон', unit: 'cm' },
  ],
  rows: [
    ['XS', 80, 84, 62, 66, 86, 90],
    ['S', 84, 88, 66, 70, 90, 94],
    ['M', 88, 92, 70, 74, 94, 98],
    ['L', 92, 96, 74, 78, 98, 102],
    ['XL', 96, 100, 78, 82, 102, 106],
  ].map(([size, c1, c2, w1, w2, h1, h2]) => ({
    size: size as string,
    values: {
      chest: { min: c1 as number, max: c2 as number },
      waist: { min: w1 as number, max: w2 as number },
      hips: { min: h1 as number, max: h2 as number },
    },
  })),
  uncertain: [],
};

/**
 * A bra chart as Gorsenia prints it: underbust bands 65–95 (band ± 2 cm) × cups AA–H, the bust over the cup from band
 * + 10 cm in 2 cm steps; no 95AA. One row per band and cup, band by band.
 */
export const BRA_TABLE: SizeChartTable = {
  measurements: [
    { key: 'underbust', label: 'Обхват під грудьми', unit: 'cm' },
    { key: 'chest', label: 'Обхват грудей', unit: 'cm' },
  ],
  rows: [65, 70, 75, 80, 85, 90, 95].flatMap((band) =>
    ['AA', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
      .map((cup, i) => ({ cup, i }))
      .filter(({ cup }) => !(band === 95 && cup === 'AA'))
      .map(({ cup, i }) => ({
        size: `${band}${cup}`,
        values: { underbust: { min: band - 2, max: band + 2 }, chest: { min: band + 10 + i * 2, max: band + 12 + i * 2 } },
      })),
  ),
  uncertain: [],
};

/** Men's trousers in Ukrainian sizes 48–58, by waist and hips. */
export const TROUSERS_TABLE: SizeChartTable = {
  measurements: [
    { key: 'waist', label: 'Обхват талії', unit: 'cm' },
    { key: 'hips', label: 'Обхват стегон', unit: 'cm' },
  ],
  rows: [48, 50, 52, 54, 56, 58].map((size, i) => ({
    size: String(size),
    values: { waist: { min: 82 + i * 4, max: 85 + i * 4 }, hips: { min: 98 + i * 4, max: 101 + i * 4 } },
  })),
  uncertain: [],
};

/** A table of sizes by height (cm) and weight (kg), as Claude saves one from what the owner said. */
function heightWeight(rows: Array<[size: string, h1: number, h2: number, w1: number, w2: number]>): SizeChartTable {
  return {
    measurements: [
      { key: 'height', label: 'Зріст', unit: 'cm' },
      { key: 'weight', label: 'Вага', unit: 'kg' },
    ],
    rows: rows.map(([size, h1, h2, w1, w2]) => ({
      size,
      values: { height: { min: h1, max: h2 }, weight: { min: w1, max: w2 } },
    })),
    uncertain: [],
  };
}

/** A menswear store's clothes chart as Claude saved it: S–3XL, with XXL and XXXL repeated under their other names. */
export const MENSWEAR_CLOTHES_TABLE = heightWeight([
  ['S', 168, 176, 60, 70],
  ['M', 174, 182, 70, 78],
  ['L', 178, 186, 78, 86],
  ['XL', 180, 190, 86, 95],
  ['2XL', 183, 193, 95, 105],
  ['XXL', 183, 193, 95, 105],
  ['3XL', 185, 195, 105, 115],
  ['XXXL', 185, 195, 105, 115],
]);

/** The same store's trousers chart: two size systems in one table, 42–58 and then jeans 30–38. */
export const MENSWEAR_TROUSERS_TABLE = heightWeight([
  ['42', 160, 168, 50, 56],
  ['44', 164, 172, 55, 62],
  ['46', 168, 176, 60, 70],
  ['48', 174, 182, 70, 78],
  ['50', 178, 186, 78, 86],
  ['52', 180, 190, 86, 95],
  ['54', 183, 193, 95, 105],
  ['56', 185, 195, 105, 115],
  ['58', 186, 196, 115, 125],
  ['30', 168, 176, 60, 67],
  ['31', 170, 178, 66, 72],
  ['32', 174, 182, 71, 78],
  ['33', 176, 184, 77, 82],
  ['34', 178, 186, 81, 87],
  ['38', 182, 192, 95, 105],
]);
