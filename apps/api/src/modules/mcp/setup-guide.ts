import type { OnboardingStatus, OnboardingStepKey } from '../onboarding/onboarding.service';
import { KEY_SECTIONS, type NoteSection } from '../onboarding/store-notes';

/** What Claude should do next. Sent with every tool result: it steers better than a rule in the instructions. */
export interface NextStep {
  step: OnboardingStepKey | 'done';
  why: string;
  /** Questions to put to the owner, one topic at a time. */
  ask_owner: string[];
  then_call: string;
}

export interface GuideFacts {
  /** A product import started from Claude that hasn't finished. */
  importing?: boolean;
  /** Key sections of the store notes with nothing in them. */
  missingSections?: NoteSection[];
}

const SECTION_QUESTIONS: Record<NoteSection, string> = {
  delivery: 'Delivery: which carriers (Nova Poshta, Ukrposhta, courier), what it costs and who pays, how many days, do you ship abroad?',
  payment: 'Payment: prepayment, cash on delivery or both? Any minimum prepayment? Which card or account do customers pay to?',
  returns: 'Returns and exchanges: within how many days, on what conditions, who pays the shipping back?',
  contacts: 'Contacts and hours: when do your managers answer, and is there a phone or a physical shop?',
  sizes: 'Sizes: do your items run true to size, small or large?',
  other: 'Anything else customers often ask about?',
};

/**
 * The next thing to do, from the setup status. Steps come in the order the
 * admin setup uses; a skipped step counts as dealt with.
 */
export function nextStep(status: OnboardingStatus, facts: GuideFacts = {}): NextStep {
  const todo = status.steps.find((s) => s.state === 'todo');
  switch (todo?.key) {
    case 'products':
      if (facts.importing) {
        return {
          step: 'products',
          why: 'The product import is still running.',
          ask_owner: [],
          then_call: 'Carry on with the store notes (save_store_notes) and call get_setup_status again in a minute.',
        };
      }
      return {
        step: 'products',
        why: 'The AI agent can only sell what it knows: it needs the catalog.',
        ask_owner: [
          'Where do your products live: a website with a product feed (a YML/XML/CSV link or a Google Sheet), or Shopify?',
        ],
        then_call:
          'For a feed link: preview_catalog_feed, show the owner what was found, then connect_catalog with source "feed". For Shopify: connect_catalog with source "shopify" and give the owner the link.',
      };
    case 'instagram':
      return {
        step: 'instagram',
        why: 'The AI agent answers in the shop’s Instagram DMs, so the account has to be connected. It needs a professional (business or creator) Instagram account.',
        ask_owner: [],
        then_call:
          'connect_instagram, give the owner the link, and wait until they say they are back. Then get_setup_status.',
      };
    case 'knowledge': {
      const missing = facts.missingSections ?? [...KEY_SECTIONS];
      return {
        step: 'knowledge',
        why: 'Store notes are the only source the AI agent has for delivery, payment and returns. What is not there, it hands to a manager.',
        ask_owner: missing.map((s) => SECTION_QUESTIONS[s]),
        then_call:
          'Ask about one section at a time. After each answer, read back what you will save, then save_store_notes with that section only.',
      };
    }
    case 'sizes':
      return {
        step: 'sizes',
        why: 'For clothing, customers ask which size to take.',
        ask_owner: [
          'Should the AI agent recommend a size itself (from the customer’s height and weight), or pass size questions to a manager?',
        ],
        then_call:
          'set_sizing with "recommend" or "consult". Size tables and size chart images are added in the admin panel.',
      };
    case 'test':
      return {
        step: 'test',
        why: 'The owner should see their AI agent answer before customers do.',
        ask_owner: ['Shall I ask your AI agent a few typical customer questions so you can see how it answers?'],
        then_call:
          'try_agent with 3 to 5 realistic customer messages, one per call, in the customers’ language. Show each reply to the owner as it is.',
      };
    case 'tone':
      return {
        step: 'tone',
        why: 'The AI agent should sound like the shop.',
        ask_owner: [
          'How do you talk to customers: formal or friendly, «ви» or «ти», emoji or not? Anything it must never say?',
        ],
        then_call: 'set_tone with a short description, then try_agent again so the owner hears the difference. Or skip_setup_step "tone".',
      };
    case 'telegram':
      return {
        step: 'telegram',
        why: 'When the AI agent hands a customer to a person, the manager gets a Telegram message.',
        ask_owner: [],
        then_call: 'connect_telegram and give the owner the link. Or skip_setup_step "telegram".',
      };
    case 'live':
      return {
        step: 'live',
        why: 'Everything needed is set up.',
        ask_owner: [
          'Start in learning mode? The AI agent writes its own drafts next to your managers’ replies and sends nothing, so you can compare first. When you are happy with them, turn it on fully: then it answers customers and the free trial starts.',
        ],
        then_call:
          'go_live with the mode the owner chose, and confirmed: true only after they said yes to that exact mode. Suggest "learning" first, and "active" only after they have seen results.',
      };
    default:
      return {
        step: 'done',
        why:
          status.operatingMode === 'active'
            ? 'The AI agent is on and answers customers.'
            : status.operatingMode === 'learning'
              ? 'The AI agent is in learning mode: it drafts, it does not send.'
              : 'Setup is complete.',
        ask_owner: [],
        then_call:
          'Offer to adjust anything: the notes (save_store_notes), the tone (set_tone), another test (try_agent), or the mode (go_live).',
      };
  }
}
