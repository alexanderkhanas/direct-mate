/**
 * Length budget for the Alta Men turn-2 product list.
 *
 * Not a formatting test (that is `template-engine.format.spec.ts`) — this is
 * the reason the compact mode exists at all, pinned as a number. The fixture
 * is the real `demo-altamen` "Футболки / Поло" result set from prod trace
 * 0d9581e1: 5 products, 20 in-stock variants, one of them carrying 8 colours.
 *
 * The detailed render of exactly this data is ~496 chars over 19 lines. The
 * prod message was 573/23 — the extra is the recommendation prefix and the
 * sized header, which are template copy, not `{product_list}`. Either way it
 * is a full phone screen in an Instagram DM, before the 4 product photos that
 * arrive as separate messages. If a future change pushes compact back over
 * budget, this fails before a customer sees it.
 */
import { ProductSearchResult, TemplateEngineService } from './template-engine.service';

const BUDGET_CHARS = 350;
const BUDGET_LINES = 12;

let seq = 0;
const mk = (title: string, colors: string[], price: number): ProductSearchResult => ({
  product: { id: title, title, imageUrl: null, category: null, searchKeywords: null },
  // Turn 2 is size-scoped to L — the search filtered variants to that size.
  variants: colors.map((color) => ({
    id: `v${++seq}`,
    color,
    size: 'L',
    price,
    currency: 'UAH',
    effectiveAvailable: 1,
    imageUrl: null,
  })),
});

const ALTAMEN_TSHIRTS: ProductSearchResult[] = [
  mk("В'язана шовкова футболка", ['Темно-синій', 'Бежевий'], 3100),
  mk('ФУТБОЛКА З ПОЛІРОВАНОЇ БАВОВНИ MOKKO', ['Мокко'], 2500),
  mk("В'язана футболка Reglan", ['Бежевий', 'Блакитний', 'Молочний', 'Темно-синій'], 2900),
  mk("В'язане поло на блискавці",
    ['Світло-блакитний', 'Світло-бежевий', 'Хакі', 'Мокко', 'Сірий меланж'], 3500),
  mk("В'язана футболка",
    ['Синій меланж', 'Бежевий меланж', 'Білий', 'Блакитний меланж', 'Чорний', 'Хакі',
      'Сірий меланж', 'Теракотовий'], 2900),
];

const render = (style: 'detailed' | 'compact'): string =>
  (TemplateEngineService.prototype as any).formatProductList.call(
    TemplateEngineService.prototype,
    ALTAMEN_TSHIRTS,
    'L',
    style,
  );

describe('product list length budget (demo-altamen turn 2)', () => {
  it('detailed is the problem this change exists for', () => {
    const out = render('detailed');
    expect(out.length).toBeGreaterThan(450);
    expect(out.split('\n').length).toBeGreaterThan(18);
  });

  it(`compact fits ${BUDGET_CHARS} chars / ${BUDGET_LINES} lines`, () => {
    const out = render('compact');
    expect(out.length).toBeLessThanOrEqual(BUDGET_CHARS);
    expect(out.split('\n').length).toBeLessThanOrEqual(BUDGET_LINES);
  });

  it('keeps every product title and price verbatim', () => {
    const out = render('compact');
    for (const p of ALTAMEN_TSHIRTS) {
      expect(out).toContain(p.product.title);
    }
    for (const price of ['3100', '2500', '2900', '3500']) {
      expect(out).toContain(price);
    }
  });
});
