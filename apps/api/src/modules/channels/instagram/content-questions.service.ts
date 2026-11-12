import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../../common/db';
import { TelegramService } from '../../notifications/telegram.service';
import { ContentLinksService } from './content-links.service';

/** Questions to one store's owner per rolling day; the rest wait on the Content page («Перевірити»). */
export const MAX_QUESTIONS_PER_DAY = 5;
const ANSWER = /^cl:([0-9a-f-]{36}):([yn])$/i;

interface Claimed {
  id: string;
  source: string;
  color: string | null;
  title: string;
  media_type: string;
  media_product_type: string | null;
  image_path: string | null;
}

/**
 * Asks a store's owner, in Telegram, whether a suggestion is the item a story,
 * post or reel shows: «Так, це він» / «Ні», one tap. Only the owner makes a
 * suggestion certain; a customer's order is evidence, not proof (they may
 * knowingly order the closest match).
 *
 * - Once per link (`owner_asked_at`), at most MAX_QUESTIONS_PER_DAY per store.
 * - A tap counts only from a chat that store connected.
 */
@Injectable()
export class ContentQuestionsService implements OnModuleInit {
  private readonly logger = new Logger(ContentQuestionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly telegram: TelegramService,
    private readonly links: ContentLinksService,
  ) {}

  onModuleInit(): void {
    this.telegram.onCallback('cl', (data, chatId) => this.answer(data, chatId));
  }

  /**
   * A live order: picks this conversation made gain the order id, and a
   * suggestion's first order asks the owner. Never throws.
   */
  async afterOrder(tenantId: string, conversationId: string, order: { orderId: string; checkoutSessionId: string }): Promise<void> {
    try {
      const changed = await this.links.addOrder(tenantId, conversationId, order);
      for (const link of changed) {
        if (link.status === 'suggested' && !link.ownerAskedAt) await this.ask(tenantId, link.id);
      }
    } catch (err) {
      this.logger.warn(`Content evidence for order ${order.orderId} failed (non-fatal): ${(err as Error).message}`);
    }
  }

  /** Ask about one suggestion, once, within the daily cap. True when someone was asked. */
  async ask(tenantId: string, linkId: string): Promise<boolean> {
    // Claimed before sending, so two turns never ask twice.
    const [claimed] = returnedRows<Claimed>(
      await this.dataSource.query(
        `UPDATE content_products cp SET owner_asked_at = now()
           FROM instagram_media_mappings m, products p
          WHERE cp.id = $1 AND cp.tenant_id = $2 AND cp.status = 'suggested' AND cp.owner_asked_at IS NULL
            AND m.id = cp.mapping_id AND p.id = cp.product_id
            AND (SELECT count(*) FROM content_products q
                  WHERE q.tenant_id = $2 AND q.owner_asked_at > now() - interval '1 day') < $3
          RETURNING cp.id, cp.source, cp.color, p.title, m.media_type, m.media_product_type, m.image_path`,
        [linkId, tenantId, MAX_QUESTIONS_PER_DAY],
      ),
    );
    if (!claimed) return false;

    const sent = await this.telegram.askTenant(tenantId, {
      text: questionText(claimed),
      imagePath: claimed.image_path,
      buttons: [
        { text: 'Так, це він', data: `cl:${claimed.id}:y` },
        { text: 'Ні', data: `cl:${claimed.id}:n` },
      ],
    });
    if (sent === 0) {
      // No Telegram connected (or it failed): the Content page still has it, and a later order may ask again.
      await this.dataSource.query(`UPDATE content_products SET owner_asked_at = NULL WHERE id = $1`, [claimed.id]);
      return false;
    }
    return true;
  }

  /** A tap on «Так, це він» / «Ні». Null (nothing changes) unless it comes from a chat of the link's store. */
  async answer(data: string, chatId: string): Promise<string | null> {
    const match = ANSWER.exec(data);
    if (!match) return null;
    const [, linkId, yes] = match;
    const [link]: Array<{ tenant_id: string }> = await this.dataSource.query(
      `SELECT tenant_id FROM content_products WHERE id = $1`,
      [linkId],
    );
    if (!link) return null;
    if (!(await this.telegram.chatIdsFor(link.tenant_id)).includes(chatId)) {
      this.logger.warn(`Content question ${linkId}: a tap from chat ${chatId}, which isn't the store's`);
      return null;
    }
    const status = yes.toLowerCase() === 'y' ? 'confirmed' : 'rejected';
    if (!(await this.links.setStatus(link.tenant_id, linkId, status))) return null;
    return status === 'confirmed'
      ? '✅ Підтверджено. AI-агент пропонуватиме цей товар як той, що на фото.'
      : '❌ Відхилено. AI-агент не пропонуватиме цей товар до цього контенту.';
  }
}

/** «Клієнт, який писав про цю сторіс, замовив «Штани з затяжками» (чорний). У сторіс саме цей товар?» */
export function questionText(c: Pick<Claimed, 'source' | 'color' | 'title' | 'media_type' | 'media_product_type'>): string {
  const kind =
    c.media_type === 'story' || c.media_type === 'story_reply' ? 'story' : c.media_product_type === 'REELS' ? 'reel' : 'post';
  const thisOne = { story: 'цю сторіс', reel: 'цей рілс', post: 'цей допис' }[kind];
  const inIt = { story: 'У сторіс', reel: 'У рілсі', post: 'У дописі' }[kind];
  const product = `«${c.title}»${c.color ? ` (${c.color.toLowerCase()})` : ''}`;
  const why =
    c.source === 'vision'
      ? `AI-агент порівняв ${thisOne} з каталогом: схоже, це ${product}.`
      : `Клієнт, який писав про ${thisOne}, замовив ${product}.`;
  return (
    `🔎 AI-агент питає\n\n${why}\n${inIt} саме цей товар?\n\n` +
    'Якщо так, AI-агент одразу називатиме його наступним клієнтам. Якщо ні, більше не пропонуватиме як той, що на фото.'
  );
}
