import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { TodoRemindersService } from '../src/modules/todo-reminders/todo-reminders.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const reminders = app.get(TodoRemindersService);
    const totals = await reminders.backfillExistingData();
    console.log('Todo reminder backfill completed.', totals);
  } finally {
    await app.close();
  }
}

void main();
