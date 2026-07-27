import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  TODO_REMINDERS_RECONCILER,
  TodoRemindersReconciler,
} from '../todo-reminders/todo-reminders.tokens';
import { InventoryPrismaRepository } from './inventory.prisma.repository';

@Injectable()
export class InventoryPostCommitProjector {
  constructor(
    @Inject(TODO_REMINDERS_RECONCILER)
    private readonly todoReminders: TodoRemindersReconciler,
  ) {}

  async refresh(task: {
    taskType: string;
    payload: unknown;
    commandReceiptId: string;
  }) {
    if (
      task.taskType !== 'REFRESH_INVENTORY_DERIVED_STATE' ||
      !this.todoReminders
    ) {
      return;
    }
    const payload =
      task.payload &&
      typeof task.payload === 'object' &&
      !Array.isArray(task.payload)
        ? (task.payload as any)
        : {};
    const pairs = Array.isArray(payload.warehouseProductPairs)
      ? payload.warehouseProductPairs
      : [];
    const seen = new Set<string>();
    for (const pair of pairs) {
      const warehouseId = safeId(pair?.warehouseId);
      const productId = safeId(pair?.productId);
      if (!warehouseId || !productId) {
        continue;
      }
      const key = `${warehouseId}\u0000${productId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.todoReminders.safeReconcileInventoryPair?.(
        warehouseId,
        productId,
      );
    }
  }
}

@Injectable()
export class InventoryPostCommitService {
  constructor(
    private readonly repository: InventoryPrismaRepository,
    private readonly projector: InventoryPostCommitProjector,
  ) {}

  async dispatchForReceipt(commandReceiptId: string) {
    const task =
      await this.repository.findPostCommitTaskByReceipt(commandReceiptId);
    if (task) {
      await this.dispatchTask(task.id);
    }
  }

  async dispatchTask(taskId: string) {
    const task = await this.repository.claimPostCommitTask(taskId);
    if (!task) {
      return {
        claimed: false,
      };
    }
    try {
      await this.projector.refresh({
        taskType: task.taskType,
        payload: task.payload,
        commandReceiptId: task.commandReceiptId,
      });
      await this.repository.completePostCommitTask(task.id);
      return {
        claimed: true,
        succeeded: true,
      };
    } catch (error) {
      const delaySeconds = Math.min(
        3600,
        Math.max(5, 2 ** Math.min(task.attempts, 10)),
      );
      await this.repository.failPostCommitTask(
        task.id,
        safeErrorCode(error),
        new Date(Date.now() + delaySeconds * 1000),
      );
      return {
        claimed: true,
        succeeded: false,
      };
    }
  }

  @Interval(60_000)
  async compensatePendingTasks() {
    await this.repository.recoverStalePostCommitTasks(
      new Date(Date.now() - 5 * 60_000),
    );
    const tasks = await this.repository.listDuePostCommitTasks(100);
    for (const task of tasks) {
      await this.dispatchTask(task.id);
    }
  }
}

function safeErrorCode(error: any) {
  const raw =
    typeof error?.code === 'string' && error.code
      ? error.code
      : 'INVENTORY_POST_COMMIT_FAILED';
  const normalized = raw
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toUpperCase();
  return normalized.slice(0, 100) || 'INVENTORY_POST_COMMIT_FAILED';
}

function safeId(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().slice(0, 100)
    : '';
}
