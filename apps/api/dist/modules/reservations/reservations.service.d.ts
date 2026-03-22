import { Repository } from 'typeorm';
import { Reservation } from './entities/reservation.entity';
import { StockBalance } from '../catalog/entities/stock-balance.entity';
import { CreateReservationDto } from './dto/create-reservation.dto';
export declare class ReservationsService {
    private readonly reservationRepo;
    private readonly stockRepo;
    private readonly logger;
    constructor(reservationRepo: Repository<Reservation>, stockRepo: Repository<StockBalance>);
    create(tenantId: string, dto: CreateReservationDto): Promise<Reservation>;
    cancel(id: string): Promise<Reservation>;
    expireStale(): Promise<number>;
}
