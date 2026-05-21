import { createServiceClient } from '@/lib/supabase';
import { User } from '@/models/User';
import { ChargingStation } from '@/models/ChargingStation';
import { ChargingOrder } from '@/models/ChargingOrder';
import { QueueService } from './QueueService';
import { ParkingFeeOrder as ParkingFeeOrderModel } from '@/models/ParkingFeeOrder';
import { OrderStatus, ChargeMode } from '@/lib/types';
import { calculateTimeOfUseFee, getModePowerKwhPerHour } from '@/lib/billing';

const supabase = createServiceClient();

export class ChargingService {
  static async requestCharge(
    userId: string,
    mode: ChargeMode,
    currentBatteryLevel: number,
    requestedKwh: number
  ) {
    if (requestedKwh <= 0) throw new Error('请求充电量必须大于0度');
    const order = await ChargingOrder.create(userId, mode, currentBatteryLevel, requestedKwh);
    const result = await QueueService.tryChargeOrQueue(order);
    return { order, ...result };
  }

  static async changeRequest(
    orderId: string,
    userId: string,
    mode?: ChargeMode,
    requestedKwh?: number
  ) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权修改此订单');
    if (order.status !== OrderStatus.Queued && order.status !== OrderStatus.Pending) {
      throw new Error('车辆进入充电区后不能修改请求，请取消后重新排队');
    }
    if (requestedKwh !== undefined && requestedKwh <= 0) throw new Error('请求充电量必须大于0度');

    if (order.queueEntryId) {
      await supabase.from('queue_entries').update({ status: 'cancelled' }).eq('id', order.queueEntryId);
    }

    const nextMode = mode || order.mode;
    const nextKwh = requestedKwh ?? order.targetBatteryLevel;
    await supabase
      .from('charging_orders')
      .update({
        mode: nextMode,
        target_battery_level: nextKwh,
        station_id: null,
        queue_entry_id: null,
        status: 'pending',
      })
      .eq('id', order.id);

    const updated = await ChargingOrder.fetchById(order.id);
    return QueueService.tryChargeOrQueue(updated);
  }

  static async getChargingProgress(orderId: string, userId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权查看此订单');
    const user = await User.fetchById(userId);
    return user.getChargingProgress(orderId);
  }

  static async cancelRequest(orderId: string, userId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权取消此订单');
    if (![OrderStatus.Pending, OrderStatus.Queued, OrderStatus.Assigned, OrderStatus.Charging].includes(order.status)) {
      throw new Error('当前订单不能取消');
    }
    await order.cancel();
    if (order.stationId && (order.status === OrderStatus.Charging || order.status === OrderStatus.Assigned)) {
      const station = await ChargingStation.fetchById(order.stationId);
      await station.stopCharging();
      QueueService.dispatchNext(order.mode as 'fast' | 'slow').catch(() => {});
    }
    return order;
  }

  static async assignAndStartCharging(orderId: string, stationId?: string) {
    const order = await ChargingOrder.fetchById(orderId);
    const station = stationId || order.stationId
      ? await ChargingStation.fetchById((stationId || order.stationId)!)
      : await ChargingStation.fetchAvailable(order.mode);
    if (!station) throw new Error('暂无可用的充电桩');
    if (station.status !== 'available' && station.currentOrderId !== order.id) {
      throw new Error('目标充电桩当前不可用');
    }

    await order.assignStation(station.id);
    await station.startCharging(order.id);
    await order.startCharging();

    if (order.queueEntryId) {
      await supabase.from('queue_entries').update({ status: 'charging' }).eq('id', order.queueEntryId);
    }

    return { order, station };
  }

  static async simulateChargingTick(orderId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.status !== OrderStatus.Charging) return null;
    if (!order.stationId) throw new Error('订单未分配充电桩');

    const station = await ChargingStation.fetchById(order.stationId);
    const simulatedMinutes = 6;
    station.simulateChargingData(simulatedMinutes);
    await station.reportStatus();

    const fault = station.detectFault();
    if (fault) {
      fault.affectedOrderId = order.id;
      await fault.report();
      await order.endCharging(OrderStatus.FaultStopped);
      await QueueService.rescheduleStationQueue(station.id, order.mode);
      QueueService.dispatchNext(order.mode as 'fast' | 'slow').catch(() => {});
      return { order, station, fault, stopped: true };
    }

    const increment = (getModePowerKwhPerHour(order.mode) / 60) * simulatedMinutes;
    order.energyConsumed = Math.min(order.targetBatteryLevel, Math.round((order.energyConsumed + increment) * 1000) / 1000);
    const fee = calculateTimeOfUseFee(order.startTime || new Date(), order.energyConsumed, order.mode);

    await supabase
      .from('charging_orders')
      .update({ energy_consumed: order.energyConsumed, charging_fee: fee.totalFee })
      .eq('id', order.id);

    if (order.energyConsumed >= order.targetBatteryLevel) {
      order.chargingFee = fee.totalFee;
      await order.endCharging(OrderStatus.Completed);
      await station.stopCharging();
      await ParkingFeeOrderModel.create(order.id, new Date());
      QueueService.dispatchNext(order.mode as 'fast' | 'slow').catch(() => {});
      return { order, station, completed: true };
    }

    return { order, station, charging: true };
  }

  static async endCharging(orderId: string, userId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权操作此订单');
    if (order.status !== OrderStatus.Charging && order.status !== 'paused') throw new Error('订单不在充电中');

    const fee = calculateTimeOfUseFee(order.startTime || new Date(), order.energyConsumed, order.mode);
    await supabase.from('charging_orders').update({ charging_fee: fee.totalFee }).eq('id', order.id);
    const chargeMode = order.mode as 'fast' | 'slow';

    await order.endCharging(OrderStatus.Completed);
    if (order.stationId) {
      const station = await ChargingStation.fetchById(order.stationId);
      await station.stopCharging();
    }
    await ParkingFeeOrderModel.create(order.id, new Date());
    QueueService.dispatchNext(chargeMode).catch(() => {});
    return order;
  }

  static async depart(orderId: string, userId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权操作此订单');
    if (order.status !== OrderStatus.Completed) throw new Error('充电尚未完成');

    const parkingOrder = await ParkingFeeOrderModel.fetchByChargingOrder(orderId);
    if (!parkingOrder) throw new Error('停车记录不存在');
    if (parkingOrder.status === 'departed') throw new Error('已经离开过了');
    if (parkingOrder.status === 'paid') throw new Error('账单已支付');

    await parkingOrder.markDeparted();
    const { Bill } = await import('@/models/Bill');
    const bill = await Bill.generate(order.userId, orderId, undefined, parkingOrder.id);

    return {
      order,
      parkingOrder,
      bill,
      overtimeMinutes: parkingOrder.overtimeMinutes,
      parkingFee: parkingOrder.parkingFee,
      totalAmount: bill.totalAmount,
    };
  }

  static async getParkingStatus(orderId: string) {
    const parkingOrder = await ParkingFeeOrderModel.fetchByChargingOrder(orderId);
    if (!parkingOrder) return null;

    parkingOrder.calculateOvertimeFee();
    const now = new Date();
    const elapsedMs = now.getTime() - parkingOrder.chargeCompleteTime.getTime();
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const graceRemaining = Math.max(0, parkingOrder.gracePeriodMinutes - elapsedMinutes);
    const isOvertime = elapsedMinutes > parkingOrder.gracePeriodMinutes;

    return {
      status: parkingOrder.status,
      chargeCompleteTime: parkingOrder.chargeCompleteTime.toISOString(),
      elapsedMinutes,
      gracePeriodMinutes: parkingOrder.gracePeriodMinutes,
      graceRemainingMinutes: graceRemaining,
      isOvertime,
      overtimeMinutes: parkingOrder.overtimeMinutes,
      parkingFee: parkingOrder.parkingFee,
      ratePerMinute: parkingOrder.ratePerMinute,
    };
  }

  static async simulateAllActiveOrders() {
    const { data: orders, error } = await supabase
      .from('charging_orders')
      .select('id')
      .eq('status', 'charging');
    if (error) throw new Error(`获取活跃订单失败: ${error.message}`);

    const results = [];
    for (const o of (orders || [])) {
      try {
        const result = await this.simulateChargingTick((o as any).id);
        results.push({ orderId: (o as any).id, ...result });
      } catch (err: any) {
        results.push({ orderId: (o as any).id, error: err.message });
      }
    }
    return results;
  }

  static async pauseCharging(orderId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.status !== OrderStatus.Charging) throw new Error('订单不在充电中，无法暂停');
    await supabase.from('charging_orders').update({ status: 'paused' }).eq('id', orderId);
    if (order.stationId) {
      await supabase.from('charging_stations').update({ current_power: 0 }).eq('id', order.stationId);
    }
    return { orderId, status: 'paused' };
  }

  static async resumeCharging(orderId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.status !== 'paused') throw new Error('订单不在暂停状态，无法恢复');
    await supabase.from('charging_orders').update({ status: 'charging' }).eq('id', orderId);
    return { orderId, status: 'charging' };
  }

  static async auditRequest(orderId: string, adminId: string, approved: boolean, reason?: string) {
    const { Administrator } = await import('@/models/Administrator');
    const admin = await Administrator.fetchByUserId(adminId);
    await admin.auditRequest(orderId, approved, reason);
  }

  static async getPendingRequests() {
    const { data, error } = await supabase
      .from('charging_orders')
      .select('*, users(name, vehicle_plate)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`获取待审核请求失败: ${error.message}`);
    return data;
  }
}
