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
