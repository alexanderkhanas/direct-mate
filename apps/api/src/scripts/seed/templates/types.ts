// Template specs sourced from TypeScript code (single source of truth for
// demo tenants). Seed scripts INSERT rows into response_templates /
// phrase_blocks / faq_items from these specs.
//
// Shape matches the response_templates / phrase_blocks / faq_items DB columns
// 1:1, so the seeder can pass through directly.

export interface TemplateSpec {
  scenario: string;
  /** Conversation stage, matches classifier.conversationStage values. May be empty for stage-agnostic templates. */
  stage: string;
  /** Reply text blocks. Each entry is one block; the renderer joins them. */
  blocks: string[];
  /** Variable names that must be resolved before this template can be used. */
  requiredVariables: string[];
  /** Tone tags used by template selection. */
  toneTags: string[];
  /** Higher priority wins on scenario collision in the renderer. */
  priority: number;
  active: boolean;
}

export interface PhraseBlockSpec {
  type: string;
  text: string;
  scenarioTags: string[];
  active: boolean;
}

export interface FaqItemSpec {
  questionTags: string[];
  answerTemplate: string;
  active: boolean;
}
