import { supabase } from '@/lib/supabase';
import { ChargingOrder } from './ChargingOrder';
import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';

export class ParkingFeeOrder {
  id: string;
  chargingOrderId: string;
  userId: string;
  stationId: string;
  chargeCompleteTime: Date;
  departTime?: Date;
  overtimeMinutes: number;
  parkingFee: number;
  ratePerMinute: number;
  gracePeriodMinutes: number;
  status: 'parked' | 'departed' | 'paid';

  constructor(data: {
    id: string; charging_order_id: string; user_id: string; station_id: string;
    charge_complete_time: string; depart_time?: string; overtime_minutes: number;
    parking_fee: number; rate_per_minute: number; grace_period_minutes: number;
    status: string;
  }) {
    this.id = data.id;
    this.chargingOrderId = data.charging_order_id;
    this.userId = data.user_id;
    this.stationId = data.station_id;
    this.chargeCompleteTime = new Date(data.charge_complete_time);
    this.departTime = data.depart_time ? new Date(data.depart_time) : undefined;
    this.overtimeMinutes = data.overtime_minutes;
    this.parkingFee = data.parking_fee;
    this.ratePerMinute = data.rate_per_minute;
    this.gracePeriodMinutes = data.grace_period_minutes;
    this.status = data.status as 'parked' | 'departed' | 'paid';
  }

  static async create(
    chargingOrderId: string,
    chargeCompleteTime: Date,
    rate?: number,
    grace?: number
  ): Promise<ParkingFeeOrder> {
    // 从数据库读取实际配置（优先于硬编码默认值）
    if (rate === undefined || grace === undefined) {
      const { data: configs } = await supabase
        .from('system_configs')
        .select('*');
      if (configs) {
        for (const row of configs) {
          const v = (row as any).value?.v;
          if ((row as any).key === 'parkingRatePerMinute' && rate === undefined) rate = v ?? DEFAULT_SYSTEM_CONFIG.parkingRatePerMinute;
          if ((row as any).key === 'parkingGracePeriodMinutes' && grace === undefined) grace = v ?? DEFAULT_SYSTEM_CONFIG.parkingGracePeriodMinutes;
        }
      }
    }
    rate ??= DEFAULT_SYSTEM_CONFIG.parkingRatePerMinute;
    grace ??= DEFAULT_SYSTEM_CONFIG.parkingGracePeriodMinutes;

    const { data: order } = await supabase
      .from('charging_orders')
      .select('*')
      .eq('id', chargingOrderId)
      .single();

    if (!order) throw new Error('充电订单不存在');

    const { data, error } = await supabase
      .from('parking_fee_orders')
      .insert({
        charging_order_id: chargingOrderId,
        user_id: (order as any).user_id,
        station_id: (order as any).station_id,
        charge_complete_time: chargeCompleteTime.toISOString(),
        overtime_minutes: 0,
        parking_fee: 0,
        rate_per_minute: rate,
        grace_period_minutes: grace,
        status: 'parked',
      })
      .select()
      .single();

    if (error) throw new Error(`创建停车费订单失败: ${error.message}`);

    // 发送通知
    await supabase.from('notifications').insert({
      user_id: (order as any).user_id,
      type: 'charging_complete',
      title: '充电完成，请注意停车时间',
      content: `您的车辆已完成充电，请在 ${grace} 分钟内驶离，超时将产生 ¥${rate}/分钟的停车费`,
      related_id: chargingOrderId,
    });

    return new ParkingFeeOrder(data as any);
  }

  calculateOvertimeFee(): number {
    const endTime = this.departTime || new Date();
    const elapsedMs = endTime.getTime() - this.chargeCompleteTime.getTime();
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const overtime = Math.max(0, elapsedMinutes - this.gracePeriodMinutes);

    this.overtimeMinutes = overtime;
    this.parkingFee = Math.round(overtime * this.ratePerMinute * 100) / 100;
    return this.parkingFee;
  }

  async markDeparted(): Promise<void> {
    this.departTime = new Date();
    this.status = 'departed';

    const overtime = this.calculateOvertimeFee();

    await supabase
      .from('parking_fee_orders')
      .update({
        depart_time: this.departTime.toISOString(),
        overtime_minutes: this.overtimeMinutes,
        parking_fee: this.parkingFee,
        status: 'departed',
      })
      .eq('id', this.id);

    if (overtime > 0) {
      await supabase.from('notifications').insert({
        user_id: this.userId,
        type: 'overtime_warning',
        title: '超时停车费用通知',
        content: `您超时停车 ${overtime} 分钟，产生停车费 ¥${this.parkingFee}`,
        related_id: this.id,
      });
    }
  }

  getOvertimeDuration(): number {
    return this.calculateOvertimeFee();
  }

  static async fetchByChargingOrder(chargingOrderId: string): Promise<ParkingFeeOrder | null> {
    const { data, error } = await supabase
      .from('parking_fee_orders')
      .select('*')
      .eq('charging_order_id', chargingOrderId)
      .maybeSingle();

    if (error || !data) return null;
    return new ParkingFeeOrder(data as any);
  }
}
