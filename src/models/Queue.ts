import { supabase } from '@/lib/supabase';
import { QueueEntry } from './QueueEntry';
import { QueueType } from '@/lib/types';

export abstract class Queue {
  id: string;
  type: QueueType;
  entries: QueueEntry[];
  maxSize: number;

  constructor(data: { id: string; type: string; max_size: number; entries?: QueueEntry[] }) {
    this.id = data.id;
    this.type = data.type as QueueType;
    this.maxSize = data.max_size;
    this.entries = data.entries || [];
  }

  abstract enqueue(entry: QueueEntry): Promise<number>;
  abstract dequeue(): Promise<QueueEntry | null>;

  getPosition(entryId: string): number {
    const entry = this.entries.find(e => e.id === entryId);
    return entry?.position ?? -1;
  }

  getLength(): number {
    return this.entries.filter(e => e.status === 'waiting').length;
  }

  getEstimatedWaitTime(entryId: string): number {
    const entry = this.entries.find(e => e.id === entryId);
    return entry?.estimatedWaitMinutes ?? 0;
  }

  async reorder(entryId: string, newPosition: number): Promise<void> {
    const entry = this.entries.find(e => e.id === entryId);
    if (entry) {
      await entry.updatePosition(newPosition);
    }
  }

  async remove(entryId: string): Promise<void> {
    const entry = this.entries.find(e => e.id === entryId);
    if (entry) {
      await entry.cancel();
      this.entries = this.entries.filter(e => e.id !== entryId);
    }
  }

  isEmpty(): boolean {
    return this.getLength() === 0;
  }

  isFull(): boolean {
    return this.getLength() >= this.maxSize;
  }

  async loadEntries(): Promise<void> {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('queue_id', this.id)
      .eq('status', 'waiting')
      .order('position', { ascending: true });

    if (error) throw new Error(`加载队列条目失败: ${error.message}`);
    this.entries = (data || []).map((e: any) => new QueueEntry(e));
  }

  static async fetchByType(type: QueueType): Promise<Queue> {
    const { data, error } = await supabase
      .from('queues')
      .select('*')
      .eq('type', type)
      .single();

    if (error || !data) throw new Error(`队列 ${type} 不存在`);
    return { id: data.id, type: data.type, maxSize: data.max_size, entries: [] } as any;
  }
}
