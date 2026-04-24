import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface CreateSubscriptionParams {
  amount: number; // kopiyky
  ccy?: number;
  interval: string; // "1m", "1y", etc.
  redirectUrl: string;
  chargeWebhookUrl: string;
  statusWebhookUrl: string;
  validity?: number; // seconds
}

export interface CreateSubscriptionResult {
  subscriptionId: string;
  pageUrl: string;
}

@Injectable()
export class MonoPaymentService {
  private readonly logger = new Logger(MonoPaymentService.name);
  private readonly baseUrl = 'https://api.monobank.ua';
  private cachedPubKey: string | null = null;

  constructor(private readonly config: ConfigService) {}

  private get token(): string {
    return this.config.get<string>('mono.merchantToken') ?? '';
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    const res = await fetch(`${this.baseUrl}/api/merchant/subscription/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': this.token,
      },
      body: JSON.stringify({
        amount: params.amount,
        ccy: params.ccy ?? 980,
        interval: params.interval,
        redirectUrl: params.redirectUrl,
        webHookUrls: {
          chargeUrl: params.chargeWebhookUrl,
          statusUrl: params.statusWebhookUrl,
        },
        validity: params.validity ?? 3600,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Mono subscription create failed: ${res.status} — ${body}`);
      throw new Error(`Mono subscription create failed: ${res.status}`);
    }

    return res.json() as Promise<CreateSubscriptionResult>;
  }

  async getInvoiceStatus(invoiceId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/api/merchant/invoice/status?invoiceId=${invoiceId}`, {
      headers: { 'X-Token': this.token },
    });
    if (!res.ok) throw new Error(`Mono status check failed: ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  async cancelInvoice(invoiceId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/merchant/invoice/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': this.token,
      },
      body: JSON.stringify({ invoiceId }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Mono cancel failed: ${res.status} — ${body}`);
    }
  }

  async getPublicKey(): Promise<string> {
    if (this.cachedPubKey) return this.cachedPubKey;

    const res = await fetch(`${this.baseUrl}/api/merchant/pubkey`, {
      headers: { 'X-Token': this.token },
    });
    if (!res.ok) throw new Error(`Mono pubkey fetch failed: ${res.status}`);
    const data = await res.json() as { key: string };
    this.cachedPubKey = Buffer.from(data.key, 'base64').toString('utf-8');
    return this.cachedPubKey;
  }

  async verifySignature(body: Buffer, signature: string): Promise<boolean> {
    try {
      const pubKeyPem = await this.getPublicKey();
      const signatureBuffer = Buffer.from(signature, 'base64');
      return crypto.createVerify('SHA256').update(body).verify(pubKeyPem, signatureBuffer);
    } catch (err) {
      this.logger.error('Signature verification failed', err);
      return false;
    }
  }
}
