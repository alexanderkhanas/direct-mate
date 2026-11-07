import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InstagramContentService } from '../channels/instagram/instagram-content.service';
import { productRef } from '../agent/catalog/catalog-reader.service';

export interface MediaReference {
  mediaId: string;
  type: string;
}

export interface MediaContext {
  /** Context lines for the agent, naming the product when one was found. */
  notes: string[];
  /** The message text with a pasted post link removed, so the caption reads cleanly. */
  messageText: string;
  productId: string | null;
}

const POST_LINK = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+[^\s]*/i;
/** Matching runs per item; a burst of photos past this many isn't worth a vision call each. */
const MAX_REFERENCES = 3;

const SOURCE_LABEL: Record<string, string> = {
  story_reply: 'replied to a story',
  post_reply: 'replied to a post',
  post_share: 'shared a post',
  customer_photo: 'sent a photo',
};

/**
 * Turns what the customer pointed at — a story or post they replied to, a
 * post they shared or pasted a link to, a photo they sent — into a note
 * naming the product, before the agent runs. Deterministic and cheap: the
 * story/post mapping is a lookup, and photo matching tries a perceptual hash
 * before any vision call.
 *
 * It never replies or hands off itself. When nothing matches, the note says
 * so and the agent decides: for a photo, which it sees itself, find the
 * closest products; for a story or post, ask what they mean or hand off.
 * (The old engine always handed off here.)
 */
@Injectable()
export class MediaContextResolver {
  private readonly logger = new Logger(MediaContextResolver.name);

  constructor(
    private readonly content: InstagramContentService,
    private readonly dataSource: DataSource,
  ) {}

  /** `references`: what the customer's new messages pointed at, oldest first. */
  async resolve(
    tenantId: string,
    conversationId: string,
    references: MediaReference[],
    messageText: string,
  ): Promise<MediaContext> {
    let text = messageText;
    let refs = references.slice(0, MAX_REFERENCES);

    // A pasted post link counts as a post reply.
    const link = refs.length === 0 ? text.match(POST_LINK)?.[0] : undefined;
    if (link) {
      const mediaId = await this.content.resolveMediaIdByPostUrl(tenantId, link).catch((err) => {
        this.logger.warn(`Post link resolution failed (non-fatal): ${err}`);
        return null;
      });
      if (mediaId) {
        refs = [{ mediaId, type: 'post_reply' }];
        text = text.replace(link, '').replace(/\s{2,}/g, ' ').trim();
      }
    }

    const notes: string[] = [];
    let productId: string | null = null;
    for (const ref of refs) {
      const one = await this.resolveOne(tenantId, conversationId, ref);
      if (one.note) notes.push(one.note);
      productId ??= one.productId;
    }
    return { notes, messageText: text, productId };
  }

  private async resolveOne(
    tenantId: string,
    conversationId: string,
    ref: MediaReference,
  ): Promise<{ note: string | null; productId: string | null }> {
    const what = SOURCE_LABEL[ref.type] ?? 'sent media';
    const match = await this.match(tenantId, conversationId, ref);
    if (!match) {
      // A photo is in the agent's context, so it can look for itself; a story or post isn't.
      const next =
        ref.type === 'customer_photo'
          ? "Look at the photo yourself and find the closest products; you may say it looks like one of the shop's, " +
            "but don't call it the same item."
          : "Ask what they mean, or hand off if you can't tell.";
      return { note: `The customer ${what}, but it wasn't recognised as one of the shop's product photos. ${next}`, productId: null };
    }

    const [product]: Array<{ title: string }> = await this.dataSource.query(
      `SELECT title FROM products WHERE id = $1 AND tenant_id = $2`,
      [match.productId, tenantId],
    );
    if (!product) return { note: null, productId: null };
    const color = match.color ? `, colour «${match.color}»` : '';
    return {
      note:
        `The customer ${what} showing «${product.title}» (ref ${productRef(match.productId)}${color}). ` +
        'Their message is about this product unless they say otherwise; check it with get_product.',
      productId: match.productId,
    };
  }

  private async match(
    tenantId: string,
    conversationId: string,
    ref: MediaReference,
  ): Promise<{ productId: string; color: string | null } | null> {
    try {
      if (ref.type === 'customer_photo') {
        const match = await this.content.matchCustomerPhoto(tenantId, ref.mediaId, { conversationId });
        if (!match) return null;
        // Remember the match so the next turn about the same photo skips matching.
        await this.content
          .persistCustomerPhotoMatch(tenantId, ref.mediaId, match)
          .catch((err) => this.logger.warn(`Failed to persist customer-photo match (non-fatal): ${err}`));
        return { productId: match.productId, color: match.color };
      }

      const mapping = await this.content.findByMediaId(tenantId, ref.mediaId);
      if (mapping?.productId) return { productId: mapping.productId, color: mapping.linkedColor ?? null };

      // Unknown story/post: record it so the store can link it in the admin panel.
      await this.content
        .saveUnlinkedMedia(tenantId, ref.mediaId, ref.type)
        .catch((err) => this.logger.warn(`Failed to save unlinked media (non-fatal): ${err}`));
      return null;
    } catch (err) {
      this.logger.error(`Media resolution failed for ${ref.type} (treated as no match): ${err}`);
      return null;
    }
  }
}
