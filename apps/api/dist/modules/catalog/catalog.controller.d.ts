import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import { SearchProductsDto } from './dto/search-products.dto';
export declare class CatalogController {
    private readonly catalogService;
    constructor(catalogService: CatalogService);
    list(user: JwtPayload, q?: string): Promise<{
        id: string;
        sku: string | null;
        title: string;
        category: string | null;
        variantCount: number;
        updatedAt: Date;
        variants: {
            id: string;
            sku: string | null;
            size: string | null;
            color: string | null;
            price: number;
            currency: string;
            effectiveAvailable: number;
            lastSyncedAt: Date | null;
        }[];
    }[]>;
    search(user: JwtPayload, dto: SearchProductsDto): Promise<any[]>;
}
