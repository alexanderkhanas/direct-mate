import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CheckoutSession } from './entities/checkout-session.entity';
import { CheckoutItem } from './entities/checkout-item.entity';
import { CheckoutCustomerInfo } from './entities/checkout-customer-info.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { StartCheckoutDto } from './dto/start-checkout.dto';
import { CustomerInfoDto } from './dto/customer-info.dto';
import { CheckoutSessionStatus } from '@direct-mate/shared';

@Injectable()
export class CheckoutService {
  constructor(
    @InjectRepository(CheckoutSession)
    private readonly sessionRepo: Repository<CheckoutSession>,
    @InjectRepository(CheckoutItem)
    private readonly itemRepo: Repository<CheckoutItem>,
    @InjectRepository(CheckoutCustomerInfo)
    private readonly infoRepo: Repository<CheckoutCustomerInfo>,
    @InjectRepository(ProductVariant)
    private readonly variantRepo: Repository<ProductVariant>,
  ) {}

  async start(tenantId: string, dto: StartCheckoutDto): Promise<CheckoutSession> {
    const variant = await this.variantRepo.findOne({
      where: { id: dto.variantId },
      relations: ['product'],
    });
    if (!variant) throw new NotFoundException('Variant not found');

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const session = this.sessionRepo.create({
      tenantId,
      conversationId: dto.conversationId,
      customerId: dto.customerId,
      status: CheckoutSessionStatus.CollectingCustomerInfo,
      expiresAt,
    });
    const saved = await this.sessionRepo.save(session);

    const item = this.itemRepo.create({
      checkoutSessionId: saved.id,
      productId: variant.productId,
      variantId: variant.id,
      qty: dto.qty,
      unitPrice: Number(variant.price),
      currency: variant.currency,
    });
    await this.itemRepo.save(item);

    return saved;
  }

  async saveCustomerInfo(checkoutId: string, dto: CustomerInfoDto): Promise<CheckoutSession> {
    const session = await this.sessionRepo.findOne({ where: { id: checkoutId } });
    if (!session) throw new NotFoundException('Checkout session not found');
    if (session.status === CheckoutSessionStatus.DraftCreated) {
      throw new BadRequestException('Draft order already created');
    }

    const existing = await this.infoRepo.findOne({ where: { checkoutSessionId: checkoutId } });
    if (existing) {
      await this.infoRepo.update(existing.id, { ...dto });
    } else {
      const info = this.infoRepo.create({ checkoutSessionId: checkoutId, ...dto });
      await this.infoRepo.save(info);
    }

    await this.sessionRepo.update(session.id, {
      status: CheckoutSessionStatus.ReadyForDraftOrder,
    });

    return this.sessionRepo.findOneOrFail({ where: { id: checkoutId } });
  }

  async findById(id: string): Promise<CheckoutSession> {
    const session = await this.sessionRepo.findOne({
      where: { id },
      relations: ['items', 'customerInfo'],
    });
    if (!session) throw new NotFoundException('Checkout session not found');
    return session;
  }
}
