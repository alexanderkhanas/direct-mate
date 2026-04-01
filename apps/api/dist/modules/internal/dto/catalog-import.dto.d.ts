export declare class ImportVariantDto {
    externalVariantId: string;
    sku?: string;
    size?: string;
    color?: string;
    price: number;
    currency?: string;
    inventoryQty?: number;
}
export declare class ImportImageDto {
    url: string;
    color?: string;
    sortOrder?: number;
}
export declare class ImportProductDto {
    externalProductId: string;
    title: string;
    description?: string;
    category?: string;
    brand?: string;
    status?: string;
    variants: ImportVariantDto[];
    images?: ImportImageDto[];
}
export declare class CatalogImportDto {
    tenantId: string;
    connectionId: string;
    products: ImportProductDto[];
}
