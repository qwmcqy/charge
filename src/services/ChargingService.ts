import { createServiceClient } from '@/lib/supabase';
import { User } from '@/models/User';
import { ChargingStation } from '@/models/ChargingStation';
import { ChargingOrder } from '@/models/ChargingOrder';
import { QueueService } from './QueueService';
import { FaultService } from './FaultService';
import { ParkingFeeOrder as ParkingFeeOrderModel } from '@/models/ParkingFeeOrder';
import { OrderStatus, ChargeMode, NotificationType } from '@/lib/types';
import { Notification } from '@/models/Notification';
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
    } else {
      // 兼容旧数据：订单上可能未记录 queue_entry_id，但队列条目存在
      await supabase
        .from('queue_entries')
        .update({ status: 'charging' })
        .eq('order_id', orderId)
        .eq('status', 'waiting');
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

    // 故障检测 — 不直接结束，等待用户选择
    const fault = station.detectFault();
    if (fault) {
      fault.affectedOrderId = order.id;
      await fault.report(true); // 跳过订单状态更新，由本方法控制

      // 设置订单为故障待处理状态，等待用户选择
      await supabase
        .from('charging_orders')
        .update({ status: 'fault_pending' })
        .eq('id', order.id);

      order.status = OrderStatus.FaultPending;

      // 通知用户选择处理方式
      await Notification.send(
        order.userId,
        NotificationType.System,
        '充电异常 — 请选择处理方式',
        `您的充电因${fault.description}已中断。您可以：① 结束本次充电；② 优先插入队列第一位，等充电桩恢复后继续充电。故障ID: ${fault.id?.slice(0, 8)}`,
        order.id
      );

      return { order, station, fault, faultPending: true };
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
      try {
        await ParkingFeeOrderModel.create(order.id, new Date());
      } catch (err: any) {
        console.error('创建停车费订单失败:', err.message, 'orderId:', order.id);
      }

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
    try {
      const { ParkingFeeOrder } = await import('@/models/ParkingFeeOrder');
      await ParkingFeeOrder.create(order.id, new Date());
    } catch (err: any) {
      console.error('创建停车费订单失败:', err.message, 'orderId:', order.id);
    }

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
    let parkingOrder = await ParkingFeeOrderModel.fetchByChargingOrder(orderId);
    // 如果停车订单不存在（可能因之前创建失败），自动补建
    if (!parkingOrder) {
      try {
        parkingOrder = await ParkingFeeOrderModel.create(orderId, new Date());
      } catch {
        return null;
      }
    }

    parkingOrder.calculateOvertimeFee();

    const now = new Date();
    const elapsedMs = now.getTime() - parkingOrder.chargeCompleteTime.getTime();
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const graceRemaining = Math.max(0, parkingOrder.gracePeriodMinutes - elapsedMinutes);
    const isOvertime = elapsedMinutes > parkingOrder.gracePeriodMinutes;

    return {
      parked: parkingOrder.status === 'parked',
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
   * 故障处理决策：用户选择结束充电或优先排队
   */
  static async handleFaultDecision(
    orderId: string,
    userId: string,
    decision: 'end' | 'requeue'
  ) {
    const order = await ChargingOrder.fetchById(orderId);
    if (order.userId !== userId) throw new Error('无权操作此订单');
    if (order.status !== OrderStatus.FaultPending) throw new Error('订单不在故障待处理状态');

    if (decision === 'end') {
      await order.endCharging(OrderStatus.FaultStopped);
      QueueService.dispatchNext(order.mode as 'fast' | 'slow').catch(() => {});
      return { order, choice: 'end' };
    }

    // 优先排队：结束当前订单，创建新订单并插入队列第一位
    await order.endCharging(OrderStatus.FaultStopped);

    // 创建新订单（fresh start，energy_consumed 归零）
    const newOrder = await ChargingOrder.create(
      userId,
      order.mode,
      order.requestBatteryLevel,
      order.targetBatteryLevel
    );

    // 查找对应类型的队列
    const { data: queue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', order.mode)
      .single();
    if (!queue) throw new Error(`${order.mode} 队列不存在`);

    // 将所有现有队列条目后移一位
    const { data: queueEntries } = await supabase
      .from('queue_entries')
      .select('id, position')
      .eq('queue_id', (queue as any).id)
      .eq('status', 'waiting')
      .order('position', { ascending: true });

    for (const entry of (queueEntries || []).reverse()) {
      await supabase
        .from('queue_entries')
        .update({ position: entry.position + 1 })
        .eq('id', entry.id);
    }

    // 在位置1插入新的优先排队条目（关联新订单）
    const { data: newEntry, error: entryErr } = await supabase
      .from('queue_entries')
      .insert({
        user_id: userId,
        order_id: newOrder.id,
        queue_id: (queue as any).id,
        mode: order.mode,
        position: 1,
        status: 'waiting',
        battery_level: order.requestBatteryLevel,
        estimated_wait_minutes: order.mode === 'fast' ? 40 : 180,
      })
      .select()
      .single();

    if (entryErr) throw new Error(`创建优先排队条目失败: ${entryErr.message}`);

    // 关联新订单到队列条目
    await supabase
      .from('charging_orders')
      .update({ queue_entry_id: newEntry.id, status: 'queued' })
      .eq('id', newOrder.id);

    await Notification.send(
      userId,
      NotificationType.System,
      '优先排队已生效',
      `您已插入${order.mode === 'fast' ? '快充' : '慢充'}队列第一位，等待充电桩恢复后将继续充电。`,
      newOrder.id
    );

    // 尝试立即调度
    QueueService.dispatchNext(order.mode as 'fast' | 'slow').catch(() => {});

    return { order, newOrderId: newOrder.id, choice: 'requeue', queueEntry: newEntry, position: 1 };
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
