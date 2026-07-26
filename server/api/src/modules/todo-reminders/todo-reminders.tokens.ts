import { TodoSourceType } from './todo-rule.engine';

export const TODO_REMINDERS_RECONCILER = Symbol(
  'TODO_REMINDERS_RECONCILER',
);

export interface TodoRemindersReconciler {
  safeReconcileSource(
    sourceType: TodoSourceType,
    sourceId: string,
  ): Promise<void>;
}
