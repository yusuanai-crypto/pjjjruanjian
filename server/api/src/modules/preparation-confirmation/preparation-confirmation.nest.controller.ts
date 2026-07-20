import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import { AuthNestService } from '../auth/auth.nest.service';
import { PREPARATION_CONFIRMATION_SERVICE } from '../legacy/legacy.tokens';

@Controller('preparation-confirmation')
export class PreparationConfirmationNestController {
  constructor(
    private readonly authService: AuthNestService,
    @Inject(PREPARATION_CONFIRMATION_SERVICE)
    private readonly preparationConfirmationService: any,
  ) {}

  @Get('items')
  async listItems(
    @Req() request: any,
    @Query('status') status?: string,
    @Query('category') category?: string,
  ) {
    await this.requireAdmin(request);
    return {
      items: this.preparationConfirmationService.listItems({
        status: status || undefined,
        category: category || undefined,
      }),
    };
  }

  @Get('summary')
  async getSummary(@Req() request: any) {
    await this.requireAdmin(request);
    return this.preparationConfirmationService.getSummary();
  }

  @Put('items/:id')
  async updateItem(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.requireAdmin(request);
    return {
      item: this.preparationConfirmationService.updateItem(id, body),
    };
  }

  private async requireAdmin(request: any) {
    const actor = await this.authService.authenticateRequest(request);
    this.authService.requireAdmin(actor);
  }
}
