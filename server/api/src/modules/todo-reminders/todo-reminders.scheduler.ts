import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TodoRemindersService } from './todo-reminders.service';

@Injectable()
export class TodoRemindersScheduler {
  private readonly logger = new Logger(TodoRemindersScheduler.name);

  constructor(private readonly reminders: TodoRemindersService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'todo-reminders-reconcile',
  })
  async reconcile() {
    try {
      await this.reminders.runMaintenanceCycle();
    } catch (error) {
      this.logger.error(
        'Scheduled todo reconciliation failed.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
