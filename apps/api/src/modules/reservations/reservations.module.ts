import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from './entities/reservation.entity';
import { StockBalance } from '../catalog/entities/stock-balance.entity';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, StockBalance])],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
