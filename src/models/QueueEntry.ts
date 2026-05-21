import { supabase } from '@/lib/supabase';
import { QueueEntryStatus, ChargeMode } from '@/lib/types';
import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';

export { QueueEntryStatus, ChargeMode };

export class QueueEntry {
  id: string;
  userId: string;
  orderId: string;
  queueId: string;
  position: number;
  mode: ChargeMode;
  batteryLevel: number;
  estimatedWaitMinutes: number;
  status: QueueEntryStatus;
  createdAt: Date;
  notifiedAt?: Date;

  constructor(data: {
    id: string; user_id: string; order_id: string; queue_id: string;
    position: number; mode: string; battery_level: number;
    estimated_wait_minutes: number; status: string; created_at: string;
    notified_at?: string;
  }) {
    this.id = data.id;
    this.userId = data.user_id;
    this.orderId = data.order_id;
    this.queueId = data.queue_id;
    this.position = data.position;
    this.mode = data.mode as ChargeMode;
    this.batteryLevel = data.battery_level;
    this.estimatedWaitMinutes = data.estimated_wait_minutes;
    this.status = data.status as QueueEntryStatus;
    this.createdAt = new Date(data.created_at);
    this.notifiedAt = data.notified_at ? new Date(data.notified_at) : undefined;
  }

  async updatePosition(newPosition: number): Promise<void> {
    this.position = newPosition;
    await supabase
      .from('queue_entries')
      .update({ position: newPosition })
      .eq('id', this.id);
  }

  estimateWaitTime(aheadCount: number, avgChargeMinutes: number): number {
    this.estimatedWaitMinutes = aheadCount * avgChargeMinutes;
    return this.estimatedWaitMinutes;
  }

  async markReady(): Promise<void> {
    this.status = QueueEntryStatus.Ready;
    this.notifiedAt = new Date();

    await supabase
      .from('queue_entries')
      .update({ status: 'ready', notified_at: this.notifiedAt.toISOString() })
      .eq('id', this.id);

    await supabase.from('notifications').insert({
      user_id: this.userId,
      type: 'queue_ready',
      title: '轮到您充电了',
      content: `您的充电排队已就绪，请在15分钟内前往充电桩`,
      related_id: this.orderId,
    });
  }

  async cancel(): Promise<void> {
    this.status = QueueEntryStatus.Cancelled;
    await supabase
      .from('queue_entries')
      .update({ status: 'cancelled' })
      .eq('id', this.id);
  }

  static async create(
    userId: string, orderId: string, queueId: string,
    position: number, mode: ChargeMode, batteryLevel: number
  ): Promise<QueueEntry> {
    const avgMinutes = mode === ChargeMode.Fast
      ? DEFAULT_SYSTEM_CONFIG.avgFastChargeMinutes
      : DEFAULT_SYSTEM_CONFIG.avgSlowChargeMinutes;
    const estimatedWait = (position - 1) * avgMinutes;

    const { data, error } = await supabase
      .from('queue_entries')
      .insert({
        user_id: userId,
        order_id: orderId,
        queue_id: queueId,
        position,
        mode,
        battery_level: batteryLevel,
        estimated_wait_minutes: Math.round(estimatedWait),
        status: 'waiting',
      })
      .select()
      .single();

    if (error) throw new Error(`创建队列条目失败: ${error.message}`);
    return new QueueEntry(data as any);
  }
}
