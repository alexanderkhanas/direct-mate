import { createElement } from 'react';
import { Zap, Ruler, Table, UserCircle, Camera, Image as ImageIcon } from 'lucide-react';
import { Scenario } from '../types';

const iconClass = 'h-3.5 w-3.5';
const ICON_QUICK = createElement(Zap, { className: iconClass, strokeWidth: 2.5 });
const ICON_RULER = createElement(Ruler, { className: iconClass });
const ICON_CHART = createElement(Table, { className: iconClass });
const ICON_HANDOFF = createElement(UserCircle, { className: iconClass });
const ICON_STORY = createElement(Camera, { className: iconClass });
const ICON_POST = createElement(ImageIcon, { className: iconClass });

// Self-hosted product photos seeded by apps/api/src/scripts/seed-demo-women-clothes.ts
// (Phase 4). Files live in apps/api/test-assets/ (committed) and are copied
// to apps/api/uploads/ on seed run. Served by the backend at /uploads/<file>;
// admin's Vite proxy forwards /uploads to the API in dev.
const IMG_ZARA_OVERSIZE = '/uploads/demo-p-01.jpg';
const IMG_TSHIRT_PRINT = '/uploads/demo-p-06.webp';
const IMG_SIZE_CHART = 'https://picsum.photos/seed/dm-zara-sizechart/600/800';

export const CLOTHING_SCENARIOS: Scenario[] = [
  {
    key: 'quick_purchase',
    title: 'Швидка покупка',
    icon: ICON_QUICK,
    turns: [
      { role: 'user', text: 'є біла футболка в розмірі M?' },
      { role: 'bot', text: 'Zara Базова футболка oversize — 799 UAH 💛', imageUrls: [IMG_ZARA_OVERSIZE] },
      { role: 'bot', text: 'Так, White, M є в наявності, бажаєте замовити?' },
      { role: 'user', text: 'так' },
      { role: 'bot', text: 'Чудово! Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Олена Коваленко, 0997654321, Львів, НП 12' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nZara Базова футболка oversize (White, M) — 799 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
  {
    key: 'size_recommender',
    title: 'Підбір розміру',
    icon: ICON_RULER,
    turns: [
      { role: 'user', text: 'хочу футболку' },
      { role: 'bot', text: 'Які у вас параметри? Зріст і вага, щоб підібрати розмір 💛' },
      { role: 'user', text: '170см, 60кг' },
      { role: 'bot', text: 'Рекомендую M. Ось варіанти:' },
      { role: 'bot', text: 'Zara Базова футболка oversize — 799 UAH', imageUrls: [IMG_ZARA_OVERSIZE] },
      { role: 'bot', text: 'Zara Футболка з принтом — 599 UAH', imageUrls: [IMG_TSHIRT_PRINT] },
      { role: 'user', text: 'дякую, беру першу' },
      { role: 'bot', text: 'Чудово! Zara Базова футболка oversize (M) — 799 UAH. Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Марія Шевченко, 0501234567, Київ, НП 5' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nZara Базова футболка oversize (M) — 799 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
  {
    key: 'size_chart_request',
    title: 'Розмірна сітка',
    icon: ICON_CHART,
    turns: [
      { role: 'user', text: 'а розмірна сітка Zara є?' },
      { role: 'bot', text: 'Ось розмірна сітка Zara 💛', imageUrls: [IMG_SIZE_CHART] },
      { role: 'user', text: 'дякую, тоді чорну футболку в розмірі M' },
      { role: 'bot', text: 'Zara Базова футболка oversize (Black, M) — 799 UAH — в наявності 💛', imageUrls: [IMG_ZARA_OVERSIZE] },
      { role: 'bot', text: 'Оформляємо?' },
      { role: 'user', text: 'так' },
      { role: 'bot', text: 'Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Ірина Бондаренко, 0671234567, Харків, НП 8' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nZara Базова футболка oversize (Black, M) — 799 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
  {
    key: 'handoff_graceful',
    title: 'Передача оператору',
    icon: ICON_HANDOFF,
    turns: [
      { role: 'user', text: 'у мене скарга на попереднє замовлення' },
      { role: 'bot', text: 'Розмову передано оператору', isHandoff: true, delayMs: 400 },
    ],
  },
  {
    key: 'instagram_story_dress',
    title: 'Story → ціна',
    icon: ICON_STORY,
    turns: [
      {
        role: 'user',
        text: 'Скільки коштує?',
        instagramContext: {
          type: 'story',
          mediaUrl: '/uploads/story-reply-demo.JPG',
        },
      },
      { role: 'bot', text: 'Mango Сукня міді — 1899 UAH 💛\nДоступні розміри: XS, S, M, L', imageUrls: ['/uploads/demo-p-16.avif'] },
      { role: 'user', text: 'Так, M' },
      { role: 'bot', text: 'Mango Сукня міді (M) — оформлюємо? 💛' },
      { role: 'user', text: 'Так' },
      { role: 'bot', text: 'Замовлення прийнято 💛 Mango Сукня міді (M) — 1899 UAH. Очікуйте на дзвінок' },
    ],
  },
  {
    key: 'instagram_post_jacket',
    title: 'Post → наявність',
    icon: ICON_POST,
    turns: [
      {
        role: 'user',
        text: 'Ще є в наявності?',
        instagramContext: {
          type: 'post',
          mediaUrl: '/uploads/demo-p-13.avif',
        },
      },
      { role: 'bot', text: 'Mango Шкіряна куртка байкер (Black, M) — 2899 UAH 💛 в наявності', imageUrls: ['/uploads/demo-p-13.avif'] },
      { role: 'user', text: 'Беру' },
      { role: 'bot', text: 'Чудово 💛 Оформлюємо?' },
      { role: 'user', text: 'Так' },
      { role: 'bot', text: 'Замовлення прийнято 💛 Mango Шкіряна куртка байкер — 2899 UAH. Очікуйте на дзвінок' },
    ],
  },
];
