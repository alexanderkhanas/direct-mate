"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReservationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const reservation_entity_1 = require("./entities/reservation.entity");
const stock_balance_entity_1 = require("../catalog/entities/stock-balance.entity");
const shared_1 = require("@direct-mate/shared");
let ReservationsService = class ReservationsService {
    constructor(reservationRepo, stockRepo) {
        this.reservationRepo = reservationRepo;
        this.stockRepo = stockRepo;
    }
    async create(tenantId, dto) {
        const stock = await this.stockRepo.findOne({ where: { variantId: dto.variantId } });
        const effective = stock
            ? stock.availableQty - stock.reservedQty - stock.pendingCheckoutQty
            : 0;
        if (effective < dto.qty) {
            throw new common_1.BadRequestException('Insufficient stock for reservation');
        }
        const expiresAt = new Date(Date.now() + (dto.ttlMinutes ?? 20) * 60 * 1000);
        const reservation = this.reservationRepo.create({
            tenantId,
            conversationId: dto.conversationId,
            customerId: dto.customerId,
            variantId: dto.variantId,
            qty: dto.qty,
            status: shared_1.ReservationStatus.Active,
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
    async cancel(id) {
        const reservation = await this.reservationRepo.findOne({ where: { id } });
        if (!reservation)
            throw new common_1.NotFoundException(`Reservation ${id} not found`);
        if (reservation.status !== shared_1.ReservationStatus.Active) {
            throw new common_1.BadRequestException('Reservation is not active');
        }
        reservation.status = shared_1.ReservationStatus.Cancelled;
        const saved = await this.reservationRepo.save(reservation);
        const stock = await this.stockRepo.findOne({ where: { variantId: reservation.variantId } });
        if (stock) {
            await this.stockRepo.update(stock.id, {
                reservedQty: Math.max(0, stock.reservedQty - reservation.qty),
            });
        }
        return saved;
    }
    async expireStale() {
        const result = await this.reservationRepo.update({
            status: shared_1.ReservationStatus.Active,
            expiresAt: (0, typeorm_2.LessThan)(new Date()),
        }, { status: shared_1.ReservationStatus.Expired });
        return result.affected ?? 0;
    }
};
exports.ReservationsService = ReservationsService;
exports.ReservationsService = ReservationsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(reservation_entity_1.Reservation)),
    __param(1, (0, typeorm_1.InjectRepository)(stock_balance_entity_1.StockBalance)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], ReservationsService);
//# sourceMappingURL=reservations.service.js.map