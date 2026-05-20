import { supabase } from '@/lib/supabase';
import { ChargingOrder } from './ChargingOrder';
import { ParkingFeeOrder } from './ParkingFeeOrder';
import { BillDetail, OrderStatus } from '@/lib/types';

export class Bill {
  id: string;
  userId: string;
  chargingOrderId: string;
  parkingFeeOrderId?: string;
  chargingFee: number;
  parkingFee: number;
  totalAmount: number;
  generatedAt: Date;
  paidAt?: Date;
  status: 'unpaid' | 'paid' | 'cancelled';

  constructor(data: {
    id: string; user_id: string; charging_order_id: string;
    parking_fee_order_id?: string; charging_fee: number; parking_fee: number;
    total_amount: number; generated_at: string; paid_at?: string;
    status: string;
  }) {
    this.id = data.id;
    this.userId = data.user_id;
    this.chargingOrderId = data.charging_order_id;
    this.parkingFeeOrderId = data.parking_fee_order_id;
    this.chargingFee = data.charging_fee;
    this.parkingFee = data.parking_fee;
    this.totalAmount = data.total_amount;
    this.generatedAt = new Date(data.generated_at);
    this.paidAt = data.paid_at ? new Date(data.paid_at) : undefined;
    this.status = data.status as 'unpaid' | 'paid' | 'cancelled';
  }

  static async generate(
    userId: string,
    chargingOrderId: string,
    ratePerKwh: number,
    parkingFeeOrderId?: string
  ): Promise<Bill> {
    const chargingOrder = await ChargingOrder.fetchById(chargingOrderId);
    const chargingFee = chargingOrder.calculateChargingFee(ratePerKwh);

    let parkingFee = 0;
    if (parkingFeeOrderId) {
      const parkingOrder = await ParkingFeeOrder.fetchByChargingOrder(chargingOrderId);
      if (parkingOrder) {
        parkingFee = parkingOrder.calculateOvertimeFee();
      }
    }

    const totalAmount = Math.round((chargingFee + parkingFee) * 100) / 100;

    const { data, error } = await supabase
      .from('bills')
      .insert({
        user_id: userId,
        charging_order_id: chargingOrderId,
        parking_fee_order_id: parkingFeeOrderId || null,
        charging_fee: chargingFee,
        parking_fee: parkingFee,
        total_amount: totalAmount,
        status: 'unpaid',
      })
      .select()
      .single();

    if (error) throw new Error(`生成账单失败: ${error.message}`);

    // 通知用户
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'bill_generated',
      title: '充电账单已生成',
      content: `账单合计: ¥${totalAmount}（充电费 ¥${chargingFee}${parkingFee > 0 ? ` + 停车费 ¥${parkingFee}` : ''}）`,
      related_id: (data as any).id,
    });

    return new Bill(data as any);
  }

  async getDetail(): Promise<BillDetail> {
    const [chargingOrder, parkingFeeOrder] = await Promise.all([
      ChargingOrder.fetchById(this.chargingOrderId).catch(() => null),
      this.parkingFeeOrderId
        ? ParkingFeeOrder.fetchByChargingOrder(this.chargingOrderId)
        : null,
    ]);

    return {
      id: this.id,
      userId: this.userId,
      chargingOrderId: this.chargingOrderId,
      parkingFeeOrderId: this.parkingFeeOrderId,
      chargingFee: this.chargingFee,
      parkingFee: this.parkingFee,
      totalAmount: this.totalAmount,
      generatedAt: this.generatedAt.toISOString(),
      paidAt: this.paidAt?.toISOString(),
      status: this.status,
      chargingOrder: chargingOrder ? {
        id: chargingOrder.id,
        userId: chargingOrder.userId,
        stationId: chargingOrder.stationId,
        queueEntryId: chargingOrder.queueEntryId,
        mode: chargingOrder.mode,
        status: chargingOrder.status,
        requestBatteryLevel: chargingOrder.requestBatteryLevel,
        targetBatteryLevel: chargingOrder.targetBatteryLevel,
        startTime: chargingOrder.startTime?.toISOString(),
        endTime: chargingOrder.endTime?.toISOString(),
        energyConsumed: chargingOrder.energyConsumed,
        chargingFee: chargingOrder.chargingFee,
        createdAt: chargingOrder.createdAt.toISOString(),
      } : undefined,
      parkingFeeOrder: parkingFeeOrder ? {
        id: parkingFeeOrder.id,
        chargingOrderId: parkingFeeOrder.chargingOrderId,
        userId: parkingFeeOrder.userId,
        stationId: parkingFeeOrder.stationId,
        chargeCompleteTime: parkingFeeOrder.chargeCompleteTime.toISOString(),
        departTime: parkingFeeOrder.departTime?.toISOString(),
        overtimeMinutes: parkingFeeOrder.overtimeMinutes,
        parkingFee: parkingFeeOrder.parkingFee,
        ratePerMinute: parkingFeeOrder.ratePerMinute,
        gracePeriodMinutes: parkingFeeOrder.gracePeriodMinutes,
        status: parkingFeeOrder.status,
      } : undefined,
    };
  }

  async markAsPaid(): Promise<void> {
    this.status = 'paid';
    this.paidAt = new Date();

    await supabase
      .from('bills')
      .update({ status: 'paid', paid_at: this.paidAt.toISOString() })
      .eq('id', this.id);
  }

  static async fetchByUser(userId: string): Promise<Bill[]> {
    const { data, error } = await supabase
      .from('bills')
      .select('*')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false });

    if (error) throw new Error(`获取账单失败: ${error.message}`);
    return (data || []).map((b: any) => new Bill(b));
  }

  static async fetchById(billId: string): Promise<Bill> {
    const { data, error } = await supabase
      .from('bills')
      .select('*')
      .eq('id', billId)
      .single();

    if (error || !data) throw new Error('账单不存在');
    return new Bill(data as any);
  }
}
