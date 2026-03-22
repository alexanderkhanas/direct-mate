import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';

class ConnectInstagramDto {
  @ApiProperty({ example: '123456789' })
  @IsString()
  @IsNotEmpty()
  pageId!: string;

  @ApiProperty({ example: 'EAABwzLix...' })
  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  @ApiProperty({ example: 'My Store', required: false })
  @IsString()
  @IsOptional()
  accountName?: string;
}

class ConnectShopifyDto {
  @ApiProperty({ example: 'my-store.myshopify.com' })
  @IsString()
  @IsNotEmpty()
  shopDomain!: string;

  @ApiProperty({ example: 'shpat_xxxxx' })
  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  @ApiProperty({ example: 'My Fashion Store', required: false })
  @IsString()
  @IsOptional()
  shopName?: string;
}

@ApiTags('connections')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('connections')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.integrationsService.findAll(user.tenantId);
  }

  @Post('instagram')
  connectInstagram(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectInstagramDto,
  ) {
    return this.integrationsService.connectInstagram(
      user.tenantId,
      dto.pageId,
      dto.accessToken,
      dto.accountName,
    );
  }

  @Post('shopify')
  connectShopify(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectShopifyDto,
  ) {
    return this.integrationsService.connectShopify(
      user.tenantId,
      dto.shopDomain,
      dto.accessToken,
      dto.shopName,
    );
  }

  @Post(':id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.integrationsService.disconnect(id);
  }
}
