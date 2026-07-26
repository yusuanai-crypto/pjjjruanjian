import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthUserGuard } from '../../common/guards/auth-user.guard';
import { TodoRemindersService } from './todo-reminders.service';

@Controller('todo-reminders')
@UseGuards(AuthUserGuard)
export class TodoRemindersController {
  constructor(private readonly reminders: TodoRemindersService) {}

  @Get()
  list(@Req() request: any, @Query() query: any) {
    return this.reminders.listForUser(request.currentUser, query);
  }

  @Get('summary')
  summary(@Req() request: any) {
    return this.reminders.summaryForUser(request.currentUser);
  }

  @Get(':id')
  get(@Req() request: any, @Param('id') id: string) {
    return this.reminders.getForUser(request.currentUser, id);
  }

  @Post(':id/read')
  read(@Req() request: any, @Param('id') id: string) {
    return this.reminders.markRead(request.currentUser, id);
  }

  @Patch(':id/preferences')
  preferences(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.reminders.updatePreferences(request.currentUser, id, body);
  }

  @Post(':id/snooze')
  snooze(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.reminders.snooze(request.currentUser, id, body);
  }

  @Post(':id/verify-completion')
  verify(@Req() request: any, @Param('id') id: string) {
    return this.reminders.verifyCompletion(request.currentUser, id);
  }

  @Post(':id/archive')
  archive(@Req() request: any, @Param('id') id: string) {
    return this.reminders.archive(request.currentUser, id);
  }
}
