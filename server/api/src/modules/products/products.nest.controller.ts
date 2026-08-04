import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { ProductsNestService } from './products.nest.service';

@Controller('products')
export class ProductsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly productsService: ProductsNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.productsService.listProducts(actor, query);
  }

  @Get('options')
  async options(@Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      products: await this.productsService.listProductOptions(actor),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      product: await this.productsService.createProduct(actor, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/inventory-tracking/activate')
  async activateInventoryTracking(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return this.productsService.activateInventoryTracking(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      product: await this.productsService.getProduct(actor, id),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      product: await this.productsService.updateProduct(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      product: await this.productsService.setProductActive(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Get(':id/actual-costs')
  async listActualCosts(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      actualCosts: await this.productsService.listActualCosts(actor, id),
    };
  }

  @Post(':id/actual-costs')
  async createActualCost(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      actualCost: await this.productsService.createActualCost(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}

@Controller('product-actual-costs')
export class ProductActualCostsNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly productsService: ProductsNestService,
  ) {}

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      actualCost: await this.productsService.updateActualCost(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      actualCost: await this.productsService.setActualCostActive(
        actor,
        id,
        body,
        { ipAddress: getRequestIp(request) },
      ),
    };
  }
}
