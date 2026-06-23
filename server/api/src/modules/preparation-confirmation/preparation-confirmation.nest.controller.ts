import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
} from '@nestjs/common';

import { PREPARATION_CONFIRMATION_SERVICE } from '../legacy/legacy.tokens';

@Controller('preparation-confirmation')
export class PreparationConfirmationNestController {
  constructor(
    @Inject(PREPARATION_CONFIRMATION_SERVICE)
    private readonly preparationConfirmationService: any,
  ) {}

  @Get('items')
  listItems(@Query('status') status?: string, @Query('category') category?: string) {
    return {
      items: this.preparationConfirmationService.listItems({
        status: status || undefined,
        category: category || undefined,
      }),
    };
  }

  @Get('summary')
  getSummary() {
    return this.preparationConfirmationService.getSummary();
  }

  @Put('items/:id')
  updateItem(@Param('id') id: string, @Body() body: unknown) {
    return {
      item: this.preparationConfirmationService.updateItem(id, body),
    };
  }
}
