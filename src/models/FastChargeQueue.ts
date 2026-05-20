import { Queue } from './Queue';
import { QueueEntry } from './QueueEntry';
import { ChargeMode } from '@/lib/types';

/**
 * 快充队列 — 优先级调度
 * priorityScore = waitTime * 0.6 + (1 - batteryLevel/100) * 0.4
 * 电量越低、等待越久，优先级越高
 */
export class FastChargeQueue extends Queue {
  constructor(data: { id: string; max_size: number; entries?: QueueEntry[] }) {
    super({ ...data, type: 'fast' });
  }

  async enqueue(entry: QueueEntry): Promise<number> {
    if (this.isFull()) throw new Error('快充队列已满');

    const position = this.getLength() + 1;
    entry.position = position;
    entry.mode = ChargeMode.Fast;
    this.entries.push(entry);

    this.sortByPriority();
    return position;
  }

  async dequeue(): Promise<QueueEntry | null> {
    if (this.isEmpty()) return null;

    this.sortByPriority();
    const entry = this.entries.shift() || null;

    // 重新计算位置
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].position = i + 1;
    }

    return entry;
  }

  calculatePriority(entry: QueueEntry): number {
    const waitMinutes = (Date.now() - entry.createdAt.getTime()) / 60000;
    const batteryFactor = 1 - entry.batteryLevel / 100;
    return waitMinutes * 0.6 + batteryFactor * 0.4;
  }

  private sortByPriority(): void {
    this.entries.sort((a, b) => this.calculatePriority(b) - this.calculatePriority(a));
    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].position = i + 1;
    }
  }
}
