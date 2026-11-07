import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * OpenAI's moderation check on a reply before it is sent (free, ~200 ms). The
 * deterministic guards catch invented facts and promises; this catches a
 * reply that is abusive, hateful, sexual or violent, which a customer could
 * talk the model into and screenshot.
 *
 * Fails open: if the check is off (`AGENT_MODERATION=false`), has no key or
 * errors, the reply is treated as clean. Its job is to stop a rare bad reply,
 * not to make every reply depend on one more service.
 */
@Injectable()
export class ReplyModeration {
  private readonly logger = new Logger(ReplyModeration.name);
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  /** The categories the reply was flagged for; empty when it's fine or the check couldn't run. */
  async flaggedCategories(text: string): Promise<string[]> {
    const client = this.openai();
    if (!client || !text.trim()) return [];
    try {
      const res = await client.moderations.create({ model: 'omni-moderation-latest', input: text });
      const result = res.results[0];
      if (!result?.flagged) return [];
      return Object.entries(result.categories)
        .filter(([, on]) => on)
        .map(([name]) => name);
    } catch (err) {
      this.logger.warn(`Moderation check failed, reply treated as clean: ${(err as Error).message}`);
      return [];
    }
  }

  private openai(): OpenAI | null {
    if (this.config.get<boolean>('agent.moderation') === false) return null;
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('openai.apiKey');
    if (!apiKey) return null;
    this.client = new OpenAI({ apiKey, timeout: 5_000, maxRetries: 1 });
    return this.client;
  }
}
