// demo-altamen scenarios written for the v2 agent: outcome assertions only.
//
// The agent's path through a turn isn't fixed — it may look a product up
// before or after asking a question — so these check what happened (the
// reply, the order draft, the placed order, which conversation the message
// landed in), not how.
//
// The last four cover conversation boundaries (implementation plan,
// "Conversation boundaries"). The store's idle threshold is the default 24h;
// `advanceHours` moves the clock instead of waiting.

import { SimulatorScenario, DEMO_ALTAMEN_SLUG } from '../types';

const PRICE_QUESTION = 'Скільки коштує сорочка льон?';

export const DEMO_ALTAMEN_AGENT_SCENARIOS: Record<string, SimulatorScenario> = {
  demo_altamen_agent_shirt_order: {
    name: 'demo-altamen — linen shirt, size from measurements, order placed',
    description:
      'Search → size from height/weight → colour → details → summary from the draft → "так" → order placed. ' +
      'The live run that shaped Phase 2, as a scenario.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      {
        message: 'Привіт! Шукаю лляну сорочку',
        // «лляну сорочку» comes back as «лляні сорочки», «льон», «з льону»: check the item, not the word.
        expect: { handoff: false, toolCalled: 'search_products', replyContains: 'сороч' },
      },
      {
        message: 'зріст 182, вага 80',
        expect: { handoff: false, toolCalled: 'get_size_help', replyMentionsSize: 'L', note: '182 / 80 is L on the store chart (175–185 / 75–90)' },
      },
      {
        message: 'давайте чорну, L',
        expect: { handoff: false, replyNotContains: 'немає в наявності', note: 'black L is in stock: the agent must not say otherwise' },
      },
      {
        message: 'так, беру. Петренко Іван, 0671234567',
        expect: {
          handoff: false,
          orderDraft: {
            items: [{ titleIncludes: 'Сорочка льон', variantIncludes: 'Чорний, L' }],
            customer: { fullName: 'Петренко', phone: '0671234567' },
          },
        },
      },
      {
        message: 'Київ, відділення 25, оплата при отриманні',
        expect: {
          handoff: false,
          orderDraft: { complete: true, customer: { city: 'Київ', paymentMethod: 'cod' } },
          orderPlaced: false,
          note: 'the summary comes first; the order is placed only after a yes',
        },
      },
      {
        message: 'так, оформлюйте',
        expect: { handoff: false, orderPlaced: true, toolCalled: 'place_order', paymentDetailsSent: false },
      },
    ],
  },

  demo_altamen_agent_wedding_shirt: {
    name: 'demo-altamen — «сорочка на весілля»: plain, dressy shirts offered',
    description:
      'Advice by occasion. Passes on the kind of shirts offered, not on a product name: at least two, all ' +
      'shirts, plain, smart-casual or formal. Their look comes from attributes read from the product photos ' +
      '(npm run attributes:extract -- --tenant demo-altamen).',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      {
        message: 'Хочу замовити сорочку, на весілля, яку порадите',
        expect: {
          handoff: false,
          shortlist: {
            min: 2,
            category: 'Сорочки',
            attributes: { formality: ['смарт-кежуал', 'святкова'], pattern: ['однотонний'] },
          },
          note: 'keyword search ranked all 21 shirts equal on «сорочк» and returned the 8 shortest titles',
        },
      },
    ],
  },

  demo_altamen_agent_fit_question_offers_manager: {
    name: 'demo-altamen — «вона повномірна?»: size recommended, manager check offered',
    description:
      'sizing.advice = recommend. A fit question the data can\'t answer used to hand the whole conversation off ' +
      'and drop the size the agent had already worked out. Now: the size, plus an offer to confirm with a ' +
      'manager; the handoff happens only when the customer accepts.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      {
        message: 'Хочу замовити сорочку, щоб була норм під чорний піджак, які є варіанти?',
        expect: { handoff: false, shortlist: { min: 2, category: 'Сорочки' } },
      },
      {
        message: 'Напевне білу, а вона повномірна? В мене ріст 170 см і вага 70кг, який розмір підійде?',
        expect: {
          handoff: false,
          replyMentionsSize: 'M',
          replyContains: 'менеджер',
          note: '170 / 70 is M on the store chart; nothing says whether the shirt runs true to size',
        },
      },
      {
        message: 'Так, уточніть, будь ласка',
        expect: { handoff: true, note: 'the customer accepted the manager check' },
      },
    ],
  },

  demo_altamen_agent_numbered_trouser_size: {
    name: 'demo-altamen — «М» for trousers sized 48–58: ask the number, not height and weight',
    description:
      "The store's height/weight ranges are S–3XL. Брюки льон comes in 48–58, so the ranges can't recommend " +
      'a size for it. The agent used to ask for height and weight anyway, got «L» back from the tool, and handed ' +
      'off. Now it lists the sizes in stock and asks which one the customer wears.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Покажіть брюки льон темно-сині', expect: { handoff: false } },
      {
        message: 'М',
        expect: {
          handoff: false,
          replyMentionsSize: '48',
          replyNotContains: ['зріст', 'вагу'],
          note: 'the sizes in stock (48–58) and a question, no measurements',
        },
      },
      {
        message: '52, беру',
        expect: { handoff: false, orderDraft: { items: [{ titleIncludes: 'Брюки льон', variantIncludes: '52' }] } },
      },
    ],
  },

  demo_altamen_agent_sizes_by_consultation: {
    name: 'demo-altamen as a consult-sizing store — measurements go to a manager',
    description:
      'sizing.advice = consult (a store with custom sizes): the agent has no size tool, collects measurements ' +
      'and hands off instead of naming a size.',
    tenantId: DEMO_ALTAMEN_SLUG,
    flowConfigOverride: { sizing: { advice: 'consult' } },
    turns: [
      { message: 'Хочу лляну сорочку, біла є?', expect: { handoff: false } },
      {
        message: 'Який розмір мені брати? Зріст 180, вага 85',
        expect: { handoff: true, toolNotCalled: 'get_size_help' },
      },
    ],
  },

  demo_altamen_agent_photo_of_store_shirt: {
    name: "demo-altamen — the customer sends the shop's own photo of a shirt",
    description:
      'The photo is matched to its product by fingerprint (npm run backfill:media-phash -- --tenant demo-altamen) ' +
      'and is in the agent\'s context as an image. The next turn refers back to it without naming it. Needs the ' +
      'Alta Men photos in test-assets/altamen/, which are not committed (see .gitignore).',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      {
        image: 'altamen/prive-sorochka-lon-ekryu.jpeg',
        message: 'Є така в L?',
        expect: { handoff: false, toolCalled: 'get_product', replyContains: 'prive' },
      },
      {
        message: 'А скільки коштує?',
        expect: { handoff: false, replyContains: 'грн', note: 'still about the shirt in the photo' },
      },
    ],
  },

  demo_altamen_agent_delivery_details_from_screenshot: {
    name: 'demo-altamen — delivery details sent as a screenshot',
    description:
      'The customer sends a notes screenshot instead of typing name, phone, city and branch. The agent reads it ' +
      'and saves the details to the order draft; the order is not placed without a yes.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити сорочку льон, чорну, L', expect: { handoff: false } },
      {
        image: 'photos/delivery-details.png',
        message: 'Ось дані для доставки',
        expect: {
          handoff: false,
          orderDraft: {
            customer: { fullName: 'Коваленко', phone: '0507654321', city: 'Львів', novaPoshtaBranch: '14' },
          },
          orderPlaced: false,
        },
      },
    ],
  },

  demo_altamen_agent_payment_receipt_goes_to_manager: {
    name: 'demo-altamen — a payment receipt is checked by a manager, never confirmed by the bot',
    description: 'A transfer screenshot is not proof of payment for the bot: it hands off with payment_check.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      {
        image: 'photos/payment-receipt.png',
        message: 'Оплатила, перевірте будь ласка',
        expect: {
          handoff: true,
          handoffReason: 'payment_check',
          replyNotContains: ['оплату отримали', 'оплата надійшла', 'оплату отримано'],
          orderPlaced: false,
        },
      },
    ],
  },

  demo_altamen_boundary_same_day_gap_continues: {
    name: 'demo-altamen — back 5 hours later: same conversation',
    description: 'A gap under the idle threshold keeps the conversation; "а чорна в L є?" still refers to the shirt.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: PRICE_QUESTION, expect: { handoff: false } },
      {
        message: 'а чорна в L є?',
        advanceHours: 5,
        expect: {
          newConversation: false,
          handoff: false,
          replyMentionsSize: 'L',
          replyMentionsColor: 'Чорний',
          note: 'the time-gap marker tells the agent hours passed; stock comes from a fresh lookup',
        },
      },
    ],
  },

  demo_altamen_boundary_next_day_refers_back: {
    name: 'demo-altamen — back 30 hours later, refers to the shirt',
    description:
      'A new conversation starts, but the earlier-conversation block names the shirt, so "а в M чорна є?" still resolves.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: PRICE_QUESTION, expect: { handoff: false } },
      {
        message: 'а в M чорна є?',
        advanceHours: 30,
        // Stock comes from search_products or get_product; either is a fresh lookup.
        expect: { newConversation: true, handoff: false, replyMentionsSize: 'M', replyMentionsColor: 'Чорний' },
      },
    ],
  },

  demo_altamen_boundary_new_request_after_silence: {
    name: 'demo-altamen — back 3 days later with a new request',
    description: 'The old price question is earlier context only; the new message is answered on its own.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: PRICE_QUESTION, expect: { handoff: false } },
      {
        message: 'Добрий день! Є шорти?',
        advanceHours: 72,
        expect: {
          newConversation: true,
          handoff: false,
          // Searching or browsing, listing shorts or asking which colour first: all fine here. This
          // scenario is about the boundary; offering is covered by demo_altamen_agent_wedding_shirt.
          replyContains: 'шорти',
          replyNotContains: 'AI-асистент',
          note: 'a new conversation, not a new acquaintance: no second welcome line',
        },
      },
    ],
  },

  demo_altamen_boundary_return_after_order: {
    name: 'demo-altamen — order placed, back 2 days later',
    description:
      'The placed order shows up as a fact from the database; nothing from the old draft is reused and no new ' +
      'draft appears from a status question.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити сорочку льон, чорну, L', expect: { handoff: false } },
      {
        message: 'так. Петренко Іван, 0671234567, Київ, відділення 25, оплата при отриманні',
        expect: { handoff: false, orderDraft: { complete: true } },
      },
      { message: 'так, оформлюйте', expect: { orderPlaced: true } },
      {
        message: 'Добрий день, коли відправите моє замовлення?',
        advanceHours: 48,
        expect: { newConversation: true, orderDraft: { itemCount: 0 }, orderPlaced: false, note: 'answering from the store notes or handing off are both fine; inventing a date is not' },
      },
    ],
  },
};
