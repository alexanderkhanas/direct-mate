import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CheckoutSession } from './entities/checkout-session.entity';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { CheckoutSessionStatus, OrderStatus } from '@direct-mate/shared';

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
    @InjectRepository(TenantSettings)
    private readonly settingsRepo: Repository<TenantSettings>,
  ) {}

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
      throw new BadRequestException('Customer info is required before creating draft order');
    }

    const total = session.items.reduce((sum, i) => sum + Number(i.unitPrice) * i.qty, 0);

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
      this.logger.error(`Manager notification failed for order ${saved.id}`, err),
    );

    return saved;
  }

  private async notifyManager(order: Order): Promise<void> {
    const settings = await this.settingsRepo.findOne({ where: { tenantId: order.tenantId } });
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

  async findAll(tenantId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: { tenantId },
      relations: ['items'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }
}
