import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CheckoutSession } from './entities/checkout-session.entity';
import { CheckoutItem } from './entities/checkout-item.entity';
import { CheckoutCustomerInfo } from './entities/checkout-customer-info.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { Connection } from '../integrations/entities/connection.entity';
import {
  CheckoutSessionStatus,
  ConnectionStatus,
  ConnectionType,
  OrderStatus,
} from '@direct-mate/shared';
import { OrderPayload } from './interfaces/order-payload.interface';
import { SyncCallbackDto } from './dto/sync-callback.dto';
import { Product } from '../catalog/entities/product.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(CheckoutSession)
    private readonly sessionRepo: Repository<CheckoutSession>,
    @InjectRepository(CheckoutItem)
    private readonly checkoutItemRepo: Repository<CheckoutItem>,
    @InjectRepository(CheckoutCustomerInfo)
    private readonly customerInfoRepo: Repository<CheckoutCustomerInfo>,
    @InjectRepository(TenantSettings)
    private readonly settingsRepo: Repository<TenantSettings>,
    @InjectRepository(Connection)
    private readonly connectionRepo: Repository<Connection>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  // ─── Create from conversation (reply engine flow) ──────────────

  async createFromConversation(payload: OrderPayload): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Create CheckoutSession
      const session = manager.create(CheckoutSession, {
        tenantId: payload.tenantId,
        conversationId: payload.conversationId,
        customerId: payload.customerId,
        status: CheckoutSessionStatus.ReadyForDraftOrder,
      });
      const savedSession = await manager.save(session);

      // 2. Create CheckoutCustomerInfo
      const customerInfo = manager.create(CheckoutCustomerInfo, {
        checkoutSessionId: savedSession.id,
        fullName: payload.customerInfo.fullName,
        phone: payload.customerInfo.phone,
        city: payload.customerInfo.city,
        branch: payload.customerInfo.deliveryBranch,
        paymentMethod: payload.customerInfo.paymentMethod ?? null,
        comment: payload.customerInfo.comment ?? null,
      });
      await manager.save(customerInfo);

      // 3. Create CheckoutItems
      for (const item of payload.items) {
        const checkoutItem = manager.create(CheckoutItem, {
          checkoutSessionId: savedSession.id,
          productId: item.productId,
          variantId: item.variantId,
          qty: item.quantity,
          unitPrice: item.unitPrice,
          currency: item.currency,
        });
        await manager.save(checkoutItem);
      }

      // 4. Calculate total
      const total = payload.items.reduce(
        (sum, i) => sum + i.unitPrice * i.quantity,
        0,
      );

      // 5. Create Order
      const order = manager.create(Order, {
        tenantId: payload.tenantId,
        checkoutSessionId: savedSession.id,
        customerId: payload.customerId,
        status: OrderStatus.AwaitingManagerConfirmation,
        totalAmount: total,
        currency: payload.items[0]?.currency ?? 'UAH',
        source: payload.source,
        externalSyncStatus: 'none',
      });
      const savedOrder = await manager.save(order);

      // 6. Create OrderItems
      for (const item of payload.items) {
        const orderItem = manager.create(OrderItem, {
          orderId: savedOrder.id,
          productId: item.productId,
          variantId: item.variantId,
          qty: item.quantity,
          unitPrice: item.unitPrice,
          currency: item.currency,
        });
        await manager.save(orderItem);
      }

      // 7. Mark session as draft created
      await manager.update(CheckoutSession, savedSession.id, {
        status: CheckoutSessionStatus.DraftCreated,
      });

      // 8. Notify manager (fire-and-forget)
      this.notifyManager(savedOrder).catch((err) =>
        this.logger.error(
          `Manager notification failed for order ${savedOrder.id}`,
          err,
        ),
      );

      return savedOrder;
    });
  }

  // ─── External sync (Shopify/OpenCart via n8n) ──────────────────

  async triggerExternalSync(order: Order): Promise<void> {
    // Find the tenant's store connection (Shopify or OpenCart)
    const connection = await this.connectionRepo.findOne({
      where: [
        {
          tenantId: order.tenantId,
          type: ConnectionType.Shopify,
          status: ConnectionStatus.Connected,
        },
      ],
    });

    if (!connection) {
      this.logger.warn(
        `No connected store platform for tenant ${order.tenantId}, skipping external sync`,
      );
      return;
    }

    const n8nWebhookUrl = this.config.get<string>('n8n.orderSyncWebhookUrl');
    if (!n8nWebhookUrl) {
      this.logger.warn('n8n.orderSyncWebhookUrl not configured, skipping external sync');
      return;
    }

    const idempotencyKey = `order-${order.id}-sync-1`;
    const platform = connection.type;

    // Load order items with product/variant details
    const orderItems = await this.dataSource
      .getRepository(OrderItem)
      .find({ where: { orderId: order.id } });

    // Load product/variant details for each item
    const items: Array<{
      externalVariantId: string;
      title: string;
      quantity: number;
      unitPrice: number;
    }> = [];
    for (const item of orderItems) {
      const variant = await this.dataSource
        .getRepository(ProductVariant)
        .findOne({ where: { id: item.variantId } });
      const product = await this.dataSource
        .getRepository(Product)
        .findOne({ where: { id: item.productId } });
      items.push({
        externalVariantId: variant?.externalVariantId ?? '',
        title: product?.title ?? 'Unknown',
        quantity: item.qty,
        unitPrice: item.unitPrice,
      });
    }

    // Load customer info from checkout session
    const checkoutInfo = order.checkoutSessionId
      ? await this.customerInfoRepo.findOne({
          where: { checkoutSessionId: order.checkoutSessionId },
        })
      : null;

    const backendBaseUrl = 'http://host.docker.internal:3000';
    const callbackUrl = `${backendBaseUrl}/internal/orders/${order.id}/sync-callback`;
    const resolveCredentialsUrl = `${backendBaseUrl}/internal/connections/resolve-credentials`;

    // Update order sync status
    await this.orderRepo.update(order.id, {
      externalSyncStatus: 'pending',
      externalSyncTriggeredAt: new Date(),
    } as any);

    try {
      const res = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          connectionId: connection.id,
          tenantId: order.tenantId,
          platform,
          idempotencyKey,
          callbackUrl,
          resolveCredentialsUrl,
          order: {
            items,
            customer: {
              fullName: checkoutInfo?.fullName ?? '',
              phone: checkoutInfo?.phone ?? '',
              email: '',
              city: checkoutInfo?.city ?? '',
              deliveryBranch: checkoutInfo?.branch ?? '',
            },
            note: `DirectMate order from Instagram DM`,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(
          `n8n order sync webhook failed: ${res.status} — ${body}`,
        );
      } else {
        this.logger.log(
          `External sync triggered for order ${order.id} on ${platform}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `External sync trigger failed for order ${order.id}`,
        (err as Error).message,
      );
      // Don't fail — order is already saved locally
    }
  }

  // ─── Retry sync ────────────────────────────────────────────────

  async retrySync(orderId: string, tenantId: string): Promise<{ ok: boolean }> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    await this.orderRepo.update(orderId, { externalSyncStatus: 'none' } as any);
    this.triggerExternalSync(order).catch(err =>
      this.logger.error(`Retry sync failed for order ${orderId}`, (err as Error).message),
    );
    return { ok: true };
  }

  // ─── Sync callback from n8n ────────────────────────────────────

  async handleSyncCallback(
    orderId: string,
    callback: SyncCallbackDto,
  ): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    // Idempotency check: already synced → skip
    if (order.externalSyncStatus === 'synced') {
      this.logger.log(`Order ${orderId} already synced, skipping callback`);
      return;
    }

    // Verify idempotency key matches
    const expectedKey = `order-${order.id}-sync-1`;
    if (callback.idempotencyKey !== expectedKey) {
      this.logger.warn(
        `Idempotency key mismatch for order ${orderId}: expected ${expectedKey}, got ${callback.idempotencyKey}`,
      );
      return;
    }

    if (callback.status === 'success') {
      await this.orderRepo.update(order.id, {
        externalSyncStatus: 'synced',
        externalOrderId: callback.externalOrderId ?? null,
        externalOrderMetadata: {
          externalOrderUrl: callback.externalOrderUrl,
          ...callback.metadata,
        } as any,
        externalSyncCompletedAt: new Date(),
      } as any);

      this.logger.log(
        `Order ${orderId} synced to ${callback.platform}, external ID: ${callback.externalOrderId}`,
      );
    } else {
      await this.orderRepo.update(order.id, {
        externalSyncStatus: 'failed',
        externalOrderMetadata: {
          error: callback.error,
          ...callback.metadata,
        } as any,
        externalSyncCompletedAt: new Date(),
      } as any);

      this.logger.error(
        `Order ${orderId} sync failed on ${callback.platform}: ${callback.error?.message ?? 'unknown error'}`,
      );
    }
  }

  // ─── Existing methods ──────────────────────────────────────────

  async createDraft(checkoutSessionId: string): Promise<Order> {
    const session = await this.sessionRepo.findOne({
      where: { id: checkoutSessionId },
      relations: ['items', 'customerInfo'],
    });
    if (!session) throw new NotFoundException('Checkout session not found');
    if (session.status !== CheckoutSessionStatus.ReadyForDraftOrder) {
      throw new BadRequestException(
        `Session status is ${session.status}, expected ready_for_draft_order`,
      );
    }
    if (!session.customerInfo) {
      throw new BadRequestException(
        'Customer info is required before creating draft order',
      );
    }

    const total = session.items.reduce(
      (sum, i) => sum + Number(i.unitPrice) * i.qty,
      0,
    );

    const order = this.orderRepo.create({
      tenantId: session.tenantId,
      checkoutSessionId: session.id,
      customerId: session.customerId,
      status: OrderStatus.AwaitingManagerConfirmation,
      totalAmount: total,
      currency: session.items[0]?.currency ?? 'UAH',
    });
    const saved = await this.orderRepo.save(order);

    for (const item of session.items) {
      const oi = this.orderItemRepo.create({
        orderId: saved.id,
        productId: item.productId,
        variantId: item.variantId,
        qty: item.qty,
        unitPrice: item.unitPrice,
        currency: item.currency,
      });
      await this.orderItemRepo.save(oi);
    }

    await this.sessionRepo.update(session.id, {
      status: CheckoutSessionStatus.DraftCreated,
    });

    this.notifyManager(saved).catch((err) =>
      this.logger.error(
        `Manager notification failed for order ${saved.id}`,
        err,
      ),
    );

    return saved;
  }

  private async notifyManager(order: Order): Promise<void> {
    const settings = await this.settingsRepo.findOne({
      where: { tenantId: order.tenantId },
    });
    const webhookUrl = settings?.aiSettings?.notificationWebhookUrl;
    if (!webhookUrl) return;

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        customerId: order.customerId,
        conversationId: order.checkoutSessionId,
        totalAmount: order.totalAmount,
        status: order.status,
      }),
    });

    if (!res.ok) {
      throw new Error(`Webhook responded with ${res.status}`);
    }
  }

  async findAll(tenantId: string): Promise<any[]> {
    const orders = await this.orderRepo.find({
      where: { tenantId },
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });

    return Promise.all(orders.map((order) => this.enrichOrder(order)));
  }

  async findById(id: string): Promise<any> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return this.enrichOrder(order);
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: OrderStatus,
  ): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id, tenantId },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    order.status = status;
    const saved = await this.orderRepo.save(order);

    // If confirmed, trigger external sync
    if (status === OrderStatus.Confirmed) {
      this.triggerExternalSync(saved).catch((err) =>
        this.logger.error(
          `External sync failed for order ${saved.id}`,
          (err as Error).message,
        ),
      );
    }

    return saved;
  }

  private async enrichOrder(order: Order): Promise<any> {
    // Load customer info via checkout session
    let customer: {
      fullName: string | null;
      phone: string | null;
      city: string | null;
      branch: string | null;
    } | null = null;

    if (order.checkoutSessionId) {
      const info = await this.customerInfoRepo.findOne({
        where: { checkoutSessionId: order.checkoutSessionId },
      });
      if (info) {
        customer = {
          fullName: info.fullName,
          phone: info.phone,
          city: info.city,
          branch: info.branch,
        };
      }
    }

    // Enrich items with product/variant titles
    const enrichedItems = await Promise.all(
      (order.items ?? []).map(async (item) => {
        const product = await this.dataSource
          .getRepository(Product)
          .findOne({ where: { id: item.productId } });
        const variant = await this.dataSource
          .getRepository(ProductVariant)
          .findOne({ where: { id: item.variantId } });

        const variantParts = [variant?.color, variant?.size].filter(Boolean);
        return {
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          qty: item.qty,
          unitPrice: item.unitPrice,
          currency: item.currency,
          productTitle: product?.title ?? null,
          variantTitle: variantParts.length > 0 ? variantParts.join(' / ') : null,
        };
      }),
    );

    return {
      id: order.id,
      tenantId: order.tenantId,
      status: order.status,
      totalAmount: order.totalAmount,
      currency: order.currency,
      source: order.source,
      externalOrderId: order.externalOrderId,
      externalSyncStatus: order.externalSyncStatus,
      externalOrderMetadata: order.externalOrderMetadata,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      customer,
      items: enrichedItems,
    };
  }
}
