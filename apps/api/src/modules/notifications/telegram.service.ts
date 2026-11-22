import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { TelegramConnectToken } from './entities/telegram-connect-token.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { withRetry } from '../../common/retry';
import { formatCurrency } from '../../common/format';
import { uploadPath } from '../../common/uploads';
import { readFile } from 'fs/promises';
import { basename } from 'path';

interface HandoffParams {
  tenantId: string;
  customerName: string;
  reason: string;
  conversationId: string;
  lastMessage?: string;
  summary?: string;
}

/** A tap on an inline button, as Telegram sends it. */
export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number | string }; text?: string; caption?: string; photo?: unknown[] };
}

/**
 * Handles taps whose `callback_data` starts with its prefix («cl:…»). Returns
 * the line to append to the message (its buttons go), or null to leave the
 * message as it is (a tap from a chat it doesn't belong to, a stale button).
 */
export type CallbackHandler = (data: string, chatId: string) => Promise<string | null>;

/** A question for a store's owner: text, an optional picture we hold, one row of buttons. */
export interface OwnerQuestion {
  text: string;
  /** `/uploads/…`: sent as the message's photo. */
  imagePath?: string | null;
  buttons: Array<{ text: string; data: string }>;
}

export interface NewOrderParams {
  tenantId: string;
  orderId: string;
  items: Array<{ title: string; color: string | null; size: string | null; qty: number; unitPrice: number | null }>;
  totalAmount: number;
  currency: string;
  /** What the customer gave for delivery (`checkout_customer_info`); null when nothing was saved. */
  delivery: {
    fullName: string | null;
    phone: string | null;
    city: string | null;
    branch: string | null;
    paymentMethod: string | null;
    comment: string | null;
  } | null;
  /** Instagram name or username, when the customer gave no name for delivery. */
  customerName: string;
}

const PAYMENT_METHODS: Record<string, string> = {
  cod: 'Накладений платіж',
  prepay: 'Передоплата на картку',
};

/** The order number the admin shows («ID: fe4fb7c7…»), so a manager can find it there. */
export function orderNumber(orderId: string): string {
  return orderId.slice(0, 8);
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly callbackHandlers = new Map<string, CallbackHandler>();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(TelegramConnectToken)
    private readonly connectTokenRepo: Repository<TelegramConnectToken>,
    @InjectRepository(StoreConfig)
    private readonly storeConfigRepo: Repository<StoreConfig>,
  ) {}

  async generateConnectToken(tenantId: string): Promise<{ token: string; deepLink: string }> {
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const entity = this.connectTokenRepo.create({
      tenantId,
      token,
      expiresAt,
    });
    await this.connectTokenRepo.save(entity);

    const botUsername = this.config.get<string>('telegram.botUsername') ?? 'DirectMateBot';
    const deepLink = `https://t.me/${botUsername}?start=${token}`;

    return { token, deepLink };
  }

  async handleStart(token: string, chatId: string): Promise<boolean> {
    const connectToken = await this.connectTokenRepo.findOne({
      where: {
        token,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!connectToken) {
      return false;
    }

    // Mark token as used
    connectToken.usedAt = new Date();
    await this.connectTokenRepo.save(connectToken);

    // Update store_configs handoff_config with telegramChatId
    const storeConfig = await this.storeConfigRepo.findOne({
      where: { tenantId: connectToken.tenantId },
    });

    if (storeConfig) {
      const existing = (storeConfig.handoffConfig as any)?.telegramChatIds ?? [];
      // Also migrate legacy single telegramChatId
      const legacyChatId = (storeConfig.handoffConfig as any)?.telegramChatId;
      const allIds = new Set<string>([...existing, ...(legacyChatId ? [legacyChatId] : []), String(chatId)]);
      const handoffConfig = { ...storeConfig.handoffConfig, telegramChatIds: [...allIds], telegramChatId: undefined };
      delete handoffConfig.telegramChatId;
      await this.storeConfigRepo.update(storeConfig.id, {
        handoffConfig: handoffConfig as any,
      });
    } else {
      const newConfig = this.storeConfigRepo.create({
        tenantId: connectToken.tenantId,
        handoffConfig: { telegramChatIds: [String(chatId)] } as any,
      });
      await this.storeConfigRepo.save(newConfig);
    }

    // Send confirmation message
    await this.sendMessage(
      chatId,
      '✅ Telegram підключено! Тепер ви будете отримувати сповіщення про нові звернення.',
    );

    return true;
  }

  async getConnectionStatus(tenantId: string): Promise<{ connected: boolean; chatIds: string[] }> {
    const storeConfig = await this.storeConfigRepo.findOne({
      where: { tenantId },
    });

    const config = storeConfig?.handoffConfig as any;
    const chatIds: string[] = config?.telegramChatIds ?? (config?.telegramChatId ? [config.telegramChatId] : []);
    return {
      connected: chatIds.length > 0,
      chatIds,
    };
  }

  async removeChatId(tenantId: string, chatId: string): Promise<void> {
    const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId } });
    if (!storeConfig) return;

    const config = storeConfig.handoffConfig as any;
    const chatIds: string[] = config?.telegramChatIds ?? [];
    const filtered = chatIds.filter((id: string) => id !== chatId);

    await this.storeConfigRepo.update(storeConfig.id, {
      handoffConfig: { ...config, telegramChatIds: filtered, telegramChatId: undefined } as any,
    });
  }

  /** A message to the founder's chat (`PLATFORM_TELEGRAM_CHAT_ID`); does nothing when unset, never throws. */
  async notifyPlatform(text: string): Promise<void> {
    const chatId = this.config.get<string>('telegram.platformChatId');
    if (!chatId) return;
    await this.sendMessage(chatId, text);
  }

  /** Send once; never throws (logs the failure). */
  async sendMessage(chatId: string, text: string, parseMode?: 'HTML'): Promise<void> {
    await this.post(chatId, text, parseMode).catch((err) =>
      this.logger.error(`Telegram sendMessage failed: ${(err as Error).message}`),
    );
  }

  /** Throws on failure, so `withRetry` can retry it. */
  private async post(chatId: string, text: string, parseMode?: 'HTML'): Promise<void> {
    const botToken = this.config.get<string>('telegram.botToken');
    if (!botToken) {
      this.logger.warn('Telegram bot token not configured — skipping message send');
      return;
    }
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (parseMode) body.parse_mode = parseMode;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} — ${await res.text()}`);
  }

  /**
   * Another module answers taps on its buttons: `callback_data` «<prefix>:…».
   * Registered at startup (onModuleInit), so this module imports nothing of
   * theirs.
   */
  onCallback(prefix: string, handler: CallbackHandler): void {
    this.callbackHandlers.set(prefix, handler);
  }

  /** A button tap from the webhook: the handler decides; the message then shows the outcome without its buttons. */
  async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const data = query.data ?? '';
    const chatId = query.message ? String(query.message.chat.id) : null;
    const handler = this.callbackHandlers.get(data.split(':')[0]);
    let outcome: string | null = null;
    if (handler && chatId) {
      outcome = await handler(data, chatId).catch((err) => {
        this.logger.error(`Telegram callback ${data} failed: ${(err as Error).message}`);
        return null;
      });
    }
    await this.call('answerCallbackQuery', { callback_query_id: query.id, ...(outcome && { text: outcome.slice(0, 190) }) }).catch(
      (err) => this.logger.warn(`answerCallbackQuery failed: ${(err as Error).message}`),
    );
    if (!outcome || !query.message || !chatId) return;
    const before = query.message.caption ?? query.message.text ?? '';
    const text = `${before}\n\n${outcome}`;
    // Editing without reply_markup removes the buttons.
    await this.call(query.message.photo ? 'editMessageCaption' : 'editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      ...(query.message.photo ? { caption: text.slice(0, 1024) } : { text: text.slice(0, 4096) }),
    }).catch((err) => this.logger.warn(`Editing the answered question failed: ${(err as Error).message}`));
  }

  /**
   * A question with buttons to every chat the store connected. A picture we
   * hold goes as the photo, else the text alone. Never throws. Returns how many
   * chats got it.
   */
  async askTenant(tenantId: string, question: OwnerQuestion): Promise<number> {
    const chatIds = await this.chatIdsFor(tenantId);
    const keyboard = { inline_keyboard: [question.buttons.map((b) => ({ text: b.text, callback_data: b.data }))] };
    const file = question.imagePath ? uploadPath(question.imagePath) : null;
    const photo = file ? await readFile(file).catch(() => null) : null;
    let sent = 0;
    for (const chatId of chatIds) {
      try {
        if (photo && file) {
          const form = new FormData();
          form.append('chat_id', chatId);
          form.append('caption', question.text.slice(0, 1024));
          form.append('reply_markup', JSON.stringify(keyboard));
          form.append('photo', new Blob([new Uint8Array(photo)]), basename(file));
          await this.call('sendPhoto', form);
        } else {
          await this.call('sendMessage', { chat_id: chatId, text: question.text, reply_markup: keyboard });
        }
        sent++;
      } catch (err) {
        this.logger.error(`Telegram question to ${chatId} failed: ${(err as Error).message}`);
      }
    }
    return sent;
  }

  /** One Bot API call; throws on failure. Without a bot token it does nothing. */
  private async call(method: string, body: Record<string, unknown> | FormData): Promise<void> {
    const botToken = this.config.get<string>('telegram.botToken');
    if (!botToken) {
      this.logger.warn(`Telegram bot token not configured — skipping ${method}`);
      return;
    }
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      ...(body instanceof FormData
        ? { body }
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${method}: ${res.status} — ${await res.text()}`);
  }

  /** The chats a store connected (handoff notices, orders, questions). */
  async chatIdsFor(tenantId: string): Promise<string[]> {
    return this.getChatIds(tenantId);
  }

  private async getChatIds(tenantId: string): Promise<string[]> {
    const storeConfig = await this.storeConfigRepo.findOne({ where: { tenantId } });
    const config = storeConfig?.handoffConfig as any;
    return config?.telegramChatIds ?? (config?.telegramChatId ? [config.telegramChatId] : []);
  }

  async sendToTenant(tenantId: string, message: string): Promise<void> {
    return this.sendToAll(tenantId, message);
  }

  /**
   * Each chat is retried on its own, so a retry never sends a second copy to
   * a chat that already got it. Never throws: a notification must not fail
   * the turn that triggered it.
   */
  private async sendToAll(tenantId: string, message: string): Promise<void> {
    const chatIds = await this.getChatIds(tenantId);
    await Promise.all(
      chatIds.map((id) =>
        withRetry(() => this.post(id, message), { label: `telegram-${id}`, maxAttempts: 3, baseDelayMs: 1000 }).catch(
          (err) => this.logger.error(`Telegram notification to ${id} failed after retries: ${(err as Error).message}`),
        ),
      ),
    );
  }

  async notifyHandoff(params: HandoffParams): Promise<void> {
    const now = new Date();
    const dateStr = now.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

    const adminBase = (this.config.get<string>('admin.baseUrl') ?? '').replace(/\/$/, '');
    const said = params.lastMessage?.trim();
    const message = [
      '🔔 Нове звернення',
      '',
      `👤 ${params.customerName}`,
      `🕐 ${dateStr} ${timeStr}`,
      `⚠️ ${this.humanReadableReason(params.reason)}`,
      // The customer's own words, so the manager doesn't depend on the AI's
      // reading of them: a customer can steer what the summary says.
      ...(said ? ['', `💬 Клієнт: «${said.length > 300 ? `${said.slice(0, 300)}…` : said}»`] : []),
      ...(params.summary ? ['', `🤖 Підсумок від AI: ${params.summary}`] : []),
      ...(adminBase ? ['', `${adminBase}/conversations/${params.conversationId}`] : []),
    ].join('\n');

    await this.sendToAll(params.tenantId, message);
  }

  async notifyNewOrder(params: NewOrderParams): Promise<void> {
    await this.sendToAll(params.tenantId, this.newOrderMessage(params));
  }

  /** Plain text (no parse mode): names, addresses and comments are the customer's own words. */
  newOrderMessage(params: NewOrderParams): string {
    const currency = formatCurrency(params.currency);
    const money = (amount: number) => `${amount} ${currency}`;
    const items = params.items.map((item) => {
      const variant = [item.color, item.size].filter(Boolean).join(', ');
      const qty = item.qty > 1 ? ` × ${item.qty}` : '';
      const price = item.unitPrice != null ? ` — ${money(item.unitPrice * item.qty)}` : '';
      return `🛍 ${item.title}${variant ? ` (${variant})` : ''}${qty}${price}`;
    });
    const d = params.delivery;
    const place = [d?.city, d?.branch && `Нова Пошта: ${d.branch}`].filter(Boolean).join(', ');
    const payment = d?.paymentMethod ? (PAYMENT_METHODS[d.paymentMethod] ?? d.paymentMethod) : null;
    const comment = d?.comment?.trim();
    const adminBase = (this.config.get<string>('admin.baseUrl') ?? '').replace(/\/$/, '');

    return [
      `📦 Нове замовлення № ${orderNumber(params.orderId)}`,
      '',
      ...items,
      `💰 Разом: ${money(params.totalAmount)}`,
      '',
      `👤 ${d?.fullName || params.customerName}`,
      ...(d?.phone ? [`📞 ${d.phone}`] : []),
      ...(place ? [`📍 ${place}`] : []),
      ...(payment ? [`💳 ${payment}`] : []),
      ...(comment ? [`💬 ${comment.length > 300 ? `${comment.slice(0, 300)}…` : comment}`] : []),
      ...(adminBase ? ['', `${adminBase}/orders?order=${params.orderId}`] : []),
    ].join('\n');
  }

  private humanReadableReason(reason: string): string {
    const map: Record<string, string> = {
      product_not_found: 'Товар не знайдено',
      ai_failure: 'Помилка AI',
      low_confidence: 'Низька впевненість класифікатора',
      negative_sentiment: 'Негативний настрій клієнта',
      explicit_request: 'Клієнт просить менеджера',
      always_escalate: 'Завжди передавати менеджеру',
      send_failed: 'Не вдалося відправити повідомлення',
      unknown: 'Невідома причина',
      // v2 agent
      customer_asked_for_human: 'Клієнт просить менеджера',
      lost_context: 'AI-агент не зрозумів, чого хоче клієнт',
      complaint_or_return: 'Скарга, повернення або обмін',
      order_change: 'Зміна вже оформленого замовлення',
      payment_check: 'Клієнт надіслав підтвердження оплати — перевірте',
      // Reasons the model no longer has, kept for handoffs made before Nov 21 2026:
      health_or_safety: "Питання про здоров'я чи безпеку",
      not_in_store_notes: 'Питання, на яке AI-агент не має відповіді',
      unsure: 'AI-агент не впевнений у відповіді',
      other: 'Інша причина',
      ungrounded_reply: 'AI-агент не зміг підтвердити факти для відповіді',
      step_limit: 'AI-агент не зміг завершити відповідь',
      empty_reply: 'AI-агент не сформував відповідь',
      agent_error: 'Помилка AI',
      runner_error: 'Помилка обробки повідомлення',
      order_failed: 'Не вдалося оформити замовлення',
      subscription_expired: 'Підписка неактивна',
      rate_limited: 'Забагато повідомлень за годину — AI-агент зупинився',
    };
    return map[reason] ?? reason;
  }
}
