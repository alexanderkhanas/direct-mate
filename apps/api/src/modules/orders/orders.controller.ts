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
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { CheckoutService } from './checkout.service';
import { StartCheckoutDto } from './dto/start-checkout.dto';
import { CustomerInfoDto } from './dto/customer-info.dto';

@ApiTags('orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly checkoutService: CheckoutService,
  ) {}

  @Post('checkout/start')
  startCheckout(@CurrentUser() user: JwtPayload, @Body() dto: StartCheckoutDto) {
    return this.checkoutService.start(user.tenantId, dto);
  }

  @Patch('checkout/:id/customer-info')
  saveCustomerInfo(@Param('id') id: string, @Body() dto: CustomerInfoDto) {
    return this.checkoutService.saveCustomerInfo(id, dto);
  }

  @Post('orders/draft')
  createDraft(@Body() body: { checkoutSessionId: string }) {
    return this.ordersService.createDraft(body.checkoutSessionId);
  }

  @Get('orders')
  listOrders(@CurrentUser() user: JwtPayload) {
    return this.ordersService.findAll(user.tenantId);
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }
}
