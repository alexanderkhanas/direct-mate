import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import { SearchProductsDto } from './dto/search-products.dto';
import { ProductAttributesService } from './attributes/product-attributes.service';
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS, ATTRIBUTE_VALUES, parseAttributePatch } from './attributes/product-attributes';

@ApiTags('catalog')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('products')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly attributes: ProductAttributesService,
  ) {}

  @Get()
  @ApiQuery({ name: 'q', required: false })
  list(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    return this.catalogService.listProducts(user.tenantId, q);
  }

  @Get('search')
  search(@CurrentUser() user: JwtPayload, @Query() dto: SearchProductsDto) {
    return this.catalogService.searchProducts(user.tenantId, dto);
  }

  /** The attributes and the values each accepts, for the admin's dropdowns. */
  @Get('attribute-options')
  attributeOptions() {
    return ATTRIBUTE_KEYS.map((key) => ({
      key,
      label: ATTRIBUTE_LABELS[key],
      values: key === 'colour' ? null : [...ATTRIBUTE_VALUES[key]],
    }));
  }

  /** Edit attributes by hand. An edited attribute is never overwritten by extraction. */
  @Patch(':id/attributes')
  async editAttributes(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { attributes?: unknown },
  ) {
    const parsed = parseAttributePatch(body?.attributes);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    const view = await this.attributes.setManual(user.tenantId, id, parsed.patch);
    if (!view) throw new NotFoundException('Product not found');
    return view;
  }

  /** Read the attributes from the photo again. `overwriteManual` also replaces edited ones. */
  @Post(':id/attributes/extract')
  async extractAttributes(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { overwriteManual?: boolean },
  ) {
    const result = await this.attributes.extract(id, {
      tenantId: user.tenantId,
      overwriteManual: body?.overwriteManual === true,
    });
    if (!result.ok) {
      if (result.error === 'Product not found.') throw new NotFoundException('Product not found');
      throw new BadGatewayException(`Could not read attributes from the photo: ${result.error}`);
    }
    return { attributes: result.attributes, sources: result.sources };
  }
}
