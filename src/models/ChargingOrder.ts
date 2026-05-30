import { supabase } from '@/lib/supabase';
import { OrderStatus, ChargeMode } from '@/lib/types';

export { OrderStatus, ChargeMode };

export class ChargingOrder {
  id: string;
  userId: string;
  stationId?: string;
  queueEntryId?: string;
  mode: ChargeMode;
  status: OrderStatus;
  requestBatteryLevel: number;
  targetBatteryLevel: number;
  startTime?: Date;
  endTime?: Date;
  energyConsumed: number;
  chargingFee: number;
  createdAt: Date;

  constructor(data: {
    id: string; user_id: string; station_id?: string; queue_entry_id?: string;
    mode: string; status: string; request_battery_level: number;
    target_battery_level: number; start_time?: string; end_time?: string;
    energy_consumed: number; charging_fee: number; created_at: string;
  }) {
    this.id = data.id;
    this.userId = data.user_id;
    this.stationId = data.station_id || undefined;
    this.queueEntryId = data.queue_entry_id || undefined;
    this.mode = data.mode as ChargeMode;
    this.status = data.status as OrderStatus;
    this.requestBatteryLevel = data.request_battery_level;
    this.targetBatteryLevel = data.target_battery_level;
    this.startTime = data.start_time ? new Date(data.start_time) : undefined;
    this.endTime = data.end_time ? new Date(data.end_time) : undefined;
    this.energyConsumed = data.energy_consumed;
    this.chargingFee = data.charging_fee;
    this.createdAt = new Date(data.created_at);
  }

  static async create(
    userId: string, mode: ChargeMode, batteryLevel: number, targetLevel: number
  ) {
    const { data, error } = await supabase
      .from('charging_orders')
      .insert({
        user_id: userId,
        mode,
        status: 'pending',
        request_battery_level: batteryLevel,
        target_battery_level: targetLevel,
      })
      .select()
      .single();

    if (error) throw new Error(`创建订单失败: ${error.message}`);
    return new ChargingOrder(data as any);
  }

  async assignStation(stationId: string): Promise<void> {
    this.stationId = stationId;
    this.status = OrderStatus.Assigned;

    await supabase
      .from('charging_orders')
      .update({ station_id: stationId, status: 'assigned' })
      .eq('id', this.id);
  }

  async startCharging(): Promise<void> {
    this.status = OrderStatus.Charging;
    this.startTime = new Date();

    await supabase
      .from('charging_orders')
      .update({ status: 'charging', start_time: this.startTime.toISOString() })
      .eq('id', this.id);

    await supabase.from('notifications').insert({
      user_id: this.userId,
      type: 'charging_started',
      title: '充电已开始',
      content: `您的${this.mode === 'fast' ? '快充' : '慢充'}已开始，目标电量: ${this.targetBatteryLevel}%`,
      related_id: this.id,
    });
  }

  async endCharging(endStatus: OrderStatus = OrderStatus.Completed): Promise<void> {
    this.status = endStatus;
    this.endTime = new Date();

    await supabase
      .from('charging_orders')
      .update({ status: endStatus, end_time: this.endTime.toISOString() })
      .eq('id', this.id);

    // 更新充电桩状态（故障结束时不改变桩状态，保持fault让管理员处理）
    if (this.stationId && endStatus !== OrderStatus.FaultStopped) {
      await supabase
        .from('charging_stations')
        .update({ status: 'available', current_order_id: null, current_voltage: 0, current_current: 0, current_power: 0 })
        .eq('id', this.stationId);
    }

    // 更新队列条目
    if (this.queueEntryId) {
      await supabase
        .from('queue_entries')
        .update({ status: endStatus === OrderStatus.FaultStopped ? 'cancelled' : 'completed' })
        .eq('id', this.queueEntryId);
    }

    if (endStatus === OrderStatus.Completed) {
      await supabase.from('notifications').insert({
        user_id: this.userId,
        type: 'charging_complete',
        title: '充电已完成',
        content: `充电已完成！消耗电量: ${this.energyConsumed.toFixed(2)}kWh，费用: ¥${this.chargingFee.toFixed(2)}`,
        related_id: this.id,
      });
    }

    if (endStatus === OrderStatus.FaultStopped) {
      await supabase.from('notifications').insert({
        user_id: this.userId,
        type: 'fault_occurred',
        title: '充电因故障中断',
        content: '充电因充电桩故障已中断，本次充电不收取费用',
        related_id: this.id,
      });
    }
  }

  calculateChargingFee(ratePerKwh: number): number {
    this.chargingFee = Math.round(this.energyConsumed * ratePerKwh * 100) / 100;
    return this.chargingFee;
  }

  async cancel(): Promise<void> {
    this.status = OrderStatus.Cancelled;

    await supabase
      .from('charging_orders')
      .update({ status: 'cancelled' })
      .eq('id', this.id);

    if (this.queueEntryId) {
      await supabase
        .from('queue_entries')
        .update({ status: 'cancelled' })
        .eq('id', this.queueEntryId);
    }
  }

  getDuration(): number {
    if (!this.startTime) return 0;
    const end = this.endTime || new Date();
    return Math.floor((end.getTime() - this.startTime.getTime()) / 60000);
  }

  getStatusLabel(): string {
    const labels: Record<OrderStatus, string> = {
      [OrderStatus.Pending]: '等待审核',
      [OrderStatus.Queued]: '排队中',
      [OrderStatus.Assigned]: '已分配',
      [OrderStatus.Charging]: '充电中',
      [OrderStatus.Paused]: '已暂停',
      [OrderStatus.FaultPending]: '故障待处理',
      [OrderStatus.Completed]: '已完成',
      [OrderStatus.FaultStopped]: '故障中断',
      [OrderStatus.Cancelled]: '已取消',
    };
    return labels[this.status] || this.status;
  }

  static async fetchById(orderId: string): Promise<ChargingOrder> {
    const { data, error } = await supabase
      .from('charging_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !data) throw new Error('订单不存在');
    return new ChargingOrder(data as any);
  }

  static async fetchByUser(userId: string): Promise<ChargingOrder[]> {
    const { data, error } = await supabase
      .from('charging_orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`获取订单列表失败: ${error.message}`);
    return (data || []).map((o: any) => new ChargingOrder(o));
  }
}
