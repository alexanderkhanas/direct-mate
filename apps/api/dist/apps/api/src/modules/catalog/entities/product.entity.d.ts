import { ProductStatus } from '@direct-mate/shared';
import { ProductVariant } from './product-variant.entity';
import { ProductMedia } from './product-media.entity';
export declare class Product {
    id: string;
    tenantId: string;
    externalProductId: string | null;
    title: string;
    description: string | null;
    category: string | null;
    brand: string | null;
    status: ProductStatus;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    variants: ProductVariant[];
    media: ProductMedia[];
}
