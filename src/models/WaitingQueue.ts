import { Queue } from './Queue';
import { QueueEntry } from './QueueEntry';

/**
 * 等候队列 — 溢出/备用队列
 * 当快充/慢充队列满时，用户进入等候队列
 * 主队列有空位时自动补入
 */
export class WaitingQueue extends Queue {
  constructor(data: { id: string; max_size: number; entries?: QueueEntry[] }) {
    super({ ...data, type: 'waiting' });
  }

  async enqueue(entry: QueueEntry): Promise<number> {
    if (this.isFull()) throw new Error('等候队列已满，请稍后再试');

    const position = this.getLength() + 1;
    entry.position = position;
    this.entries.push(entry);
    return position;
  }

  async dequeue(): Promise<QueueEntry | null> {
    if (this.isEmpty()) return null;

    // FCFS
    this.entries.sort((a, b) => a.position - b.position);
    const entry = this.entries.shift() || null;

    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].position = i + 1;
    }

    return entry;
  }

  /**
   * 将等候队列中最前面的条目提升到对应的主队列（快充/慢充）
   */
  async promoteToMainQueue(): Promise<QueueEntry | null> {
    if (this.isEmpty()) return null;

    this.entries.sort((a, b) => a.position - b.position);
    const entry = this.entries.shift();
    if (!entry) return null;

    for (let i = 0; i < this.entries.length; i++) {
      this.entries[i].position = i + 1;
    }

    return entry;
  }
}
