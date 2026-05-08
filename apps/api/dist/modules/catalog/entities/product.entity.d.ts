import { ProductStatus } from '@direct-mate/shared';
import { ProductVariant } from './product-variant.entity';
import { ProductMedia } from './product-media.entity';
import { Category } from './category.entity';
export declare class Product {
    id: string;
    tenantId: string;
    externalProductId: string | null;
    sku: string | null;
    title: string;
    description: string | null;
    category: string | null;
    brand: string | null;
    material: string | null;
    gender: string | null;
    season: string | null;
    salePrice: number | null;
    modelName: string | null;
    status: ProductStatus;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    lastSyncedAt: Date | null;
    variants: ProductVariant[];
    media: ProductMedia[];
    categories: Category[];
}
