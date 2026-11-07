import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { TelegramConnectToken } from './entities/telegram-connect-token.entity';
import { StoreConfig } from '../engine/entities/store-config.entity';
import { withRetry } from '../../common/retry';

interface HandoffParams {
  tenantId: string;
  customerName: string;
  reason: string;
  conversationId: string;
  lastMessage?: string;
  summary?: string;
}

interface NewOrderParams {
  tenantId: string;
  productName: string;
  customerName: string;
  totalAmount: number;
  currency: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

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
    const message = [
      '📦 Нове замовлення',
      '',
      `🛍 ${params.productName}`,
      `💰 ${params.totalAmount} ${params.currency}`,
      `👤 ${params.customerName}`,
    ].join('\n');

    await this.sendToAll(params.tenantId, message);
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
      complaint_or_return: 'Скарга, повернення або обмін',
      order_change: 'Зміна вже оформленого замовлення',
      payment_check: 'Клієнт надіслав підтвердження оплати — перевірте',
      health_or_safety: "Питання про здоров'я чи безпеку",
      not_in_store_notes: 'Питання, на яке бот не має відповіді',
      unsure: 'Бот не впевнений у відповіді',
      other: 'Інша причина',
      ungrounded_reply: 'Бот не зміг підтвердити факти для відповіді',
      step_limit: 'Бот не зміг завершити відповідь',
      empty_reply: 'Бот не сформував відповідь',
      agent_error: 'Помилка AI',
      runner_error: 'Помилка обробки повідомлення',
      order_failed: 'Не вдалося оформити замовлення',
      subscription_expired: 'Підписка неактивна',
      rate_limited: 'Забагато повідомлень за годину — бот зупинився',
    };
    return map[reason] ?? reason;
  }
}
