import { Injectable } from '@nestjs/common';
import type { TaskSummary } from './task-runtime.js';

export type TaskNotificationChannel = 'in_app' | 'webhook';
export interface TaskNotification {
  readonly taskId: string;
  readonly status: TaskSummary['status'];
  readonly channel: TaskNotificationChannel;
  readonly createdAt: number;
}
export type TaskNotifier = (notification: TaskNotification) => Promise<void> | void;

@Injectable()
export class TaskNotificationService {
  private readonly notifications: TaskNotification[] = [];
  private readonly notifiers = new Map<TaskNotificationChannel, TaskNotifier[]>();

  register(channel: TaskNotificationChannel, notifier: TaskNotifier): void {
    const list = this.notifiers.get(channel) ?? [];
    list.push(notifier);
    this.notifiers.set(channel, list);
  }

  async publish(summary: TaskSummary): Promise<void> {
    const channels: TaskNotificationChannel[] = ['in_app', 'webhook'];
    const notification: TaskNotification = { taskId: summary.id, status: summary.status, channel: 'in_app', createdAt: Date.now() };
    this.notifications.push(notification);
    await Promise.all(channels.flatMap((channel) => (this.notifiers.get(channel) ?? []).map((notifier) => Promise.resolve(notifier({ ...notification, channel })).catch(() => undefined))));
  }

  list(taskId?: string): readonly TaskNotification[] {
    return this.notifications.filter((item) => !taskId || item.taskId === taskId).map((item) => ({ ...item }));
  }
}
