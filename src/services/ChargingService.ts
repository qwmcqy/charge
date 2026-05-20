import { createServiceClient } from '@/lib/supabase';
import { User } from '@/models/User';
import { ChargingStation } from '@/models/ChargingStation';
import { ChargingOrder } from '@/models/ChargingOrder';
import { QueueService } from './QueueService';
import { FaultService } from './FaultService';
import { ParkingFeeOrder as ParkingFeeOrderModel } from '@/models/ParkingFeeOrder';
import { OrderStatus, ChargeMode } from '@/lib/types';
import { SIMULATION } from '@/lib/constants';

const supabase = createServiceClient();

export class ChargingService {
  /**
   * UC01 发起充电请求
   * 新算法：有可用充电桩 → 直接充电；无 → 进入队列；队列满 → 等候队列
   */
  static async requestCharge(
    userId: string,
    mode: ChargeMode,
    batteryLevel: number,
    targetLevel: number
  ) {
    if (batteryLevel < 0 || batteryLevel > 100) throw new Error('电量百分比无效');
    if (targetLevel <= batteryLevel) throw new Error('目标电量必须高于当前电量');
    if (targetLevel > 100) throw new Error('目标电量不能超过100%');

    const order = await ChargingOrder.create(userId, mode, batteryLevel, targetLevel);
    const result = await QueueService.tryChargeOrQueue(order);
    return { order, ...result };
  }

  /**
   * UC04 查看充电进度
   */
  static async getChargingProgress(orderId: string, userId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权查看此订单');

    const user = await User.fetchById(userId);
    return user.getChargingProgress(orderId);
  }

  /**
   * 取消充电请求
   */
  static async cancelRequest(orderId: string, userId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权取消此订单');

    if (![OrderStatus.Pending, OrderStatus.Queued].includes(order.status)) {
      throw new Error('只能取消等待审核或排队中的请求');
    }

    await order.cancel();
    return order;
  }

  /**
   * 分配充电桩并开始充电
   */
  static async assignAndStartCharging(orderId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    const station = await ChargingStation.fetchAvailable(order.mode);
    if (!station) throw new Error('暂无可用的充电桩');

    await order.assignStation(station.id);
    await station.startCharging(order.id);
    await order.startCharging();

    if (order.queueEntryId) {
      await supabase
        .from('queue_entries')
        .update({ status: 'charging' })
        .eq('id', order.queueEntryId);
    }

    return { order, station };
  }

  /**
   * 模拟充电过程（加速版：每次 tick 模拟 6 分钟）
   */
  static async simulateChargingTick(orderId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.status !== OrderStatus.Charging) return null;
    if (!order.stationId) throw new Error('订单未分配充电桩');

    const station = await ChargingStation.fetchById(order.stationId);

    const SIMULATED_MINUTES = 6;
    station.simulateChargingData(SIMULATED_MINUTES);
    await station.reportStatus();

    // 故障检测
    const fault = station.detectFault();
    if (fault) {
      fault.affectedOrderId = order.id;
      await fault.report();
      await order.endCharging(OrderStatus.FaultStopped);
      QueueService.dispatchNext(order.mode as 'fast' | 'slow').catch(() => {});
      return { order, station, fault, stopped: true };
    }

    // 更新充电进度
    order.energyConsumed += (station.currentPower / 60) * SIMULATED_MINUTES;
    order.energyConsumed = Math.round(order.energyConsumed * 1000) / 1000;

    const progressBattery = order.requestBatteryLevel + (order.energyConsumed / 60) * 100;
    const targetReached = progressBattery >= order.targetBatteryLevel;

    await supabase
      .from('charging_orders')
      .update({ energy_consumed: order.energyConsumed })
      .eq('id', order.id);

    if (targetReached) {
      const actualRate = order.mode === ChargeMode.Fast ? 1.2 : 0.8;
      order.calculateChargingFee(actualRate);

      await order.endCharging(OrderStatus.Completed);
      await station.stopCharging();

      // 创建停车费订单，开始计时（账单在用户离开时生成）
      await ParkingFeeOrderModel.create(order.id, new Date());

      // 释放充电桩，调度下一个等待者
      QueueService.dispatchNext(order.mode as 'fast' | 'slow').catch(() => {});

      return { order, station, completed: true };
    }

    return { order, station, charging: true };
  }

  /**
   * 结束充电（用户主动结束）
   */
  static async endCharging(orderId: string, userId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权操作此订单');
    if (order.status !== OrderStatus.Charging && order.status !== 'paused') throw new Error('订单不在充电中');

    const rate = order.mode === ChargeMode.Fast ? 1.2 : 0.8;
    order.calculateChargingFee(rate);

    const chargeMode = order.mode as 'fast' | 'slow';

    await order.endCharging(OrderStatus.Completed);

    if (order.stationId) {
      const station = await ChargingStation.fetchById(order.stationId);
      await station.stopCharging();
    }

    // 创建停车费订单，开始计时（账单在用户离开时生成）
    const { ParkingFeeOrder } = await import('@/models/ParkingFeeOrder');
    await ParkingFeeOrder.create(order.id, new Date());

    // 释放充电桩，调度下一个等待者
    QueueService.dispatchNext(chargeMode).catch(() => {});

    return order;
  }

  /**
   * 车主离开：结束停车计时，计算超时费，生成账单
   */
  static async depart(orderId: string, userId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权操作此订单');
    if (order.status !== OrderStatus.Completed) throw new Error('充电尚未完成');

    // 查找停车费订单
    const parkingOrder = await ParkingFeeOrderModel.fetchByChargingOrder(orderId);
    if (!parkingOrder) throw new Error('停车记录不存在');
    if (parkingOrder.status === 'departed') throw new Error('已经离开过了');
    if (parkingOrder.status === 'paid') throw new Error('账单已支付');

    // 标记离开，计算超时费
    await parkingOrder.markDeparted();

    // 现在生成账单（包含充电费 + 实际停车超时费）
    const rate = order.mode === ChargeMode.Fast ? 1.2 : 0.8;
    const { Bill } = await import('@/models/Bill');
    const bill = await Bill.generate(order.userId, orderId, rate, parkingOrder.id);

    return {
      order,
      parkingOrder,
      bill,
      overtimeMinutes: parkingOrder.overtimeMinutes,
      parkingFee: parkingOrder.parkingFee,
      totalAmount: bill.totalAmount,
    };
  }

  /**
   * 获取当前停车状态（供仪表盘轮询使用）
   */
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

  /**
   * 模拟所有活跃订单的充电 tick
   */
  static async simulateAllActiveOrders() {
    const { data: orders, error } = await supabase
      .from('charging_orders')
      .select('id')
      .eq('status', 'charging');

    if (error) throw new Error(`获取活跃订单失败: ${error.message}`);

    const results = [];
    for (const o of (orders || [])) {
      try {
        const result = await this.simulateChargingTick(o.id);
        results.push({ orderId: o.id, ...result });
      } catch (err: any) {
        results.push({ orderId: o.id, error: err.message });
      }
    }

    return results;
  }

  /**
   * 暂停充电
   */
  static async pauseCharging(orderId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.status !== OrderStatus.Charging) throw new Error('订单不在充电中，无法暂停');

    await supabase
      .from('charging_orders')
      .update({ status: 'paused' })
      .eq('id', orderId);

    if (order.stationId) {
      await supabase
        .from('charging_stations')
        .update({ current_power: 0 })
        .eq('id', order.stationId);
    }

    return { orderId, status: 'paused' };
  }

  /**
   * 恢复充电
   */
  static async resumeCharging(orderId: string) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.status !== 'paused') throw new Error('订单不在暂停状态，无法恢复');

    await supabase
      .from('charging_orders')
      .update({ status: 'charging' })
      .eq('id', orderId);

    return { orderId, status: 'charging' };
  }

  /**
   * 管理员审核请求（保留用于手动审核场景）
   */
  static async auditRequest(orderId: string, adminId: string, approved: boolean, reason?: string) {
    const { Administrator } = await import('@/models/Administrator');
    const admin = await Administrator.fetchByUserId(adminId);
    await admin.auditRequest(orderId, approved, reason);
  }

  /**
   * 获取待审核请求
   */
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
