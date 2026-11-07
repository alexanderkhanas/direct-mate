import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MessageDirection, MessageRole } from '@direct-mate/shared';
import { ConversationsService } from '../conversations/conversations.service';
import { TurnRunner } from '../conversations/turn-runner.service';
import type { MessageAttachment } from '../conversations/entities/message.entity';
import { CustomerMediaService } from '../customer-media/customer-media.service';
import { ScenarioRunner, type ScenarioIdentity } from '../testing/scenario-runner.service';
import { OnboardingService } from './onboarding.service';

/**
 * Who the owner is in their own test chat. The `test` channel keeps these
 * conversations (and the orders they place, source `test`) out of the inbox,
 * the order list and analytics.
 */
const OWNER_TEST: ScenarioIdentity = { externalUserId: 'owner-test', channel: 'test', channelAccountId: 'owner-test' };
/** Messages per store per hour: enough to try everything, not enough to run up a bill. */
const MAX_MESSAGES_PER_HOUR = 60;

export interface TestChatMessage {
  role: 'customer' | 'bot';
  text: string;
  imageUrls?: string[];
}

/**
 * «Спробуйте свого бота»: the owner writes as a customer and gets the real
 * agent's answers, before the bot is turned on. Runs in demo mode (nothing
 * leaves the system) and answers even while the store is paused.
 */
@Injectable()
export class TestChatService {
  private readonly sent = new Map<string, number[]>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly conversations: ConversationsService,
    private readonly turnRunner: TurnRunner,
    private readonly media: CustomerMediaService,
    private readonly scenarios: ScenarioRunner,
    private readonly onboarding: OnboardingService,
  ) {}

  async send(
    tenantId: string,
    input: { text?: string; photoUrl?: string },
  ): Promise<{ messages: TestChatMessage[]; handoff: boolean }> {
    const text = (input.text ?? '').trim().slice(0, 1000);
    if (!text && !input.photoUrl) throw new BadRequestException('Write a message or attach a photo');
    // Only a photo this store uploaded here: the old console fetched any URL it was given.
    if (input.photoUrl && !input.photoUrl.startsWith(`/uploads/customer-media/${tenantId}/`)) {
      throw new BadRequestException('Upload the photo first');
    }
    this.throttle(tenantId);

    const customer = await this.conversations.findOrCreateCustomer(tenantId, OWNER_TEST.channel, OWNER_TEST.externalUserId);
    const { conversation } = await this.conversations.findOrCreateConversation(
      tenantId,
      customer.id,
      OWNER_TEST.channel,
      OWNER_TEST.channelAccountId,
    );
    const save = (body: string, attachments: MessageAttachment[] | null) =>
      this.conversations.saveMessage(conversation.id, tenantId, MessageDirection.Inbound, MessageRole.User, body, undefined, null, attachments);
    // Like Instagram, a photo is its own message before the text.
    if (input.photoUrl) await save('', [{ type: 'customer_photo', mediaId: input.photoUrl, url: input.photoUrl }]);
    if (text) await save(text, null);

    const result = await this.turnRunner.run({
      tenantId,
      conversationId: conversation.id,
      mode: 'demo',
      source: 'owner_test',
      ignorePause: true,
    });
    await this.onboarding.markTested(tenantId);
    return {
      messages: result.messages.map((m) => ({ role: 'bot', text: m.text, ...(m.imageUrls?.length && { imageUrls: m.imageUrls }) })),
      handoff: !!result.handoff,
    };
  }

  async uploadPhoto(tenantId: string, file: Buffer): Promise<{ url: string }> {
    const stored = await this.media.storeFromBuffer(tenantId, file);
    if (!stored.url) throw new BadRequestException("Couldn't read this image");
    return { url: stored.url };
  }

  /** The conversation so far, for when the owner comes back to the page. */
  async history(tenantId: string): Promise<TestChatMessage[]> {
    const rows: Array<{ role: string; text: string | null; attachments: MessageAttachment[] | null; raw_payload: { imageUrls?: string[] } | null }> =
      await this.dataSource.query(
        `SELECT m.role, m.text, m.attachments, m.raw_payload FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           JOIN customers cu ON cu.id = c.customer_id
          WHERE c.tenant_id = $1 AND c.channel = $2 AND cu.external_user_id = $3
          ORDER BY m.created_at, m.id`,
        [tenantId, OWNER_TEST.channel, OWNER_TEST.externalUserId],
      );
    return rows.map((r) => {
      const photos = (r.attachments ?? []).flatMap((a) => (a.url ? [a.url] : []));
      const images = r.role === MessageRole.User ? photos : (r.raw_payload?.imageUrls ?? []);
      return {
        role: r.role === MessageRole.User ? 'customer' : 'bot',
        text: r.text ?? '',
        ...(images.length > 0 && { imageUrls: images }),
      };
    });
  }

  /** Start over: the conversation, its draft and test orders, and uploaded photos. */
  async reset(tenantId: string): Promise<void> {
    await this.scenarios.cleanup(tenantId, OWNER_TEST);
  }

  private throttle(tenantId: string): void {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recent = (this.sent.get(tenantId) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= MAX_MESSAGES_PER_HOUR) {
      throw new HttpException('Too many test messages this hour — try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(Date.now());
    this.sent.set(tenantId, recent);
  }
}
