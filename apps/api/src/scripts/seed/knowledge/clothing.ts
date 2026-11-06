// Knowledge doc for the women's clothing demo stores (demo-women-clothes,
// showcase-women-clothes, test-clothes). Goes into the agent's system prompt
// as-is, so it is written the way a store owner would write it.
// Delivery and payment wording follows the template packs' answer_delivery /
// answer_payment; hours match the builder's businessHours.

export const CLOTHING_KNOWLEDGE_DOC = `# Доставка
- Відправляємо Новою Поштою по всій Україні.
- Відправка протягом 1–3 днів після оформлення замовлення.
- Доставку оплачує отримувач за тарифами Нової Пошти.

# Оплата
- Накладений платіж: оплата при отриманні у відділенні.
- Або передоплата на картку. Реквізити надсилаємо після оформлення замовлення.

# Обмін і повернення
- Протягом 14 днів після отримання, якщо річ не носили і бирки на місці.
- Доставку при обміні чи поверненні оплачує покупець.
- Обмін і повернення оформлює менеджер.

# Розміри
- Розмір підбираємо за зростом і вагою.
- Якщо параметри між двома розмірами, радимо більший.

# Замовлення
- Після оформлення менеджер підтверджує замовлення і надсилає номер ТТН.

# Графік
- Менеджери на зв’язку пн–пт 09:00–18:00, сб 10:00–15:00. Неділя — вихідний.
`;
