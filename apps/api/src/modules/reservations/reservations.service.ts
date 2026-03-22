import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { Reservation } from './entities/reservation.entity';
import { StockBalance } from '../catalog/entities/stock-balance.entity';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationStatus } from '@direct-mate/shared';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepo: Repository<Reservation>,
    @InjectRepository(StockBalance)
    private readonly stockRepo: Repository<StockBalance>,
  ) {}

  async create(tenantId: string, dto: CreateReservationDto): Promise<Reservation> {
    const stock = await this.stockRepo.findOne({ where: { variantId: dto.variantId } });
    const effective = stock
      ? stock.availableQty - stock.reservedQty - stock.pendingCheckoutQty
      : 0;

    if (effective < dto.qty) {
      throw new BadRequestException('Insufficient stock for reservation');
    }

    const expiresAt = new Date(Date.now() + (dto.ttlMinutes ?? 20) * 60 * 1000);

    const reservation = this.reservationRepo.create({
      tenantId,
      conversationId: dto.conversationId,
      customerId: dto.customerId,
      variantId: dto.variantId,
      qty: dto.qty,
      status: ReservationStatus.Active,
      expiresAt,
    });

    const saved = await this.reservationRepo.save(reservation);

    if (stock) {
      await this.stockRepo.update(stock.id, {
        reservedQty: stock.reservedQty + dto.qty,
      });
    }

    return saved;
  }

  async cancel(id: string): Promise<Reservation> {
    const reservation = await this.reservationRepo.findOne({ where: { id } });
    if (!reservation) throw new NotFoundException(`Reservation ${id} not found`);
    if (reservation.status !== ReservationStatus.Active) {
      throw new BadRequestException('Reservation is not active');
    }

    reservation.status = ReservationStatus.Cancelled;
    const saved = await this.reservationRepo.save(reservation);

    const stock = await this.stockRepo.findOne({ where: { variantId: reservation.variantId } });
    if (stock) {
      await this.stockRepo.update(stock.id, {
        reservedQty: Math.max(0, stock.reservedQty - reservation.qty),
      });
    }

    return saved;
  }

  @Cron('*/5 * * * *')
  async expireStale(): Promise<number> {
    const stale = await this.reservationRepo.find({
      where: { status: ReservationStatus.Active, expiresAt: LessThan(new Date()) },
    });

    if (stale.length === 0) return 0;

    for (const reservation of stale) {
      await this.reservationRepo.update(reservation.id, { status: ReservationStatus.Expired });

      const stock = await this.stockRepo.findOne({ where: { variantId: reservation.variantId } });
      if (stock) {
        await this.stockRepo.update(stock.id, {
          reservedQty: Math.max(0, stock.reservedQty - reservation.qty),
        });
      }
    }

    this.logger.log(`Expired ${stale.length} stale reservation(s)`);
    return stale.length;
  }
}
