import { hasFullName, hasPersonalData, redact, redactCustomer } from './redact';

describe('redact', () => {
  describe('phones', () => {
    it.each([
      ['+380 67 123 45 67', '[телефон]'],
      ['+380671234567', '[телефон]'],
      ['380671234567', '[телефон]'],
      ['+38 (067) 123-45-67', '[телефон]'],
      ['+38(067)1234567', '[телефон]'],
      ['067 123 45 67', '[телефон]'],
      ['067-123-45-67', '[телефон]'],
      ['(067) 123 45 67', '[телефон]'],
      ['0671234567', '[телефон]'],
      ['+38 067 123 4567', '[телефон]'],
      ['067 12 34 567', '[телефон]'],
      ['+48 512 345 678', '[телефон]'],
      ['+44 20 7946 0958', '[телефон]'],
    ])('%s', (input, expected) => {
      expect(redact(input)).toBe(expected);
    });

    it('keeps the words around a phone', () => {
      expect(redact('Мій номер 0671234567, дзвоніть після 18:00')).toBe('Мій номер [телефон], дзвоніть після 18:00');
    });
  });

  it('emails', () => {
    expect(redact('Пишіть на olena.k+shop@gmail.com або shop@lliana.com.ua')).toBe('Пишіть на [email] або [email]');
  });

  describe('card and account numbers', () => {
    it('card numbers, solid or grouped', () => {
      // 4111 1111 1111 1111 passes the Luhn check.
      expect(redact('Карта 4111111111111111')).toBe('Карта [картка]');
      expect(redact('Карта 4111 1111 1111 1111')).toBe('Карта [картка]');
      expect(redact('Карта 4111-1111-1111-1111')).toBe('Карта [картка]');
      expect(redact('Amex 3782 822463 10005')).toBe('Amex [картка]');
    });

    it('other long numbers (a parcel number) become a plain number token', () => {
      expect(redact('ТТН 20450123456788')).toBe('ТТН [номер]');
    });

    it('IBAN, solid or with spaces', () => {
      expect(redact('IBAN UA213223130000026007233566001')).toBe('IBAN [рахунок]');
      expect(redact('UA21 3223 1300 0002 6007 2335 6600 1, ФОП')).toBe('[рахунок], ФОП');
    });
  });

  describe('Nova Poshta and postcodes', () => {
    it.each([
      ['відділення №123', 'відділення [номер]'],
      ['Відділення 12, Київ', 'Відділення [номер], Київ'],
      ['у відділенні № 5', 'у відділенні [номер]'],
      ['НП 45', 'НП [номер]'],
      ['нп45', 'нп [номер]'],
      ['Нова Пошта №5', 'Нова Пошта [номер]'],
      ['на Нову Пошту 17', 'на Нову Пошту [номер]'],
      ['Новою Поштою №8', 'Новою Поштою [номер]'],
      ['поштомат 1234', 'поштомат [номер]'],
      ['Поштомат №30871', 'Поштомат [номер]'],
      ['Укрпошта 01001', 'Укрпошта [номер]'],
      ['відд. 3', 'відд. [номер]'],
    ])('%s', (input, expected) => {
      expect(redact(input)).toBe(expected);
    });

    it('leaves delivery times and prices next to the carrier alone', () => {
      for (const text of [
        'Нова Пошта 1-2 дні',
        'Нова Пошта 1–2 дні',
        'Відправляємо Новою Поштою за 1–2 дні',
        'НП 70 грн',
        'у відділенні 5 днів зберігається',
        'Нова пошта, від 2000 грн безкоштовно',
      ]) {
        expect(redact(text)).toBe(text);
      }
    });
  });

  describe('participants', () => {
    it('usernames, with or without @', () => {
      expect(redact('Ось фото, @olena.k! olena.k, чекаємо', ['olena.k'])).toBe("Ось фото, [ім'я]! [ім'я], чекаємо");
    });

    it('drops a name after a greeting or thanks, keeping the greeting', () => {
      expect(redact('Дякую, Олено!')).toBe('Дякую!');
      expect(redact('Добрий день, Олено Петрівно. Відправили')).toBe('Добрий день. Відправили');
      expect(redact('Дякуємо, @olena.k!', ['olena.k'])).toBe('Дякуємо!');
      // Polite pronouns aren't names; a capital later in the sentence isn't a vocative.
      expect(redact('Дякую Вам!')).toBe('Дякую Вам!');
      expect(redact('Дякую, Ви дуже допомогли')).toBe('Дякую, Ви дуже допомогли');
    });

    it('full names, their parts, and their Ukrainian forms', () => {
      const names = ['Олена Коваленко'];
      expect(redact('Олена Коваленко, вітаємо', names)).toBe("[ім'я], вітаємо");
      expect(redact('Олено, дякуємо!', names)).toBe("[ім'я], дякуємо!");
      expect(redact('Отримувач: Коваленко Олена', names)).toBe("Отримувач: [ім'я] [ім'я]");
      expect(redact('Передали Оленою', names)).toBe("Передали [ім'я]");
    });

    it("doesn't touch words that only start like a short name", () => {
      // «Віра» is too short for stem matching, so «вірно» stays.
      expect(redact('Віро, все вірно', ['Віра Петренко'])).toBe('Віро, все вірно');
      expect(redact('Віра, все вірно', ['Віра Петренко'])).toBe("[ім'я], все вірно");
    });

    it("doesn't match a name inside another word", () => {
      expect(redact('Наталія Тарас', ['Тарас'])).toBe("Наталія [ім'я]");
      expect(redact('Тарасівна', ['Тарас'])).toBe('Тарасівна');
    });
  });

  describe('street addresses', () => {
    it.each([
      ['вул. Шевченка 12, кв. 5', '[адреса]'],
      ['Київ, вулиця Хрещатик 22', 'Київ, [адреса]'],
      ['просп. Перемоги 3/1', '[адреса]'],
      ['бульв. Лесі Українки 7а, під\'їзд 2', '[адреса]'],
    ])('%s', (input, expected) => {
      expect(redact(input)).toBe(expected);
    });

    it('stops at the house number', () => {
      expect(redact('Магазин: вул. Хрещатик 1, працюємо з 10 до 19')).toBe('Магазин: [адреса], працюємо з 10 до 19');
    });
  });

  describe('customer messages with delivery details', () => {
    it.each([
      'Іваненко Олена Петрівна, Київ, НП 25',
      'Олена Іваненко\n0671234567',
      'Мій номер 067 12 34 567',
      '+48 512 345 678',
      'вул. Шевченка 12, кв. 5',
      'Карта 4111 1111 1111 1111',
      'Поштомат 1234',
    ])('%s becomes one token', (text) => {
      expect(redactCustomer(text)).toBe('[дані для доставки]');
    });

    it('keeps ordinary questions, even with the carrier or «Дякую Вам»', () => {
      for (const text of ['Коли відправите?', 'Нова Пошта є?', 'Дякую Вам!', 'Є розмір M?', 'Сукня — 2 450 грн?']) {
        expect(redactCustomer(text)).toBe(text);
      }
    });

    it('treats a run of names, replaced or not, as a full name', () => {
      expect(hasFullName('Іваненко Олена')).toBe(true);
      expect(hasFullName("[ім'я] [ім'я] Петрівна")).toBe(true);
      expect(hasFullName('Нова Пошта')).toBe(false);
      expect(hasFullName('Дякую Вам')).toBe(false);
      expect(hasFullName('Олена')).toBe(false);
      expect(hasFullName("Привіт! Це [ім'я]. Коли відправите?")).toBe(false);
      expect(hasFullName('Це Олена Іваненко')).toBe(true);
      expect(hasFullName('Отримувач Іваненко Олена')).toBe(true);
    });
  });

  describe('text it must leave alone', () => {
    it.each([
      'Сукня — 2 450 грн',
      'Ціна 1 200 000 грн',
      'Є розміри 42 44 46 48 50 52 54',
      'Розмір S, M, L; 44-46',
      'Відправимо 12.03.2026',
      'Працюємо з 09:00 до 18:00',
      'Знижка 10% до 15 березня',
      'Зріст 175, вага 70',
      'Обхват грудей 96 см',
      'Нова Пошта',
      'Повернення протягом 14 днів',
      'Розміри 040 42 44 46',
      'Відправляємо щодня до 16:00, крім неділі',
    ])('%s', (text) => {
      expect(redact(text)).toBe(text);
    });
  });

  it('hasPersonalData spots what redact would take out, and its tokens', () => {
    expect(hasPersonalData('Дзвоніть 0671234567')).toBe(true);
    expect(hasPersonalData('Ваш [телефон]')).toBe(true);
    expect(hasPersonalData('Відправимо сьогодні до 16:00')).toBe(false);
    expect(hasPersonalData('Дякую, Олено!')).toBe(true);
    expect(hasPersonalData('Отримувач Іваненко Олена')).toBe(true);
    expect(hasPersonalData('Клієнт: [дані для доставки]')).toBe(true);
  });
});
