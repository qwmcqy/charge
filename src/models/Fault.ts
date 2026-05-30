import { supabase } from '@/lib/supabase';
import { FaultType, FaultSeverity } from '@/lib/types';

export { FaultType, FaultSeverity };

export class Fault {
  id: string;
  stationId: string;
  type: FaultType;
  severity: FaultSeverity;
  description: string;
  detectedAt: Date;
  resolvedAt?: Date;
  handlerId?: string;
  resolution?: string;
  affectedOrderId?: string;

  constructor(data: {
    id: string; station_id: string; type: string; severity: string;
    description: string; detected_at: string; resolved_at?: string;
    handler_id?: string; resolution?: string; affected_order_id?: string;
  }) {
    this.id = data.id;
    this.stationId = data.station_id;
    this.type = data.type as FaultType;
    this.severity = data.severity as FaultSeverity;
    this.description = data.description;
    this.detectedAt = new Date(data.detected_at);
    this.resolvedAt = data.resolved_at ? new Date(data.resolved_at) : undefined;
    this.handlerId = data.handler_id;
    this.resolution = data.resolution;
    this.affectedOrderId = data.affected_order_id;
  }

  static detect(
    stationId: string, type: FaultType, severity: FaultSeverity, description: string
  ): Fault {
    return new Fault({
      id: '',
      station_id: stationId,
      type,
      severity,
      description,
      detected_at: new Date().toISOString(),
    });
  }

  async report(): Promise<void> {
    const { data, error } = await supabase
      .from('faults')
      .insert({
        station_id: this.stationId,
        type: this.type,
        severity: this.severity,
        description: this.description,
        affected_order_id: this.affectedOrderId,
      })
      .select()
      .single();

    if (error) throw new Error(`故障上报失败: ${error.message}`);
    this.id = (data as any).id;

    // 标记充电桩为故障状态
    await supabase
      .from('charging_stations')
      .update({
        status: 'fault',
        current_order_id: null,
        current_voltage: 0,
        current_current: 0,
        current_power: 0,
      })
      .eq('id', this.stationId);

    // 如果有受影响的订单，停止充电
    if (this.affectedOrderId) {
      const { data: order } = await supabase
        .from('charging_orders')
        .select('mode, station_id')
        .eq('id', this.affectedOrderId)
        .single();

      await supabase
        .from('charging_orders')
        .update({ status: 'fault_stopped', end_time: new Date().toISOString() })
        .eq('id', this.affectedOrderId);

      if ((order as any)?.station_id) {
        const { QueueService } = await import('@/services/QueueService');
        await QueueService.rescheduleStationQueue((order as any).station_id, (order as any).mode);
      }
    }

    // 通知管理员
    await this.notifyAdmin();
  }

  async handle(adminId: string, resolution: string): Promise<void> {
    this.handlerId = adminId;
    this.resolution = resolution;

    await supabase
      .from('faults')
      .update({ handler_id: adminId, resolution })
      .eq('id', this.id);
  }

  async resolve(): Promise<void> {
    this.resolvedAt = new Date();

    const { data: station } = await supabase
      .from('charging_stations')
      .select('mode')
      .eq('id', this.stationId)
      .single();

    await supabase
      .from('faults')
      .update({ resolved_at: this.resolvedAt.toISOString() })
      .eq('id', this.id);

    await supabase
      .from('charging_stations')
      .update({
        status: 'available',
        current_order_id: null,
        current_voltage: 0,
        current_current: 0,
        current_power: 0,
      })
      .eq('id', this.stationId);

    if (station?.mode) {
      const { QueueService } = await import('@/services/QueueService');
      await QueueService.rebalanceStationQueues(station.mode);
    }
  }

  async notifyAdmin(): Promise<void> {
    const { data: admins } = await supabase
      .from('administrators')
      .select('user_id');

    if (admins) {
      for (const admin of admins) {
        await supabase.from('notifications').insert({
          user_id: (admin as any).user_id,
          type: 'fault_occurred',
          title: `充电桩故障: ${this.type}`,
          content: `充电桩发生${this.severity === 'critical' ? '严重' : ''}故障: ${this.description}`,
          related_id: this.id,
        });
      }
    }
  }

  isResolved(): boolean {
    return !!this.resolvedAt;
  }

  static async fetchById(faultId: string): Promise<Fault> {
    const { data, error } = await supabase
      .from('faults')
      .select('*')
      .eq('id', faultId)
      .single();

    if (error || !data) throw new Error('故障不存在');
    return new Fault(data as any);
  }
}
