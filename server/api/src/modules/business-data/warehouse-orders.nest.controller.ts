import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { BusinessDataNestService } from './business-data.nest.service';

@Controller('warehouse/orders')
export class WarehouseOrdersNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly businessDataService: BusinessDataNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      warehouseOrders: await this.businessDataService.listWarehouseOrders(
        actor,
        query,
      ),
    };
  }

  @Patch(':id/packing')
  async updatePacking(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      warehouseOrder: await this.businessDataService.updateWarehouseOrderPacking(
        actor,
        id,
        body,
        {
          ipAddress: getRequestIp(request),
        },
      ),
    };
  }
}
