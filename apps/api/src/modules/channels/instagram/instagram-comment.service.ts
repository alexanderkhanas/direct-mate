import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectionType, MessageDirection, MessageRole } from '@direct-mate/shared';
import { IntegrationsService } from '../../integrations/integrations.service';
import { InstagramContentService } from './instagram-content.service';
import { AvailabilityService } from '../../availability/availability.service';
import { ClassifierService, ClassificationResult, AssistantMemory } from '../../engine/classifier.service';
import { TemplateEngineService, ProductSearchResult } from '../../engine/template-engine.service';
import { SizeChartsService } from '../../size-charts/size-charts.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { StoreConfig } from '../../engine/entities/store-config.entity';
import { CryptoService } from '../../../common/crypto.service';
import { withRetry } from '../../../common/retry';
import { CommentChangeValue } from './instagram.service';

/**
 * Intents that count as a product question worth answering on a comment.
 * Everything else (greeting, thanks, complaint, unknown, ...) is ignored
 * silently — reactions and discussion never trigger a reply.
 */
const PRODUCT_QUESTION_INTENTS = new Set([
  'ask_price',
  'availability_check',
  'product_inquiry',
  'category_browse',
  'size_chart_request',
]);

const DEFAULT_CONFIDENCE_THRESHOLD = 0.55;
const PUBLIC_REPLY_FALLBACK = 'Відповіли вам у дірект 💛';

/**
 * Handles Instagram comment webhooks (entry[].changes, field='comments').
 *
 * When a comment on a FEED post that is linked to a product is a product
 * question (price / availability / sizes / size chart), the bot posts a short
 * public reply under the comment ("Відповіли вам у дірект 💛") and sends the
 * actual answer as a private DM to the commenter. Anything else is ignored.
 *
 * This path is intentionally decoupled from the DM sales funnel
 * (`ReplyEngineService.process()` drives cart/checkout/variant-selection and is
 * the wrong fit for a single-shot comment answer). It reuses the stateless
 * classifier and the template engine's variable builder directly.
 *
 * Note: a private reply lands in the normal DM inbox, so the commenter's
 * follow-up DM arrives as a standard messaging event under channel
 * 'instagram' and flows through the DM funnel. The 'instagram_comment'
 * conversation created here is the audit record of the comment turn only.
 */
@Injectable()
export class InstagramCommentService {
  private readonly logger = new Logger(InstagramCommentService.name);
  /** Recently processed comment ids (dedup against Meta resends). */
  private readonly processedCommentIds = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly integrationsService: IntegrationsService,
    private readonly contentService: InstagramContentService,
    private readonly availabilityService: AvailabilityService,
    private readonly classifierService: ClassifierService,
    private readonly templateEngine: TemplateEngineService,
    private readonly sizeChartsService: SizeChartsService,
    private readonly conversationsService: ConversationsService,
    private readonly cryptoService: CryptoService,
    @InjectRepository(StoreConfig)
    private readonly storeConfigRepo: Repository<StoreConfig>,
  ) {}

  async handleComment(entryId: string, value: CommentChangeValue): Promise<void> {
    const commentId = value.id;
    const fromId = value.from?.id;
    const mediaId = value.media?.id;
    const text = value.text?.trim();

    // Basic shape guards
    if (!commentId || !fromId || !mediaId || !text) {
      this.logger.debug('Comment ignored: incomplete payload');
      return;
    }

    // Scope to FEED posts for now (skip reels/ads/igtv product types)
    if (value.media?.media_product_type && value.media.media_product_type !== 'FEED') {
      this.logger.debug(`Comment ignored: media_product_type=${value.media.media_product_type}`);
      return;
    }

    // Dedup against Meta resends (in-memory, TTL). Belt-and-braces only —
    // reactions never reach persistence so there's no DB row to check.
    if (this.processedCommentIds.has(commentId)) {
      this.logger.debug(`Comment ${commentId} already processed — skipping`);
      return;
    }

    // Resolve the tenant/connection. entry.id is the IG Business Account id in
    // production; Meta test payloads send "0" which resolves to nothing → skip.
    const connection = await this.integrationsService.findByExternalAccountId(
      entryId,
      ConnectionType.Instagram,
    );
    if (!connection) {
      this.logger.debug(`No connected Instagram account for entry ${entryId} — skipping comment`);
      return;
    }
    const tenantId = connection.tenantId;

    // Loop prevention: our own public reply is itself a comment → Meta re-fires
    // a comments event with from.id == our account id. Never reply to ourselves.
    if (connection.externalAccountId && fromId === connection.externalAccountId) {
      this.logger.debug('Comment ignored: authored by the connected account (own reply)');
      return;
    }

    // Feature flag (default on). Tenants can disable comment handling via
    // flow_config.commentHandling.enabled = false.
    const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId } });
    const commentCfg = (storeConfig?.flowConfig as any)?.commentHandling ?? {};
    if (commentCfg.enabled === false) {
      this.logger.debug(`Comment handling disabled for tenant ${tenantId}`);
      return;
    }
    const confidenceThreshold =
      typeof commentCfg.confidenceThreshold === 'number'
        ? commentCfg.confidenceThreshold
        : DEFAULT_CONFIDENCE_THRESHOLD;

    // Resolve the post → product. Ignore silently when unlinked / no product.
    const mapping = await this.contentService.findByMediaId(tenantId, mediaId);
    if (!mapping?.productId) {
      this.logger.debug(`Comment ignored: post ${mediaId} not linked to a product`);
      return;
    }
    const productData = await this.availabilityService.findAllByProductId(mapping.productId);
    if (productData.length === 0) {
      this.logger.debug(`Comment ignored: no active variants for product ${mapping.productId}`);
      return;
    }

    // Classify the comment text (stateless — empty memory, tenant categories).
    const businessType = (storeConfig?.flowConfig as any)?.businessType as
      | 'clothing'
      | 'cosmetics'
      | undefined;
    const categories = await this.availabilityService.getCategories(tenantId);
    const classification = await this.classifierService.classify({
      messageText: text,
      recentMessages: [],
      memory: {} as AssistantMemory,
      categories,
      tenantBusinessType: businessType,
    });

    if (
      !PRODUCT_QUESTION_INTENTS.has(classification.primaryIntent) ||
      classification.confidence < confidenceThreshold
    ) {
      this.logger.log(
        `Comment ${commentId} ignored: intent=${classification.primaryIntent} ` +
          `confidence=${classification.confidence} (not a product question)`,
      );
      return;
    }

    // Build the DM answer from templates before touching the DB — if we can't
    // produce an answer, ignore silently rather than persist a dead-end.
    const answer = await this.buildAnswer(tenantId, classification, mapping.productId, productData);
    if (!answer?.text) {
      this.logger.log(`Comment ${commentId}: no template answer produced — ignoring`);
      return;
    }

    // Mark processed only once we've committed to answering.
    this.markProcessed(commentId);

    // Persist under a dedicated channel, isolated from DM threads by the
    // (tenantId, channel, externalUserId) unique key.
    const customer = await this.conversationsService.findOrCreateCustomer(
      tenantId,
      'instagram_comment',
      fromId,
    );
    if (!customer.username && value.from?.username) {
      await this.conversationsService.updateCustomer(customer.id, {
        username: value.from.username,
      });
    }
    const { conversation } = await this.conversationsService.findOrCreateConversation(
      tenantId,
      customer.id,
      'instagram_comment',
      mediaId,
    );
    await this.conversationsService.saveMessage(
      conversation.id,
      tenantId,
      MessageDirection.Inbound,
      MessageRole.User,
      text,
      commentId,
      { commentId, parentId: value.parent_id ?? null, mediaId, productId: mapping.productId },
    );

    if (!connection.accessTokenEncrypted) {
      this.logger.warn(`No access token for connection ${connection.id} — cannot reply to comment`);
      return;
    }
    const token = this.cryptoService.decrypt(connection.accessTokenEncrypted);

    // 1) Public reply under the comment (short nudge to the inbox).
    const publicText =
      (await this.templateEngine.renderCustomScenario(tenantId, 'comment_public_reply', {}))?.text ??
      PUBLIC_REPLY_FALLBACK;
    await withRetry(() => this.replyToComment(commentId, publicText, token), {
      label: `comment-public-reply-${commentId}`,
      maxAttempts: 3,
      baseDelayMs: 2000,
    }).catch((err) =>
      this.logger.error(`Public comment reply failed for ${commentId}`, (err as Error).message),
    );

    // 2) Private DM with the actual answer. Private reply is the sanctioned way
    //    to open a DM from a comment (recipient: { comment_id }).
    try {
      if (answer.imageUrls?.length) {
        await this.sendPrivateReplyImages(commentId, answer.imageUrls, token).catch((err) =>
          this.logger.warn(
            `Private reply images failed (non-fatal) for ${commentId}: ${(err as Error).message}`,
          ),
        );
      }
      await withRetry(() => this.sendPrivateReply(commentId, answer.text, token), {
        label: `comment-private-reply-${commentId}`,
        maxAttempts: 3,
        baseDelayMs: 2000,
      });
      await this.conversationsService.saveMessage(
        conversation.id,
        tenantId,
        MessageDirection.Outbound,
        MessageRole.Assistant,
        answer.text,
      );
      this.logger.log(
        `Answered comment ${commentId} on product ${mapping.productId} (intent=${classification.primaryIntent})`,
      );
    } catch (err) {
      this.logger.error(
        `Private DM reply failed for comment ${commentId}`,
        (err as Error).message,
      );
    }
  }

  /**
   * Build the DM answer text (+ images) from templates. size_chart_request is
   * handled with the size-chart resolver + explicit variables; every other
   * product-question intent goes through the standard template variable builder
   * (`render`), which maps ask_price → show_price, availability/inquiry →
   * show_products, etc. and interpolates product_name / price / product_list.
   */
  private async buildAnswer(
    tenantId: string,
    classification: ClassificationResult,
    productId: string,
    productData: ProductSearchResult[],
  ): Promise<{ text: string; imageUrls?: string[] } | null> {
    if (classification.primaryIntent === 'size_chart_request') {
      const { brand, category } = await this.sizeChartsService.getBrandAndCategoryForProduct(
        tenantId,
        productId,
      );
      const chart = await this.sizeChartsService.resolveForContext(tenantId, { brand, category });
      if (chart) {
        const rendered = await this.templateEngine.renderCustomScenario(tenantId, 'show_size_chart', {
          brand: brand ?? category ?? '',
          name: chart.name,
        });
        if (rendered?.text) {
          return { text: rendered.text, imageUrls: [this.sizeChartsService.publicUrl(chart.imagePath)] };
        }
      }
      // No chart / no template → fall through to a product answer (list sizes).
    }

    const rendered = await this.templateEngine.render({
      tenantId,
      classification,
      productData,
      memory: {} as AssistantMemory,
      recentTemplateIds: [],
    });
    if (!rendered?.text) return null;
    return { text: rendered.text, imageUrls: rendered.imageUrls };
  }

  // ─── Graph API senders (self-contained to keep this service independent of
  //     InstagramService, which depends on us) ──────────────────────────────

  /** Public reply threaded under the comment. */
  private async replyToComment(commentId: string, text: string, token: string): Promise<void> {
    const res = await fetch(`https://graph.instagram.com/v21.0/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      throw new Error(`Comment reply error ${res.status}: ${await res.text()}`);
    }
  }

  /** Private reply DM to the commenter (recipient: { comment_id }). */
  private async sendPrivateReply(commentId: string, text: string, token: string): Promise<void> {
    const res = await fetch('https://graph.instagram.com/v21.0/me/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
    });
    if (!res.ok) {
      throw new Error(`Private reply error ${res.status}: ${await res.text()}`);
    }
  }

  /** Image attachments over the private-reply channel (best-effort). */
  private async sendPrivateReplyImages(
    commentId: string,
    imageUrls: string[],
    token: string,
  ): Promise<void> {
    const absoluteUrls = imageUrls.map((u) => this.toPublicImageUrl(u));
    const res = await fetch('https://graph.instagram.com/v21.0/me/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { attachments: absoluteUrls.map((url) => ({ type: 'image', payload: { url } })) },
      }),
    });
    if (!res.ok) {
      throw new Error(`Private reply images error ${res.status}: ${await res.text()}`);
    }
  }

  /** Mirrors InstagramService.toPublicImageUrl — absolutize relative paths. */
  private toPublicImageUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = (this.config.get<string>('app.baseUrl') ?? '').replace(/\/$/, '');
    const clean = url.replace(/^\//, '');
    return base ? `${base}/${clean}` : url;
  }

  private markProcessed(commentId: string): void {
    this.processedCommentIds.add(commentId);
    setTimeout(() => this.processedCommentIds.delete(commentId), 10 * 60 * 1000);
  }
}
