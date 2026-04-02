import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractedConversationFragment } from './entities/extracted-conversation-fragment.entity';

interface BotAnalysis {
  classification: Record<string, unknown> | null;
  botReply: string | null;
  templateScenario: string | null;
}

interface PendingMessage {
  text: string;
  timestamp: number;
  botAnalysis: BotAnalysis | null;
}

@Injectable()
export class LearningObserverService {
  private readonly logger = new Logger(LearningObserverService.name);

  // conversationId → most recent customer message + optional bot analysis
  private readonly recentCustomerMessages = new Map<string, PendingMessage>();

  constructor(
    @InjectRepository(ExtractedConversationFragment)
    private readonly fragmentRepo: Repository<ExtractedConversationFragment>,
  ) {}

  recordCustomerMessage(conversationId: string, text: string): void {
    const existing = this.recentCustomerMessages.get(conversationId);
    if (existing) {
      // Accumulate multiple messages (same as debounce join behaviour)
      existing.text = existing.text + '\n' + text;
      existing.timestamp = Date.now();
    } else {
      this.recentCustomerMessages.set(conversationId, {
        text,
        timestamp: Date.now(),
        botAnalysis: null,
      });
    }
  }

  recordBotAnalysis(conversationId: string, analysis: BotAnalysis): void {
    const pending = this.recentCustomerMessages.get(conversationId);
    if (pending) {
      pending.botAnalysis = analysis;
    }
  }

  async recordManagerReply(
    tenantId: string,
    conversationId: string,
    managerText: string,
  ): Promise<void> {
    const pending = this.recentCustomerMessages.get(conversationId);
    if (!pending) return;

    // Only pair if the customer message was within the last 10 minutes
    if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
      this.recentCustomerMessages.delete(conversationId);
      return;
    }

    this.recentCustomerMessages.delete(conversationId);

    const transcript = [
      { speaker: 'customer', text: pending.text },
      { speaker: 'manager', text: managerText },
    ];

    const analysis = pending.botAnalysis;

    await this.fragmentRepo.save(
      this.fragmentRepo.create({
        fileId: null,
        tenantId,
        transcriptJson: transcript,
        scenarioSuggestion: analysis?.templateScenario ?? null,
        confidenceScore: analysis?.classification
          ? ((analysis.classification as any).confidence ?? 1.0)
          : 1.0,
        reviewStatus: 'pending',
        source: 'live_observation',
        classificationJson: analysis?.classification ?? null,
        botReply: analysis?.botReply ?? null,
        templateScenario: analysis?.templateScenario ?? null,
      }),
    );

    this.logger.log(`Learning fragment saved for tenant ${tenantId}`);
  }
}
