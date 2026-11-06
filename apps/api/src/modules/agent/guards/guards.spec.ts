import { checkGrounding } from './grounding.guard';
import { checkStyle } from './style.guard';
import type { TurnFacts } from '../turn-facts';

const FACTS: TurnFacts = {
  prices: [3300, 2900],
  sizes: ['M', 'L', '2XL'],
  colors: ['Чорний', 'Білий'],
  titles: ['Сорочка льон'],
};
const allow = (customerText = '', knowledgeDoc: string | null = null, orderPlaced = false, draftUpdated = false) => ({
  customerText,
  knowledgeDoc,
  catalogTitles: ['Футболка базова біла'],
  orderPlaced,
  draftUpdated,
});

describe('checkGrounding', () => {
  it('passes a reply whose price, size and colour all came from tools', () => {
    expect(checkGrounding('Сорочка льон — 3300 грн, чорна в L є.', FACTS, allow())).toEqual([]);
  });

  it('flags a price no tool returned, including thousands written with a space', () => {
    expect(checkGrounding('Коштує 3 500 грн.', FACTS, allow())).toEqual([{ kind: 'price', value: '3 500 грн' }]);
    expect(checkGrounding('Коштує 3 300 грн.', FACTS, allow())).toEqual([]);
  });

  it("allows numbers from the customer's own message and the store notes", () => {
    expect(checkGrounding('Під 2000 грн є кілька варіантів.', FACTS, allow('до 2000 грн'))).toEqual([]);
    expect(checkGrounding('Від 1500 грн доставка безкоштовна.', FACTS, allow('', 'Безкоштовно від 1500 грн'))).toEqual([]);
  });

  it('flags a size no tool returned, and treats XXL and 2XL as the same size', () => {
    expect(checkGrounding('Є XL.', FACTS, allow())).toEqual([{ kind: 'size', value: 'XL' }]);
    expect(checkGrounding('Є XXL.', FACTS, allow())).toEqual([]);
  });

  it('lets the reply repeat a size the customer asked about, even a bare number', () => {
    expect(checkGrounding('XL зараз перевірю.', FACTS, allow('а XL є?'))).toEqual([]);
    expect(checkGrounding('46 розміру, на жаль, немає.', FACTS, allow('а 46 є?'))).toEqual([]);
    expect(checkGrounding('Є 42 розмір.', FACTS, allow('а 46 є?'))).toEqual([{ kind: 'size', value: '42' }]);
  });

  it('flags a colour no tool returned, in any declined form', () => {
    expect(checkGrounding('Є синя.', FACTS, allow())).toEqual([{ kind: 'color', value: 'синя' }]);
    expect(checkGrounding('Беріть чорну.', FACTS, allow())).toEqual([]);
  });

  it('does not treat a product name as a colour claim', () => {
    expect(checkGrounding('Футболка базова біла теж гарна.', { ...FACTS, colors: [] }, allow())).toEqual([]);
  });

  it("accepts a colour that fixes a typo in a returned product's title, but not an unrelated colour", () => {
    const facts = { ...FACTS, colors: ['Білий'], titles: ['Сорочка льон у гафітову смужку'] };
    expect(checkGrounding('Біла в графітову смужку — 3300 грн.', facts, allow())).toEqual([]);
    expect(checkGrounding('Є в графітову смужку.', { ...facts, titles: [] }, allow())).toEqual([
      { kind: 'color', value: 'графітову' },
    ]);
    expect(checkGrounding('Є синя в смужку.', facts, allow())).toEqual([{ kind: 'color', value: 'синя' }]);
  });

  it('accepts an inflected name of a product a tool returned', () => {
    const facts = { ...FACTS, colors: [], titles: ['Футболка базова біла'] };
    expect(checkGrounding('Можу запропонувати білу футболку.', facts, allow())).toEqual([]);
  });

  it('ignores Latin capitals that are not sizes', () => {
    expect(checkGrounding('Я AI-асистент магазину.', FACTS, allow())).toEqual([]);
  });

  it('refuses "the order is placed" unless place_order ran', () => {
    expect(checkGrounding('Чудово, оформив замовлення.', FACTS, allow())).toEqual([{ kind: 'order', value: 'оформив' }]);
    expect(checkGrounding('Замовлення прийнято!', FACTS, allow())).toEqual([{ kind: 'order', value: 'Замовлення прийнято' }]);
    expect(checkGrounding('Чудово, оформив замовлення.', FACTS, allow('', null, true))).toEqual([]);
  });

  it('refuses "I\'m placing it" in the present tense too', () => {
    expect(checkGrounding('Замовлення оформлюю.', FACTS, allow())).toEqual([{ kind: 'order', value: 'оформлюю' }]);
  });

  it('refuses "saved / added" unless update_order_draft succeeded this turn', () => {
    expect(checkGrounding('Дякую, номер записав.', FACTS, allow())).toEqual([{ kind: 'draft', value: 'записав' }]);
    expect(checkGrounding('Додала в замовлення.', FACTS, allow())).toEqual([{ kind: 'draft', value: 'Додала' }]);
    expect(checkGrounding('Дякую, номер записав.', FACTS, allow('', null, false, true))).toEqual([]);
    expect(checkGrounding('Можу додати її в замовлення?', FACTS, allow())).toEqual([]);
  });

  it('lets the reply offer to place the order or talk about placing it', () => {
    expect(checkGrounding('Оформлюємо? Після оформлення менеджер надішле ТТН. Можу оформити зараз.', FACTS, allow())).toEqual([]);
  });
});

describe('checkStyle', () => {
  it('catches russisms in any form', () => {
    expect(checkStyle('Вибачаюсь, на протязі дня відповімо.', { disallowedPhrases: [] }).map((v) => v.rule)).toEqual([
      'na_protiazi',
      'vybachaius',
    ]);
  });

  it('does not flag «з\'являється», which contains «являється»', () => {
    expect(checkStyle("Нова колекція з'являється щотижня.", { disallowedPhrases: [] })).toEqual([]);
  });

  it('catches call-centre phrases and phrases the store banned', () => {
    const rules = checkStyle('Чим можу вам допомогти? 💛', { disallowedPhrases: ['💛'] }).map((v) => v.rule);
    expect(rules).toEqual(['how_can_i_help', 'store_disallowed']);
  });

  it('passes clean Ukrainian', () => {
    expect(checkStyle('Так, чорна в L є. Оформлюємо?', { disallowedPhrases: ['💛'] })).toEqual([]);
  });
});
