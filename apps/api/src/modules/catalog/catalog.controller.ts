import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import { SearchProductsDto } from './dto/search-products.dto';

@ApiTags('catalog')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('products')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @ApiQuery({ name: 'q', required: false })
  list(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    return this.catalogService.listProducts(user.tenantId, q);
  }

  @Get('search')
  search(@CurrentUser() user: JwtPayload, @Query() dto: SearchProductsDto) {
    return this.catalogService.searchProducts(user.tenantId, dto);
  }
}
