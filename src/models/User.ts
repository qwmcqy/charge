import type {
  BillData, BillDetail, UserProfile, NotificationData,
} from '@/lib/types';
import { supabase } from '@/lib/supabase';

export class User {
  id: string;
  name: string;
  phone: string;
  email: string;
  vehiclePlate: string;
  vehicleModel: string;
  batteryCapacity: number;
  paymentMethods: string[];
  createdAt: Date;

  constructor(profile: UserProfile) {
    this.id = profile.id;
    this.name = profile.name;
    this.phone = profile.phone || '';
    this.email = profile.email || '';
    this.vehiclePlate = profile.vehiclePlate || '';
    this.vehicleModel = profile.vehicleModel || '';
    this.batteryCapacity = profile.batteryCapacity || 60;
    this.paymentMethods = [];
    this.createdAt = new Date(profile.createdAt);
  }

  // UC01 发起充电请求
  async requestCharge(mode: 'fast' | 'slow', batteryLevel: number, targetLevel: number) {
    const { data: order, error } = await supabase
      .from('charging_orders')
      .insert({
        user_id: this.id,
        mode,
        status: 'pending',
        request_battery_level: batteryLevel,
        target_battery_level: targetLevel,
      })
      .select()
      .single();

    if (error) throw new Error(`发起充电请求失败: ${error.message}`);
    return order;
  }

  // UC02 查询排队状态
  async queryQueueStatus() {
    const { data: entry, error } = await supabase
      .from('queue_entries')
      .select('*, queues!inner(type)')
      .eq('user_id', this.id)
      .in('status', ['waiting', 'ready'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`查询排队状态失败: ${error.message}`);
    if (!entry) return { inQueue: false, position: 0, totalWaiting: 0, estimatedWaitMinutes: 0 };

    const { count } = await supabase
      .from('queue_entries')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', entry.queue_id)
      .eq('status', 'waiting')
      .lte('position', entry.position);

    return {
      inQueue: true,
      entry,
      position: entry.position,
      totalWaiting: count || 0,
      estimatedWaitMinutes: entry.estimated_wait_minutes,
    };
  }

  // UC03 接收通知
  async getNotifications(): Promise<NotificationData[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', this.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(`获取通知失败: ${error.message}`);
    return data as NotificationData[];
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', this.id);

    if (error) throw new Error(`标记已读失败: ${error.message}`);
  }

  // UC04 查看充电进度
  async getChargingProgress(orderId: string) {
    const { data: order, error } = await supabase
      .from('charging_orders')
      .select('*, charging_stations(*)')
      .eq('id', orderId)
      .eq('user_id', this.id)
      .single();

    if (error) throw new Error(`获取充电进度失败: ${error.message}`);

    const station = (order as any).charging_stations;
    const startTime = order.start_time ? new Date(order.start_time) : null;
    const durationMinutes = startTime
      ? Math.floor((Date.now() - startTime.getTime()) / 60000)
      : 0;

    const requestedKwh = Number(order.target_battery_level || 0);
    const progress = requestedKwh > 0
      ? Math.min(100, (Number(order.energy_consumed || 0) / requestedKwh) * 100)
      : 0;
    const estimatedRemaining = station
      ? Math.max(0, requestedKwh - Number(order.energy_consumed || 0)) / (Number(station.max_power || 1) / 60)
      : 0;

    return {
      orderId: order.id,
      status: order.status,
      stationNumber: station?.station_number || null,
      mode: order.mode,
      startTime: order.start_time,
      currentVoltage: station?.current_voltage || 0,
      currentCurrent: station?.current_current || 0,
      currentPower: station?.current_power || 0,
      energyConsumed: order.energy_consumed,
      durationMinutes,
      batteryLevel: Math.round(progress),
      targetBatteryLevel: requestedKwh,
      estimatedRemainingMinutes: Math.max(0, Math.round(estimatedRemaining)),
    };
  }

  // UC05 获取账单
  async getBills(): Promise<BillData[]> {
    const { data, error } = await supabase
      .from('bills')
      .select('*')
      .eq('user_id', this.id)
      .order('generated_at', { ascending: false });

    if (error) throw new Error(`获取账单失败: ${error.message}`);
    return data as BillData[];
  }

  async getBillDetail(billId: string): Promise<BillDetail> {
    const { data: bill, error } = await supabase
      .from('bills')
      .select('*, charging_orders(*), parking_fee_orders(*)')
      .eq('id', billId)
      .eq('user_id', this.id)
      .single();

    if (error) throw new Error(`获取账单详情失败: ${error.message}`);
    return {
      ...bill,
      chargingOrder: (bill as any).charging_orders,
      parkingFeeOrder: (bill as any).parking_fee_orders,
    } as BillDetail;
  }

  // UC06 缴纳超时费用
  async payOvertimeFee(parkingOrderId: string) {
    const { data: parkingOrder, error: fetchError } = await supabase
      .from('parking_fee_orders')
      .select('*')
      .eq('id', parkingOrderId)
      .eq('user_id', this.id)
      .single();

    if (fetchError) throw new Error(`获取停车费订单失败: ${fetchError.message}`);
    if (!parkingOrder) throw new Error('停车费订单不存在');

    const { data: payment, error: payError } = await supabase
      .from('payment_orders')
      .insert({
        order_id: parkingOrderId,
        user_id: this.id,
        amount: parkingOrder.parking_fee,
        type: 'parking_fee',
        status: 'pending',
      })
      .select()
      .single();

    if (payError) throw new Error(`创建支付单失败: ${payError.message}`);

    const success = Math.random() < 0.9;
    const transactionId = success ? `TXN${Date.now()}${Math.random().toString(36).slice(2, 8)}` : undefined;

    await supabase
      .from('payment_orders')
      .update({
        status: success ? 'paid' : 'failed',
        transaction_id: transactionId,
        paid_at: success ? new Date().toISOString() : null,
      })
      .eq('id', (payment as any).id);

    if (success) {
      await supabase
        .from('parking_fee_orders')
        .update({ status: 'paid' })
        .eq('id', parkingOrderId);
    }

    return { success, transactionId, message: success ? '支付成功' : '支付失败，请重试' };
  }

  // 通用支付
  async payBill(billId: string, method: string) {
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .select('*')
      .eq('id', billId)
      .eq('user_id', this.id)
      .single();

    if (billError) throw new Error(`获取账单失败: ${billError.message}`);

    const { data: payment, error } = await supabase
      .from('payment_orders')
      .insert({
        order_id: billId,
        user_id: this.id,
        amount: bill.total_amount,
        type: 'combined',
        status: 'pending',
        method,
      })
      .select()
      .single();

    if (error) throw new Error(`创建支付单失败: ${error.message}`);

    const success = Math.random() < 0.9;
    const transactionId = success ? `TXN${Date.now()}${Math.random().toString(36).slice(2, 8)}` : undefined;

    await supabase
      .from('payment_orders')
      .update({
        status: success ? 'paid' : 'failed',
        transaction_id: transactionId,
        paid_at: success ? new Date().toISOString() : null,
      })
      .eq('id', (payment as any).id);

    if (success) {
      await supabase.from('bills').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', billId);
    }

    return { success, transactionId, message: success ? '支付成功' : '支付失败，请重试' };
  }

  // 取消充电请求
  async cancelChargeRequest(orderId: string) {
    const { error } = await supabase
      .from('charging_orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .eq('user_id', this.id);

    if (error) throw new Error(`取消请求失败: ${error.message}`);

    await supabase
      .from('queue_entries')
      .update({ status: 'cancelled' })
      .eq('order_id', orderId)
      .eq('user_id', this.id);
  }

  // 静态工厂方法
  static async fetchById(userId: string): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) throw new Error('用户不存在');
    return new User(data as UserProfile);
  }

  // 保存用户信息
  async save(): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({
        name: this.name,
        phone: this.phone,
        vehicle_plate: this.vehiclePlate,
        vehicle_model: this.vehicleModel,
        battery_capacity: this.batteryCapacity,
      })
      .eq('id', this.id);

    if (error) throw new Error(`保存用户信息失败: ${error.message}`);
  }
}
