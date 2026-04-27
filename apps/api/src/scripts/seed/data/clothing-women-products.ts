// Women's clothing demo catalog — 18 products, 100 variants.
// Lifted verbatim from the legacy apps/api/src/scripts/seed-demo-tenant.ts so
// the demo-women-clothes tenant ships with the same products the old `demo`
// tenant had. Image files live in apps/api/test-assets/ (committed to repo).
//
// Diversity:
//  - most cover both color + size
//  - p-02, p-06, p-12, p-13, p-14 are single-color multi-size
//  - p-15 is multi-color one-size
//  - p-17 is single-variant (auto-select path)
//  - p-04 has Blue M deliberately out-of-stock (variant_not_available path)

import { ProductSpec } from './types';

export const CLOTHING_WOMEN_PRODUCTS: ProductSpec[] = [
  // ── Zara (6) ────────────────────────────────────────────────
  {
    externalId: 'demo-p-01', title: 'Zara Базова футболка oversize', brand: 'Zara',
    category: 'Футболки', description: "М'яка бавовна, класичний oversize-крій.",
    imageFile: 'demo-p-01.jpg',
    variants: [
      { color: 'White', size: 'S', price: 799, stock: 15 },
      { color: 'White', size: 'M', price: 799, stock: 12 },
      { color: 'White', size: 'L', price: 799, stock: 10 },
      { color: 'Black', size: 'S', price: 799, stock: 15 },
      { color: 'Black', size: 'M', price: 799, stock: 8 },
      { color: 'Black', size: 'L', price: 799, stock: 5 },
      { color: 'Black', size: 'XL', price: 799, stock: 0 },
    ],
  },
  {
    externalId: 'demo-p-02', title: 'Zara Кремова блуза з рюшами', brand: 'Zara',
    category: 'Сорочки', description: 'Шифонова блуза на літо.',
    imageFile: 'demo-p-02.jpg',
    variants: [
      { color: 'Cream', size: 'S', price: 1299, stock: 5 },
      { color: 'Cream', size: 'M', price: 1299, stock: 5 },
      { color: 'Cream', size: 'L', price: 1299, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-03', title: 'Zara Спідниця плісе', brand: 'Zara',
    category: 'Спідниці', description: 'Плісерована спідниця міді.',
    imageFile: 'demo-p-03.jpg',
    variants: [
      { color: 'Black', size: 'XS', price: 1599, stock: 5 },
      { color: 'Black', size: 'S', price: 1599, stock: 15 },
      { color: 'Black', size: 'M', price: 1599, stock: 15 },
      { color: 'Black', size: 'L', price: 1599, stock: 5 },
      { color: 'Navy', size: 'S', price: 1599, stock: 15 },
      { color: 'Navy', size: 'M', price: 1599, stock: 15 },
      { color: 'Navy', size: 'L', price: 1599, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-04', title: 'Zara Сорочка оверсайз', brand: 'Zara',
    category: 'Сорочки', description: 'Класична сорочка oversize.',
    imageFile: 'demo-p-04.jpg',
    variants: [
      { color: 'White', size: 'S', price: 1199, stock: 5 },
      { color: 'White', size: 'M', price: 1199, stock: 15 },
      { color: 'White', size: 'L', price: 1199, stock: 5 },
      { color: 'Blue', size: 'S', price: 1199, stock: 15 },
      { color: 'Blue', size: 'M', price: 1199, stock: 0 },   // deliberately OOS
      { color: 'Blue', size: 'L', price: 1199, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-05', title: 'Zara Міні-спідниця джинсова', brand: 'Zara',
    category: 'Спідниці', description: 'Коротка джинсова спідниця.',
    imageFile: 'demo-p-05.jpg',
    variants: [
      { color: 'Light Blue', size: 'XS', price: 999, stock: 5 },
      { color: 'Light Blue', size: 'S', price: 999, stock: 15 },
      { color: 'Light Blue', size: 'M', price: 999, stock: 15 },
      { color: 'Dark Blue', size: 'XS', price: 999, stock: 5 },
      { color: 'Dark Blue', size: 'S', price: 999, stock: 15 },
      { color: 'Dark Blue', size: 'M', price: 999, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-06', title: 'Zara Футболка з принтом', brand: 'Zara',
    category: 'Футболки', description: 'Бавовняна футболка з графічним принтом.',
    imageFile: 'demo-p-06.webp',
    variants: [
      { color: 'White', size: 'S', price: 599, stock: 15 },
      { color: 'White', size: 'M', price: 599, stock: 15 },
      { color: 'White', size: 'L', price: 599, stock: 15 },
    ],
  },

  // ── H&M (6) ─────────────────────────────────────────────────
  {
    externalId: 'demo-p-07', title: 'H&M Базові джинси скіні', brand: 'H&M',
    category: 'Джинси', description: 'Тягнучий деніма, середня посадка.',
    imageFile: 'demo-p-07.avif',
    variants: [
      { color: 'Blue', size: 'W26', price: 1099, stock: 15 },
      { color: 'Blue', size: 'W28', price: 1099, stock: 15 },
      { color: 'Blue', size: 'W30', price: 1099, stock: 5 },
      { color: 'Black', size: 'W26', price: 1099, stock: 15 },
      { color: 'Black', size: 'W28', price: 1099, stock: 15 },
      { color: 'Black', size: 'W30', price: 1099, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-08', title: 'H&M Худі oversize', brand: 'H&M',
    category: 'Худі', description: 'Флісове худі з капюшоном.',
    imageFile: 'demo-p-08.avif',
    variants: [
      { color: 'Grey', size: 'S', price: 899, stock: 15 },
      { color: 'Grey', size: 'M', price: 899, stock: 15 },
      { color: 'Grey', size: 'L', price: 899, stock: 15 },
      { color: 'Pink', size: 'S', price: 899, stock: 5 },
      { color: 'Pink', size: 'M', price: 899, stock: 5 },
      { color: 'Pink', size: 'L', price: 899, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-09', title: 'H&M Світшот з логотипом', brand: 'H&M',
    category: 'Світшоти', description: 'Класичний світшот з вишитим лого.',
    imageFile: 'demo-p-09.avif',
    variants: [
      { color: 'White', size: 'S', price: 749, stock: 15 },
      { color: 'White', size: 'M', price: 749, stock: 15 },
      { color: 'White', size: 'L', price: 749, stock: 5 },
      { color: 'Black', size: 'S', price: 749, stock: 15 },
      { color: 'Black', size: 'M', price: 749, stock: 15 },
      { color: 'Black', size: 'L', price: 749, stock: 15 },
      { color: 'Black', size: 'XL', price: 749, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-10', title: 'H&M Сукня-сорочка', brand: 'H&M',
    category: 'Плаття', description: 'Легка сукня на кожен день.',
    imageFile: 'demo-p-10.jpg',
    variants: [
      { color: 'Beige', size: 'XS', price: 1399, stock: 5 },
      { color: 'Beige', size: 'S', price: 1399, stock: 15 },
      { color: 'Beige', size: 'M', price: 1399, stock: 15 },
      { color: 'Beige', size: 'L', price: 1399, stock: 5 },
      { color: 'Olive', size: 'S', price: 1399, stock: 15 },
      { color: 'Olive', size: 'M', price: 1399, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-11', title: 'H&M Джинси мом-фіт', brand: 'H&M',
    category: 'Джинси', description: 'Висока посадка, вільний крій.',
    imageFile: 'demo-p-11.avif',
    variants: [
      { color: 'Light Blue', size: 'W26', price: 1199, stock: 15 },
      { color: 'Light Blue', size: 'W28', price: 1199, stock: 15 },
      { color: 'Light Blue', size: 'W30', price: 1199, stock: 5 },
      { color: 'Medium Blue', size: 'W26', price: 1199, stock: 15 },
      { color: 'Medium Blue', size: 'W28', price: 1199, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-12', title: 'H&M Плаття міді чорне', brand: 'H&M',
    category: 'Плаття', description: 'Класичне чорне плаття.',
    imageFile: 'demo-p-12.avif',
    variants: [
      { color: 'Black', size: 'S', price: 1599, stock: 5 },
      { color: 'Black', size: 'M', price: 1599, stock: 5 },
      { color: 'Black', size: 'L', price: 1599, stock: 5 },
    ],
  },

  // ── Mango (6) ───────────────────────────────────────────────
  {
    externalId: 'demo-p-13', title: 'Mango Шкіряна куртка байкер', brand: 'Mango',
    category: 'Куртки', description: 'Штучна шкіра, короткий фасон.',
    imageFile: 'demo-p-13.avif',
    variants: [
      { color: 'Black', size: 'S', price: 2899, stock: 5 },
      { color: 'Black', size: 'M', price: 2899, stock: 5 },
      { color: 'Black', size: 'L', price: 2899, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-14', title: 'Mango Тренчкот класичний', brand: 'Mango',
    category: 'Куртки', description: 'Двобортний тренч з поясом.',
    imageFile: 'demo-p-14.avif',
    variants: [
      { color: 'Beige', size: 'S', price: 3499, stock: 5 },
      { color: 'Beige', size: 'M', price: 3499, stock: 5 },
      { color: 'Beige', size: 'L', price: 3499, stock: 5 },
      { color: 'Beige', size: 'XL', price: 3499, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-15', title: 'Mango Блейзер oversize', brand: 'Mango',
    category: 'Блейзери', description: 'Подвійна застібка, one-size.',
    imageFile: 'demo-p-15.avif',
    variants: [
      { color: 'Black', size: null, price: 2299, stock: 15 },
      { color: 'Navy', size: null, price: 2299, stock: 15 },
      { color: 'Beige', size: null, price: 2299, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-16', title: 'Mango Сукня міді', brand: 'Mango',
    category: 'Сукні', description: 'Трикотажна сукня з розрізом.',
    imageFile: 'demo-p-16.avif',
    variants: [
      { color: 'Red', size: 'XS', price: 1899, stock: 5 },
      { color: 'Red', size: 'S', price: 1899, stock: 15 },
      { color: 'Red', size: 'M', price: 1899, stock: 15 },
      { color: 'Red', size: 'L', price: 1899, stock: 5 },
      { color: 'Black', size: 'S', price: 1899, stock: 15 },
      { color: 'Black', size: 'M', price: 1899, stock: 15 },
      { color: 'Black', size: 'L', price: 1899, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-17', title: 'Mango Сукня коктейльна', brand: 'Mango',
    category: 'Сукні', description: 'Лімітована колекція, залишок тільки розміру M.',
    imageFile: 'demo-p-17.webp',
    variants: [
      { color: 'Black', size: 'M', price: 2499, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-18', title: 'Mango Штани палацо', brand: 'Mango',
    category: 'Штани', description: 'Широкі штани з високою посадкою.',
    imageFile: 'demo-p-18.avif',
    variants: [
      { color: 'Black', size: 'S', price: 1799, stock: 15 },
      { color: 'Black', size: 'M', price: 1799, stock: 15 },
      { color: 'Black', size: 'L', price: 1799, stock: 5 },
      { color: 'White', size: 'S', price: 1799, stock: 15 },
      { color: 'White', size: 'M', price: 1799, stock: 15 },
    ],
  },
];

export interface SizeChartSpec {
  name: string;
  imageFile: string;
  brands: string[];
  categories: string[];
  isDefault: boolean;
}

export const CLOTHING_SIZE_CHARTS: SizeChartSpec[] = [
  {
    name: 'Zara footwear-free sizing',
    imageFile: 'demo-chart-zara.png',
    brands: ['zara'],
    categories: ['футболки', 'сорочки', 'спідниці'],
    isDefault: false,
  },
  {
    name: 'H&M casual sizes',
    imageFile: 'demo-chart-hm.png',
    brands: ['h&m'],
    categories: ['джинси', 'худі', 'світшоти'],
    isDefault: false,
  },
  {
    name: "Generic women's chart",
    imageFile: 'demo-chart-generic.png',
    brands: [],
    categories: [],
    isDefault: true,
  },
];
