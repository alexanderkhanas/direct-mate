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

    // 4. Check low confidence
    const confidenceThreshold = escalation.low_confidence_threshold ?? 0.7;
    if (classification.confidence < confidenceThreshold) {
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
