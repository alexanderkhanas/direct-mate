// Cosmetics demo catalog — 10 products (12 variants total).
// Image files live under apps/api/test-assets/cosmetics/ (downloaded once
// from public CDNs, committed to repo). Original CDN URLs are preserved as
// comments next to each entry for traceability if we ever need to re-fetch.
//
// Variant column reuse: cosmetics borrow `color` for type-of-product variants
// (Маска: Зволожуюча/Очищувальна/Освітлююча) and `size` for SPF levels
// (Сонцезахисний крем: SPF 30 / SPF 50). This is a known schema overload —
// see CLAUDE.md tech-debt note about renaming to attribute_1/attribute_2.

import { ProductSpec } from './types';

export const COSMETICS_PRODUCTS: ProductSpec[] = [
  {
    externalId: 'demo-cos-01',
    title: 'Крем для обличчя денний',
    brand: 'Generic',
    category: 'Креми для обличчя',
    description: 'Денний крем з SPF, зволоження + захист від синього світла.',
    imageFile: 'demo-cos-01-day-cream.jpg',
    // Source: https://u.makeup.com.ua/p/pf/pfgjmiwtp7lc.jpg
    variants: [{ color: null, size: null, price: 450, stock: 25 }],
  },
  {
    externalId: 'demo-cos-02',
    title: 'Крем для обличчя нічний',
    brand: 'Generic',
    category: 'Креми для обличчя',
    description: 'Регенеруючий нічний крем з пептидами.',
    imageFile: 'demo-cos-02-night-cream.jpg',
    // Source: https://u.makeup.com.ua/o/o8/o8sinwszebp6.jpg
    variants: [{ color: null, size: null, price: 520, stock: 20 }],
  },
  {
    externalId: 'demo-cos-03',
    title: 'Тонік для обличчя',
    brand: 'Generic',
    category: 'Тоніки',
    description: 'Тонік з гіалуроновою кислотою, без спирту.',
    imageFile: 'demo-cos-03-toner.jpg',
    // Source: https://hollyskin.com.ua/content/images/43/.../tonik-hollyskin-hyaluronic-acid.jpg
    variants: [{ color: null, size: null, price: 320, stock: 30 }],
  },
  {
    externalId: 'demo-cos-04',
    title: 'Сироватка з вітаміном С',
    brand: 'Generic',
    category: 'Сироватки',
    description: 'Освітлююча сироватка з 10% L-аскорбіновою кислотою.',
    imageFile: 'demo-cos-04-vitamin-c-serum.webp',
    // Source: https://cosibella.com.ua/.../osvitliuiucha-sirovatka-z-vitaminom-c-30ml.webp
    variants: [{ color: null, size: null, price: 580, stock: 18 }],
  },
  {
    externalId: 'demo-cos-05',
    title: 'Маска для обличчя',
    brand: 'Generic',
    category: 'Маски',
    description: 'Доступна в трьох варіантах: зволожуюча, очищувальна, освітлююча.',
    imageFile: 'demo-cos-05a-mask-hydrating.jpg',
    variants: [
      // Source: https://sane.ua/.../maska-zvolozhujucha-z-vitaminom-s-sane-40ml.jpg
      { color: 'Зволожуюча', size: null, price: 220, stock: 30, imageFile: 'demo-cos-05a-mask-hydrating.jpg' },
      // Source: https://pwa-api.eva.ua/img/512/512/resize/5/7/575473_1_1736960411.jpg
      { color: 'Очищувальна', size: null, price: 220, stock: 30, imageFile: 'demo-cos-05b-mask-cleansing.jpg' },
      // Source: https://sisters.co.ua/.../novyj-proekt-2024-12-14.jpg
      { color: 'Освітлююча', size: null, price: 240, stock: 20, imageFile: 'demo-cos-05c-mask-brightening.jpg' },
    ],
  },
  {
    externalId: 'demo-cos-06',
    title: 'Очищувальний гель',
    brand: 'Generic',
    category: 'Очищувальні засоби',
    description: 'М\'який очищувальний гель для щоденного вмивання.',
    imageFile: 'demo-cos-06-cleansing-gel.jpg',
    // Source: https://content.rozetka.com.ua/goods/images/big/429841980.jpg
    variants: [{ color: null, size: null, price: 380, stock: 22 }],
  },
  {
    externalId: 'demo-cos-07',
    title: 'Сонцезахисний крем',
    brand: 'Generic',
    category: 'Сонцезахист',
    description: 'Доступний у двох рівнях SPF — 30 та 50.',
    imageFile: 'demo-cos-07a-spf-30.jpg',
    variants: [
      // Source: https://m.media-amazon.com/images/I/51nBzpHNbdL.jpg
      { color: null, size: 'SPF 30', price: 380, stock: 25, imageFile: 'demo-cos-07a-spf-30.jpg' },
      // Source: https://media-cdn.oriflame.com/.../23378_1.png
      { color: null, size: 'SPF 50', price: 420, stock: 20, imageFile: 'demo-cos-07b-spf-50.png' },
    ],
  },
  {
    externalId: 'demo-cos-08',
    title: 'Засіб для зняття макіяжу',
    brand: 'Generic',
    category: 'Очищувальні засоби',
    description: 'Двофазний засіб для зняття макіяжу очей та обличчя.',
    imageFile: 'demo-cos-08-makeup-remover.jpg',
    // Source: https://pimg.eur.marykaycdn.com/.../J2003169-OIL-FREE-EYE-MAKEUP-REMOVER-HiRes.jpg
    variants: [{ color: null, size: null, price: 290, stock: 28 }],
  },
  {
    externalId: 'demo-cos-09',
    title: 'Крем для рук',
    brand: 'Generic',
    category: 'Догляд за тілом',
    description: 'Поживний крем для сухої шкіри рук.',
    imageFile: 'demo-cos-09-hand-cream.jpg',
    // Source: https://u.makeup.com.ua/2/2k/2kpgkgnecczi.jpg
    variants: [{ color: null, size: null, price: 180, stock: 35 }],
  },
  {
    externalId: 'demo-cos-10',
    title: 'Бальзам для губ',
    brand: 'Generic',
    category: 'Догляд за губами',
    description: 'Зволожуючий бальзам з відтінком та натуральною олією.',
    imageFile: 'demo-cos-10-lip-balm.jpg',
    // Source: https://prokrasa.com.ua/files/.../balzam-dlya-gub-lipss-rose.jpg
    variants: [{ color: null, size: null, price: 150, stock: 40 }],
  },
];
