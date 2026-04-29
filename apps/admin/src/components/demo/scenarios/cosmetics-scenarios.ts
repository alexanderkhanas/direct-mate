import { createElement } from 'react';
import { Zap, Sparkles, Layers, ShieldCheck, Camera, Image as ImageIcon } from 'lucide-react';
import { Scenario } from '../types';

const iconClass = 'h-3.5 w-3.5';
const ICON_QUICK = createElement(Zap, { className: iconClass, strokeWidth: 2.5 });
const ICON_SKIN = createElement(Sparkles, { className: iconClass });
const ICON_VARIANT = createElement(Layers, { className: iconClass });
const ICON_SAFETY = createElement(ShieldCheck, { className: iconClass });
const ICON_STORY = createElement(Camera, { className: iconClass });
const ICON_POST = createElement(ImageIcon, { className: iconClass });

// Self-hosted product photos seeded by apps/api/src/scripts/seed-demo-cosmetics.ts
// (Phase 4). Files live in apps/api/test-assets/cosmetics/ (downloaded once
// from public CDNs, committed) and are copied to apps/api/uploads/cosmetics/
// on seed run. Served by the backend at /uploads/cosmetics/<file>; admin's
// Vite proxy forwards /uploads to the API in dev.
//
// IMPORTANT: these paths only resolve once Phase 4 has run. Until then,
// scenarios will render with broken-image placeholders in the demo widget.
const IMG_DAY_CREAM = '/uploads/cosmetics/demo-cos-01-day-cream.jpg';
const IMG_VITAMIN_C = '/uploads/cosmetics/demo-cos-04-vitamin-c-serum.webp';
const IMG_MASK_BRIGHTENING = '/uploads/cosmetics/demo-cos-05c-mask-brightening.jpg';

export const COSMETICS_SCENARIOS: Scenario[] = [
  {
    key: 'cosmetics_quick_purchase',
    title: 'Швидка покупка',
    icon: ICON_QUICK,
    turns: [
      { role: 'user', text: 'хочу крем для жирної шкіри' },
      { role: 'bot', text: 'Денний крем — підходить для жирної шкіри. Ціна 450 UAH 💛', imageUrls: [IMG_DAY_CREAM] },
      { role: 'bot', text: 'Хочете замовити?' },
      { role: 'user', text: 'так' },
      { role: 'bot', text: 'Чудово 💛 Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Олена Коваленко, 0997654321, Львів, НП 12' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nДенний крем — 450 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
  {
    key: 'cosmetics_skin_type_recommender',
    title: 'Підбір за типом шкіри',
    icon: ICON_SKIN,
    turns: [
      { role: 'user', text: 'хочу крем для обличчя' },
      { role: 'bot', text: 'Який у вас тип шкіри? (жирна / суха / нормальна / комбінована / чутлива) 💛' },
      { role: 'user', text: 'Т-зона блищить' },
      { role: 'bot', text: 'Для комбінованої шкіри підбираю варіанти 💛' },
      { role: 'bot', text: 'Денний крем — баланс зволоження без жирного блиску. Ціна 450 UAH', imageUrls: [IMG_DAY_CREAM] },
      { role: 'bot', text: 'Сироватка з вітаміном С — освітлює та вирівнює тон. Ціна 580 UAH', imageUrls: [IMG_VITAMIN_C] },
      { role: 'user', text: 'беру першу' },
      { role: 'bot', text: 'Чудово 💛 Денний крем — 450 UAH. Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Марія Шевченко, 0501234567, Київ, НП 5' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nДенний крем — 450 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
  {
    key: 'cosmetics_mask_variant_chooser',
    title: 'Вибір варіанту маски',
    icon: ICON_VARIANT,
    turns: [
      { role: 'user', text: 'хочу маску для обличчя' },
      { role: 'bot', text: 'У маски для обличчя є такі варіанти:\n- Зволожуюча — 220 UAH\n- Очищувальна — 220 UAH\n- Освітлююча — 240 UAH\nЯкий вам цікавий? 💛' },
      { role: 'user', text: 'освітлюючу' },
      { role: 'bot', text: 'Маска освітлююча (240 UAH) — в наявності 💛', imageUrls: [IMG_MASK_BRIGHTENING] },
      { role: 'bot', text: 'Оформляємо?' },
      { role: 'user', text: 'так' },
      { role: 'bot', text: 'Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Ірина Петренко, 0671234567, Харків, НП 8' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nМаска освітлююча — 240 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
  {
    key: 'cosmetics_safety_handoff',
    title: 'Безпека: алергія',
    icon: ICON_SAFETY,
    turns: [
      { role: 'user', text: 'у мене сильна алергія на парабени' },
      // Silent handoff: customer sees a neutral acknowledgment. The "transfer
      // to manager" framing is intentionally absent from the bot's text
      // (preserves the human-rep illusion per CLAUDE.md silent handoff invariant).
      { role: 'bot', text: 'Дайте хвилинку — зараз уточню для вас 💛', delayMs: 400 },
      // System-level annotation (demo-only, frontend-rendered) so the
      // prospective customer evaluating DirectMate sees what happens behind
      // the scenes when the bot escalates: bot stops, manager is notified.
      { role: 'bot', text: '', isHandoff: true, delayMs: 600 },
    ],
  },
  {
    key: 'instagram_story_cream',
    title: 'Story → тип шкіри',
    icon: ICON_STORY,
    turns: [
      {
        role: 'user',
        text: 'Це для якого типу шкіри?',
        instagramContext: {
          type: 'story',
          mediaUrl: '/uploads/cosmetics/demo-cos-01-day-cream.jpg',
        },
      },
      { role: 'bot', text: 'Денний крем — підходить для жирної та комбінованої шкіри 💛 Ціна 450 UAH', imageUrls: ['/uploads/cosmetics/demo-cos-01-day-cream.jpg'] },
      { role: 'user', text: 'Беру' },
      { role: 'bot', text: 'Чудово 💛 Оформлюємо?' },
      { role: 'user', text: 'Так' },
      { role: 'bot', text: 'Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Юлія Кравченко, 0951234567, Полтава, НП 3' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nДенний крем — 450 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
  {
    key: 'instagram_post_serum',
    title: 'Post → ціна',
    icon: ICON_POST,
    turns: [
      {
        role: 'user',
        text: 'Скільки коштує?',
        instagramContext: {
          type: 'post',
          mediaUrl: '/uploads/cosmetics/demo-cos-04-vitamin-c-serum.webp',
        },
      },
      { role: 'bot', text: 'Сироватка з вітаміном С — 580 UAH 💛 Освітлює і вирівнює тон шкіри', imageUrls: ['/uploads/cosmetics/demo-cos-04-vitamin-c-serum.webp'] },
      { role: 'user', text: 'Беру' },
      { role: 'bot', text: 'Чудово 💛 Оформлюємо?' },
      { role: 'user', text: 'Так' },
      { role: 'bot', text: 'Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Вікторія Мороз, 0731234567, Запоріжжя, НП 21' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nСироватка з вітаміном С — 580 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
];
