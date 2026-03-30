import { Repository } from 'typeorm';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { StockBalance } from '../catalog/entities/stock-balance.entity';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
export interface AvailabilityResult {
    matchType: 'exact' | 'partial' | 'none';
    product: {
        id: string;
        title: string;
    } | null;
    variant: {
        id: string;
        sku: string | null;
        size: string | null;
        color: string | null;
        price: number;
        currency: string;
    } | null;
    stock: {
        availableQty: number;
        reservedQty: number;
        pendingCheckoutQty: number;
        effectiveAvailable: number;
        lastSyncedAt: Date | null;
        isFresh: boolean;
    } | null;
}
export declare class AvailabilityService {
    private readonly variantRepo;
    private readonly stockRepo;
    constructor(variantRepo: Repository<ProductVariant>, stockRepo: Repository<StockBalance>);
    private extractSearchTerms;
    getCategories(tenantId: string): Promise<string[]>;
    check(tenantId: string, dto: CheckAvailabilityDto): Promise<AvailabilityResult>;
    private searchByTitle;
    private searchByCategory;
    private searchByTrigram;
    checkAll(tenantId: string, dto: CheckAvailabilityDto): Promise<Array<{
        product: {
            id: string;
            title: string;
        };
        variants: Array<{
            id: string;
            size: string | null;
            color: string | null;
            price: number;
            currency: string;
            effectiveAvailable: number;
        }>;
    }>>;
    private searchAllByTitle;
    private searchAllByCategory;
    private searchAllByCategoryTrigram;
    findAllByProductId(productId: string, variantId?: string): Promise<Array<{
        product: {
            id: string;
            title: string;
        };
        variants: Array<{
            id: string;
            size: string | null;
            color: string | null;
            price: number;
            currency: string;
            effectiveAvailable: number;
        }>;
    }>>;
    getByProductId(productId: string, variantId?: string): Promise<{
        title: string;
        variant: {
            size: string | null;
            color: string | null;
            price: number;
            currency: string;
        } | null;
        stock: number;
    } | null>;
}
