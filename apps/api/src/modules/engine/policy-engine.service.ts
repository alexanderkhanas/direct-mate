import { Injectable, Logger } from '@nestjs/common';
import { ClassificationResult } from './classifier.service';
import { StoreConfig } from './entities/store-config.entity';

// ─── Interfaces ──────────────────────────────────────────────────

export interface PolicyEvaluation {
  action: 'continue' | 'escalate' | 'fallback';
  reason?: string;
}

export interface ConversationStateInfo {
  failedTurns: number;
  maxFailedTurns: number;
}

// ─── Escalation config shape ─────────────────────────────────────

interface EscalationConfig {
  always_escalate_intents?: string[];
  low_confidence_threshold?: number;
  escalate_on_negative_sentiment?: boolean;
  escalate_on_missing_critical_data?: boolean;
}

// ─── Fallback config shape ───────────────────────────────────────

interface FallbackConfig {
  mode?: string;
  max_fallback_attempts_per_thread?: number;
  fallback_disallowed_intents?: string[];
}

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class PolicyEngineService {
  private readonly logger = new Logger(PolicyEngineService.name);

  evaluate(params: {
    classification: ClassificationResult;
    storeConfig: StoreConfig;
    state: ConversationStateInfo;
    /**
     * The inbound turn carried a photo / story reply. Exempts the turn from the
     * low-confidence gate: a caption-less image has no text to be confident
     * about, and the product is resolved from the image downstream.
     */
    hasMediaReference?: boolean;
  }): PolicyEvaluation {
    const { classification, storeConfig, state } = params;
    const escalation =
      (storeConfig.escalationConfig as EscalationConfig) ?? {};
    const fallback = (storeConfig.fallbackConfig as FallbackConfig) ?? {};

    // 1. Check max failed turns
    if (state.failedTurns >= state.maxFailedTurns) {
      return { action: 'escalate', reason: 'max_failed_turns' };
    }

    // 2. Check always-escalate intents
    const alwaysEscalate = escalation.always_escalate_intents ?? [
      'complaint',
      'support_issue',
      'request_human',
    ];
    if (alwaysEscalate.includes(classification.primaryIntent)) {
      return {
        action: 'escalate',
        reason: `always_escalate_intent:${classification.primaryIntent}`,
      };
    }

    // 3. Check recommended action is escalate
    if (classification.recommendedAction === 'escalate') {
      return { action: 'escalate', reason: 'ai_recommended_escalation' };
    }

    // 4. Check low confidence.
    //
    // The confidence gate gets the FREE-FORM path only. Two exemptions, both
    // because a low score there means "I'm unsure how to read the phrasing",
    // NOT "there is no actionable signal" — and routing such a turn to AI
    // generation throws away a deterministic path that would have handled it.
    //
    //   a) A resolvable slot action. When the customer names a value or gives a
    //      pure yes/no, the selection state machine owns the turn: it matches
    //      the value against the product's ACTUAL variants and re-asks if it
    //      can't. Wrong-but-confident is the danger here, not unsure-but-right.
    //      This exemption is load-bearing for the ambiguous pick family
    //      ("L підійде" — a pick the classifier is told to emit at confidence
    //      ≤0.6 precisely BECAUSE it is ambiguous). Without it, the rule that
    //      classifies those turns correctly would then have them escalated.
    //
    //   b) A media turn. A photo or story reply with no caption legitimately
    //      classifies as low-confidence `unknown` — there is no text to read.
    //      The product is resolved downstream from the image (pHash → vision),
    //      not from the classification, and that runs AFTER this gate.
    //
    // Confidence-as-escalation-trigger is a blunt instrument; the deterministic
    // engine gates now do this job far better.
    const SLOT_RESOLVABLE_ACTIONS = [
      'fills_missing_slot',
      'confirmation',
      'rejection',
      'correction',
      'adds_to_cart',
    ];
    const deterministicallyActionable =
      SLOT_RESOLVABLE_ACTIONS.includes(classification.slotAction ?? '') ||
      params.hasMediaReference === true;

    const confidenceThreshold = escalation.low_confidence_threshold ?? 0.7;
    if (
      classification.confidence < confidenceThreshold &&
      !deterministicallyActionable
    ) {
      // For strict mode, escalate on low confidence
      if (fallback.mode === 'strict_templates_only') {
        return { action: 'escalate', reason: 'low_confidence_strict_mode' };
      }
      // For other modes, fall back to AI generation
      return { action: 'fallback', reason: 'low_confidence' };
    }

    // 5. Check negative sentiment
    if (
      escalation.escalate_on_negative_sentiment &&
      classification.sentiment === 'negative'
    ) {
      return { action: 'escalate', reason: 'negative_sentiment' };
    }

    // 6. Check if fallback is disallowed for this intent
    const disallowedIntents = fallback.fallback_disallowed_intents ?? [];
    if (disallowedIntents.includes(classification.primaryIntent)) {
      // If this intent matches a disallowed fallback, and templates don't match later,
      // the reply engine will escalate instead of using AI fallback.
      // For now, continue — the reply engine handles the no-template case.
    }

    return { action: 'continue' };
  }

  /**
   * Check whether AI fallback is allowed for this intent/config.
   */
  isFallbackAllowed(
    classification: ClassificationResult,
    storeConfig: StoreConfig,
  ): boolean {
    const fallback = (storeConfig.fallbackConfig as FallbackConfig) ?? {};

    if (fallback.mode === 'strict_templates_only') return false;

    const disallowed = fallback.fallback_disallowed_intents ?? [];
    if (disallowed.includes(classification.primaryIntent)) return false;

    return true;
  }
}
