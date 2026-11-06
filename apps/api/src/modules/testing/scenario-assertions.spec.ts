import { CheckoutSessionStatus } from '@direct-mate/shared';
import { evaluateExpect, implicitChecks, mapLegacyExpect, TurnOutcome } from './scenario-assertions';

const OUTCOME: TurnOutcome = {
  status: 'replied',
  messages: [
    { kind: 'welcome', text: 'Вітаю, з вами AI-асистент' },
    { kind: 'reply', text: 'Чорна сорочка льон є в L і XXL — 3300 грн.', imageUrls: ['/uploads/shirt-black.jpg'] },
  ],
  handoff: null,
  toolCalls: ['get_product'],
  draft: {
    sessionId: 's1',
    status: CheckoutSessionStatus.CollectingCustomerInfo,
    items: [{ variantId: 'v1', productId: 'p1', title: 'Сорочка льон', color: 'Чорний', size: 'L', qty: 1, unitPrice: 3300, currency: 'UAH' }],
    customer: { fullName: 'Петренко Іван', phone: '+380671234567', city: null, branch: null, paymentMethod: null, comment: null },
    total: 3300,
    currency: 'UAH',
    missingFields: ['city', 'novaPoshtaBranch'],
    complete: false,
    placedOrderId: null,
    paymentDetailsSentAt: null,
  },
  orderPlaced: false,
  paymentDetailsSent: false,
  finalStyle: [],
  newConversation: false,
};

const failures = (expect: Parameters<typeof evaluateExpect>[0], o = OUTCOME) =>
  evaluateExpect(expect, o).filter((a) => !a.pass).map((a) => a.field);

describe('mapLegacyExpect', () => {
  it('maps engine decisions onto handoff and order outcomes', () => {
    expect(mapLegacyExpect({ decision: 'handoff' }).expect).toEqual({ handoff: true });
    expect(mapLegacyExpect({ decision: 'reply' }).expect).toEqual({ handoff: false });
    expect(mapLegacyExpect({ decision: 'create_draft_order' }).expect).toEqual({ orderPlaced: true, handoff: false });
  });

  it('maps cart and size memory onto the draft and the reply, and reports route-only fields', () => {
    const { expect: mapped, dropped } = mapLegacyExpect({
      scenario: 'confirm_variant_available',
      state: { selectionState: 'cart_item_added', cartLength: 1, cartHasVariant: 'Чорний, L', recommendedSize: 'L', orderCreated: false },
    });
    expect(mapped).toEqual({
      orderPlaced: false,
      orderDraft: { itemCount: 1, items: [{ variantIncludes: 'Чорний, L' }] },
      replyMentionsSize: ['L'],
    });
    expect(dropped).toEqual(['scenario', 'state.selectionState']);
  });

  it('reads a legacy replyContains of only a colour or only sizes as "mentions it"', () => {
    expect(mapLegacyExpect({ replyContains: ['Білий', 'S, M, L', 'немає в наявності'] }).expect).toEqual({
      replyContains: ['немає в наявності'],
      replyMentionsSize: ['S', 'M', 'L'],
      replyMentionsColor: ['Білий'],
    });
    expect(mapLegacyExpect({ replyContains: 'Коричневий' }).expect).toEqual({ replyMentionsColor: ['Коричневий'] });
  });

  it('keeps outcome fields as they are and lets them win over mapped ones', () => {
    expect(mapLegacyExpect({ handoff: true, decision: 'reply', replyContains: 'x' }).expect).toEqual({
      handoff: true,
      replyContains: 'x',
    });
  });
});

describe('evaluateExpect', () => {
  it('reads text across all messages, case-insensitively', () => {
    expect(failures({ replyContains: ['AI-асистент', 'сорочка'], replyNotContains: '💛' })).toEqual([]);
  });

  it('matches sizes as words, treating XXL as 2XL', () => {
    expect(failures({ replyMentionsSize: ['L', '2XL'] })).toEqual([]);
    expect(failures({ replyMentionsSize: 'M' })).toEqual(['replyMentionsSize']);
  });

  it('matches colours in any declined form', () => {
    expect(failures({ replyMentionsColor: ['Чорний', 'black'] })).toEqual([]);
    expect(failures({ replyMentionsColor: 'Білий' })).toEqual(['replyMentionsColor']);
  });

  it('checks draft items by title and by each part of the variant, colour declined or not', () => {
    expect(failures({ orderDraft: { itemCount: 1, items: [{ titleIncludes: 'льон', variantIncludes: 'чорна, L' }] } })).toEqual([]);
    expect(failures({ orderDraft: { items: [{ variantIncludes: 'Білий, L' }] } })).toEqual(['orderDraft.items']);
  });

  it('checks customer details, comparing phones by their last digits', () => {
    expect(failures({ orderDraft: { customer: { fullName: 'петренко', phone: '067 123 45 67' }, complete: false } })).toEqual([]);
    expect(failures({ orderDraft: { customer: { city: 'Київ' } } })).toEqual(['orderDraft.customer.city']);
  });

  it('checks handoff, tools, images, order and conversation flags', () => {
    expect(
      failures({
        handoff: false,
        toolCalled: 'get_product',
        toolNotCalled: 'place_order',
        imageCount: 1,
        imageContains: 'shirt',
        orderPlaced: false,
        paymentDetailsSent: false,
        newConversation: false,
      }),
    ).toEqual([]);
    expect(failures({ handoff: true, toolCalled: 'search_products', newConversation: true })).toEqual([
      'handoff',
      'newConversation',
      'toolCalled',
    ]);
  });
});

describe('implicitChecks', () => {
  const failed = (o: Partial<TurnOutcome>, expect = {}) =>
    implicitChecks({ ...OUTCOME, ...o }, expect).filter((a) => !a.pass).map((a) => a.field);

  it('passes a normal reply and a chosen handoff', () => {
    expect(failed({})).toEqual([]);
    expect(failed({ status: 'handed_off', handoff: { reason: 'complaint_or_return', summaryForManager: 'x' } })).toEqual([]);
  });

  it('fails a handoff caused by an agent failure, unless the scenario expects that reason', () => {
    const ungrounded = { status: 'handed_off' as const, handoff: { reason: 'ungrounded_reply', summaryForManager: null } };
    expect(failed(ungrounded)).toEqual(['implicit.noFailureHandoff']);
    expect(failed(ungrounded, { handoffReason: 'ungrounded_reply' })).toEqual([]);
  });

  it('fails an unanswered turn and a sent reply with style problems', () => {
    expect(failed({ status: 'busy' })).toEqual(['implicit.answered']);
    expect(failed({ finalStyle: [{ rule: 'vybachaius', match: 'Вибачаюсь', fix: '' }] })).toEqual(['implicit.style']);
  });
});
