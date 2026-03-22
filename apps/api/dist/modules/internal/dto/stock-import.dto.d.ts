export declare class StockItemDto {
    externalVariantId: string;
    availableQty: number;
}
export declare class StockImportDto {
    tenantId: string;
    connectionId: string;
    items: StockItemDto[];
}
