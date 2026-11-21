import type { OnboardingStatus, OnboardingStepKey } from '../onboarding/onboarding.service';
import { KEY_SECTIONS, type NoteSection } from '../onboarding/store-notes';

/** What Claude should do next. Sent with every tool result: it steers better than a rule in the instructions. */
export interface NextStep {
  step: OnboardingStepKey | 'permissions' | 'done';
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
  /** The owner's permissions for the Direct: whether each is given, and whether they have answered at all. */
  permissions?: Record<'read_messages' | 'reply_to_customers', { allowed: boolean; decided: boolean }>;
  /** Where the Instagram history import stands (`HistoryImport.status`), when the owner allowed reading. */
  historyStatus?: string | null;
}

const READ_QUESTION =
  'May DirectMate read your Instagram Direct? It reads your recent chats once to learn your delivery and payment terms and how you talk to customers, ' +
  'and it lets learning mode work (the AI agent drafts replies next to your managers’ and sends nothing). You can withdraw it at any time.';
const REPLY_QUESTION =
  'May the AI agent reply to your customers in Instagram Direct? This is what turning it on fully (active mode) needs; it also answers questions left under your posts, in Direct. ' +
  'It is separate from reading your chat history, and you can withdraw it at any time.';

/** The history import is reading, or has read: what the notes and tone steps should do with it. */
function historyHint(status: string | null | undefined): string {
  if (status === 'done') {
    return ' First call get_history_import: it has the terms your managers stated in chats and a description of your tone. Read them to the owner to confirm instead of asking from scratch.';
  }
  if (status === 'queued' || status === 'running' || status === 'limited') {
    return ' The Direct history is being read (it can take up to an hour): carry on asking, and call get_history_import later to compare.';
  }
  return '';
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
  // Right after Instagram connects: only reading is asked, once (a «no» counts as an answer). Replying matters only
  // when the owner turns the agent on fully, so it is asked then (the live and done steps).
  const instagram = status.steps.some((s) => s.key === 'instagram' && s.state === 'done');
  const perms = facts.permissions;
  if (instagram && perms && !perms.read_messages.decided) {
    return {
      step: 'permissions',
      why:
        'Instagram is connected, but DirectMate does not read the Direct until the owner allows it, and the AI agent sends nothing to anyone until the owner turns it on at the end of the setup.',
      ask_owner: [
        'Tell the owner first: connecting Instagram does not let DirectMate read your Direct, and the AI agent sends nothing to anyone until you turn it on at the end of the setup.',
        READ_QUESTION,
      ],
      then_call:
        'set_instagram_permission with permission "read_messages": allowed: true and confirmed: true only after the owner clearly said yes; allowed: false if they said no. ' +
        'Then carry on with the setup. Do not ask about replying to customers now: that comes when the owner turns the AI agent on fully.',
    };
  }

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
          'Ask about one section at a time. After each answer, read back what you will save, then save_store_notes with that section only.' +
          historyHint(facts.historyStatus),
      };
    }
    case 'sizes':
      return {
        step: 'sizes',
        why: 'For clothing, customers ask which size to take. The AI agent recommends one only from a size chart the owner checked.',
        ask_owner: [
          'Do you have a size chart? Paste a screenshot of it here, one chart at a time (for example tops, then trousers).',
          'No chart? Then either a manager advises on sizes, or tell me which height and weight fit each size and I will make a table from that.',
        ],
        then_call:
          'get_size_charts first (brands, categories, the sizes the products come in). For a picture: read it, then show the owner every size with its measurements in one compact list, ' +
          'say which cells you were unsure of, and ask which products it is for (all, or brands and categories from get_size_charts). ' +
          'After their yes, save_size_chart with confirmed: true. Then offer the next chart for what has no chart yet, and a try_agent size question. ' +
          'If they want a manager to advise instead: set_sizing "consult".',
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
        then_call:
          'set_tone with a short description, then try_agent again so the owner hears the difference. Or skip_setup_step "tone".' +
          historyHint(facts.historyStatus),
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
          'go_live with the mode the owner chose, and confirmed: true only after they said yes to that exact mode. Suggest "learning" first, and "active" only after they have seen results. ' +
          permissionHint(facts.permissions, true),
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
          'Offer to adjust anything: the notes (save_store_notes), the size charts (get_size_charts), the tone (set_tone), another test (try_agent), or the mode (go_live).' +
          (status.operatingMode === 'active' ? '' : ' ' + permissionHint(facts.permissions, false)),
      };
  }
}

/**
 * What a mode needs before go_live, in words for Claude: learning needs reading, active needs replying. Replying is
 * never asked during the setup, so this is where its question comes up.
 */
function permissionHint(perms: GuideFacts['permissions'], learningToo: boolean): string {
  const ask: string[] = [];
  if (!perms?.reply_to_customers.allowed) {
    ask.push(`If the owner chooses to turn it on fully ("active"), first ask: «${REPLY_QUESTION}» Then set_instagram_permission "reply_to_customers" (confirmed: true only after a clear yes), then go_live.`);
  }
  if (learningToo && !perms?.read_messages.allowed) {
    ask.push(`If they choose "learning", first ask: «${READ_QUESTION}» Then set_instagram_permission "read_messages", then go_live.`);
  }
  return ask.length > 0 ? ask.join(' ') : 'Both permissions are given.';
}
