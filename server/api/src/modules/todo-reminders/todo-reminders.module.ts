import { Module } from '@nestjs/common';

import { AuthUserGuard } from '../../common/guards/auth-user.guard';
import { AuthModule } from '../auth/auth.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { TodoRemindersController } from './todo-reminders.controller';
import { TodoRuleEngine } from './todo-rule.engine';
import { TodoRemindersScheduler } from './todo-reminders.scheduler';
import { TodoRemindersService } from './todo-reminders.service';
import { TODO_REMINDERS_RECONCILER } from './todo-reminders.tokens';

@Module({
  imports: [AuthModule, OperationLogsModule],
  controllers: [TodoRemindersController],
  providers: [
    TodoRuleEngine,
    TodoRemindersService,
    TodoRemindersScheduler,
    AuthUserGuard,
    {
      provide: TODO_REMINDERS_RECONCILER,
      useExisting: TodoRemindersService,
    },
  ],
  exports: [TodoRemindersService, TODO_REMINDERS_RECONCILER],
})
export class TodoRemindersModule {}
