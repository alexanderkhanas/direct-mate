import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { CheckoutService } from './checkout.service';
import { StartCheckoutDto } from './dto/start-checkout.dto';
import { CustomerInfoDto } from './dto/customer-info.dto';
import { SyncCallbackDto } from './dto/sync-callback.dto';
import { OrderStatus } from '@direct-mate/shared';

@ApiTags('orders')
@Controller()
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly checkoutService: CheckoutService,
  ) {}

  @Post('checkout/start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  startCheckout(@CurrentUser() user: JwtPayload, @Body() dto: StartCheckoutDto) {
    return this.checkoutService.start(user.tenantId, dto);
  }

  @Patch('checkout/:id/customer-info')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  saveCustomerInfo(@Param('id') id: string, @Body() dto: CustomerInfoDto) {
    return this.checkoutService.saveCustomerInfo(id, dto);
  }

  @Post('orders/draft')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createDraft(@Body() body: { checkoutSessionId: string }) {
    return this.ordersService.createDraft(body.checkoutSessionId);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listOrders(@CurrentUser() user: JwtPayload) {
    return this.ordersService.findAll(user.tenantId);
  }

  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getOrder(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }

  @Patch('orders/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { status: OrderStatus },
  ) {
    return this.ordersService.updateStatus(id, user.tenantId, body.status);
  }

  @Post('orders/:id/retry-sync')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  retrySync(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ordersService.retrySync(id, user.tenantId);
  }

  @Post('internal/orders/:id/sync-callback')
  @UseGuards(InternalApiKeyGuard)
  handleSyncCallback(
    @Param('id') orderId: string,
    @Body() callback: SyncCallbackDto,
  ) {
    return this.ordersService.handleSyncCallback(orderId, callback);
  }
}
