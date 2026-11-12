import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InstagramContentService } from '../channels/instagram/instagram-content.service';
import { ContentMediaService } from '../content-media/content-media.service';
import { productRef } from '../agent/catalog/catalog-reader.service';
import type { MessageAttachment } from './entities/message.entity';

export interface MediaReference {
  mediaId: string;
  type: string;
  // Stories, posts and reels, from the message's attachment:
  /** Our copy of its image, which the agent sees in the history. */
  url?: string;
  image?: MessageAttachment['image'];
  caption?: string;
  /** Another account's post, not the shop's. */
  foreign?: boolean;
  reel?: boolean;
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
  story_reply: "replied to the shop's story",
  post_reply: 'replied to a post',
  post_share: 'shared a post',
  customer_photo: 'sent a photo',
  post_comment: "commented under the shop's post",
};

/** `certain`: a person or an exact signal linked it (manual, caption SKU, the same image); else an automatic image match. */
type Match = { productId: string; color: string | null; certain: boolean };
const EXACT_PHOTO_METHODS = new Set(['customer_photo_phash', 'customer_photo_exact']);

/**
 * Turns what the customer pointed at — a story or post they replied to, a
 * post or reel they shared or pasted a link to, a post they commented on, a
 * photo they sent — into a note for the agent, before it runs.
 *
 * - **A photo**: perceptual hash, then CLIP and a vision call
 *   (`matchCustomerPhoto`).
 * - **A story, post or reel**: its stored link to a product; else our copy
 *   of its image matched to a catalog photo by perceptual hash (the shop
 *   reusing a product photo); else a note telling the agent to identify the
 *   product from the image, which it sees in the history, or from the
 *   caption. The heavy photo matching isn't run for content.
 *
 * It never replies or hands off itself; the agent decides.
 */
@Injectable()
export class MediaContextResolver {
  private readonly logger = new Logger(MediaContextResolver.name);

  constructor(
    private readonly content: InstagramContentService,
    private readonly contentMedia: ContentMediaService,
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
    const what = describe(ref);
    const match = await this.match(tenantId, conversationId, ref);
    if (!match) return { note: unmatchedNote(ref, what), productId: null };

    const [product]: Array<{ title: string }> = await this.dataSource.query(
      `SELECT title FROM products WHERE id = $1 AND tenant_id = $2`,
      [match.productId, tenantId],
    );
    if (!product) return { note: null, productId: null };
    const named = `«${product.title}» (ref ${productRef(match.productId)}${match.color ? `, colour «${match.color}»` : ''})`;
    if (!match.certain) {
      return {
        note:
          `The customer ${what}, probably showing ${named}: an automatic image match nobody has confirmed. Check it ` +
          'with get_product and offer it as the likely item, not a certain one (for example «Схоже, це …»); if it ' +
          "isn't in stock, say so, then offer the closest alternatives.",
        productId: match.productId,
      };
    }
    return {
      note:
        `The customer ${what} showing ${named}. ` +
        'Their message is about this product unless they say otherwise; check it with get_product. ' +
        `If it is in stock${match.color ? ' in that colour' : ''}, offer this product, not alternatives. If it isn't, ` +
        'or not in the size they want, say so plainly, then offer the closest alternatives.',
      productId: match.productId,
    };
  }

  private async match(tenantId: string, conversationId: string, ref: MediaReference): Promise<Match | null> {
    try {
      if (ref.type === 'customer_photo') {
        const match = await this.content.matchCustomerPhoto(tenantId, ref.mediaId, { conversationId });
        if (!match) return null;
        // Remember the match so the next turn about the same photo skips matching.
        await this.content
          .persistCustomerPhotoMatch(tenantId, ref.mediaId, match)
          .catch((err) => this.logger.warn(`Failed to persist customer-photo match (non-fatal): ${err}`));
        return { productId: match.productId, color: match.color, certain: EXACT_PHOTO_METHODS.has(match.matchMethod) };
      }

      const mapping = await this.content.findByMediaId(tenantId, ref.mediaId);
      if (mapping?.productId) {
        return { productId: mapping.productId, color: mapping.linkedColor ?? null, certain: mapping.confirmed };
      }

      // Frames tiled into one image never hash like a catalog photo; a picture or a cover can.
      if (ref.url && ref.image !== 'video_frames') {
        const same = await this.contentMedia.matchCatalogImage(tenantId, ref.url);
        if (same) return { ...same, certain: true };
      }

      // Unknown story or post: recorded so the store can link it (the copy, when made, already did this).
      if (!ref.foreign && !mapping && ref.mediaId !== 'unknown' && !/^https?:\/\//i.test(ref.mediaId)) {
        await this.content
          .saveUnlinkedMedia(tenantId, ref.mediaId, ref.type === 'story_reply' ? 'story' : ref.type)
          .catch((err) => this.logger.warn(`Failed to save unlinked media (non-fatal): ${err}`));
      }
      return null;
    } catch (err) {
      this.logger.error(`Media resolution failed for ${ref.type} (treated as no match): ${err}`);
      return null;
    }
  }
}

function describe(ref: MediaReference): string {
  if (ref.type === 'post_share') {
    const what = ref.reel ? 'shared a reel' : 'shared a post';
    return ref.foreign ? `${what} from another account` : what;
  }
  return SOURCE_LABEL[ref.type] ?? 'sent media';
}

/** What the agent is told when nothing names the product. */
function unmatchedNote(ref: MediaReference, what: string): string {
  if (ref.type === 'customer_photo') {
    return (
      `The customer ${what}, but it wasn't recognised as one of the shop's product photos. Look at the photo ` +
      "yourself and find the closest products; you may say it looks like one of the shop's, but don't call it the same item."
    );
  }
  // A comment's answer is one text message: no photos to show.
  const comment = ref.type === 'post_comment';
  const closest = comment ? 'name the closest two or three briefly' : 'show the closest two or three with show_products';
  if (ref.url) {
    const shown =
      ref.image === 'video_frames'
        ? 'frames from its video are in the image above'
        : ref.image === 'video_cover'
          ? "its video's cover is in the image above"
          : 'it is in the image above';
    return (
      `The customer ${what}; ${shown}, and it isn't linked to a product. Read the text on it first (a name, an ` +
      "article, a price), then look at what's pictured, and search with search_products (sku for an article, price " +
      'for a price) or browse_category. ' +
      howSure(ref, closest, 'the picture') +
      ` If it shows several items, ${comment ? 'name them briefly' : 'show them with show_products'} and ask which one.`
    );
  }
  if (ref.caption) {
    return (
      `The customer ${what}, which isn't linked to a product, and you can't see it, only its caption (above). ` +
      'Search for what the caption names with search_products. ' +
      howSure(ref, closest, 'the caption') +
      " If the caption doesn't name the item they mean, say you can't see it and ask which item; when they ask about " +
      'something in it (a colour, a detail), offer what the shop has rather than asking them to describe it.'
    );
  }
  return `The customer ${what}, but it wasn't recognised as one of the shop's products. Ask what they mean, or hand off if you can't tell.`;
}

/**
 * How sure the agent may be about content nobody linked. An article or an
 * exact name identifies the product; a look-alike in the picture never does,
 * since the agent sees the catalog as text only.
 */
function howSure(ref: MediaReference, closest: string, from: string): string {
  if (ref.foreign) {
    return (
      "It was posted by another account, not the shop, so no product is the same item: say the ones you find look " +
      `like it, never that they're the same, and ${closest}.`
    );
  }
  return (
    'An article, or a name that fits exactly one product, identifies it: if that product is in stock, offer only ' +
    `it; if not, say so, then offer the closest alternatives. Without that you can't tell from ${from} which ` +
    "product it is (you see the catalog as text only), so don't present any product as the one pictured: say you " +
    `don't see exactly this item, or can't tell which model it is, and ${closest}.`
  );
}
