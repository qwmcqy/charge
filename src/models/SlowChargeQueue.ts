import { Queue } from './Queue';
import { QueueEntry } from './QueueEntry';
import { ChargeMode } from '@/lib/types';

/**
 * 慢充队列 — 纯先来先服务 (FCFS)
 */
export class SlowChargeQueue extends Queue {
  constructor(data: { id: string; max_size: number; entries?: QueueEntry[] }) {
    super({ ...data, type: 'slow' });
  }

  async enqueue(entry: QueueEntry): Promise<number> {
    if (this.isFull()) throw new Error('慢充队列已满');

    const position = this.getLength() + 1;
    entry.position = position;
    entry.mode = ChargeMode.Slow;
    this.entries.push(entry);
    return position;
  }

  async dequeue(): Promise<QueueEntry | null> {
    if (this.isEmpty()) return null;

    // FCFS: 取 position 最小的（最早进入的）
    this.entries.sort((a, b) => a.position - b.position);
    const entry = this.entries.shift() || null;

    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].position = i + 1;
    }

    return entry;
  }
}
