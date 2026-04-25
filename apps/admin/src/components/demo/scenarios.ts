import { Scenario } from './types';

// Real Zara product photo for "Zara Базова футболка oversize" (black) —
// used everywhere that product appears. Served from Zara's public CDN.
// Other images fall back to picsum.photos with stable seeds because the
// source.unsplash.com/?query endpoint was deprecated and silently stopped
// returning images.
const IMG_ZARA_OVERSIZE =
  'https://static.zara.net/assets/public/8cd8/2ec0/9c1f4668babd/d3368d7ebfe1/00722404800-000-e1/00722404800-000-e1.jpg';
// Real Zara print t-shirt photo for "Zara Футболка з принтом".
const IMG_TSHIRT_PRINT =
  'https://static.zara.net/assets/public/60a8/0475/3c1e487e81bb/24a54dffa2ae/04805321800-a1/04805321800-a1.jpg';
const IMG_SIZE_CHART = 'https://picsum.photos/seed/dm-zara-sizechart/600/800';

export const SCENARIOS: Scenario[] = [
  {
    key: 'quick_purchase',
    title: 'Швидка покупка',
    icon: '⚡',
    turns: [
      { role: 'user', text: 'є чорна футболка в розмірі M?' },
      { role: 'bot', text: 'Zara Базова футболка oversize — 799 UAH 💛', imageUrls: [IMG_ZARA_OVERSIZE] },
      { role: 'bot', text: 'Так, Black, M є в наявності, бажаєте замовити?' },
      { role: 'user', text: 'так' },
      { role: 'bot', text: 'Чудово! Для оформлення напишіть:\n- ПІБ\n- Телефон\n- Місто та відділення НП' },
      { role: 'user', text: 'Олена Коваленко, 0997654321, Львів, НП 12' },
      { role: 'bot', text: 'Замовлення прийнято 💛\nZara Базова футболка oversize (Black, M) — 799 UAH\nОчікуйте на дзвінок для підтвердження' },
    ],
  },
  {
    key: 'size_recommender',
    title: 'Підбір розміру',
    icon: '📏',
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
    icon: '📋',
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
    icon: '🤝',
    turns: [
      { role: 'user', text: 'у мене скарга на попереднє замовлення' },
      { role: 'bot', text: 'Розмову передано оператору', isHandoff: true, delayMs: 400 },
    ],
  },
];
