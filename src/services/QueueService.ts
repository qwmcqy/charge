import { supabase } from '@/lib/supabase';
import { QueueEntry } from '@/models/QueueEntry';
import { ChargingOrder } from '@/models/ChargingOrder';
import { ChargeMode, OrderStatus, QueueType } from '@/lib/types';
import { Notification, NotificationType } from '@/models/Notification';

export class QueueService {
  /**
   * 检查是否有可用充电桩，有则直接充电，无则加入队列
   * 返回: { directCharge: true, order, station } | { queued: true, entry, isOverflow }
   */
  static async tryChargeOrQueue(order: ChargingOrder) {
    const targetType = order.mode === ChargeMode.Fast ? QueueType.Fast : QueueType.Slow;

    // 1. 先检查是否有可用充电桩
    const { data: availableStation } = await supabase
      .from('charging_stations')
      .select('*')
      .eq('mode', order.mode)
      .eq('status', 'available')
      .limit(1)
      .maybeSingle();

    if (availableStation) {
      // 有可用桩，直接充电
      const { ChargingService } = await import('./ChargingService');
      const result = await ChargingService.assignAndStartCharging(order.id);
      return { directCharge: true, ...result };
    }

    // 2. 无可用桩，进入队列
    return QueueService.autoAssignToQueue(order);
  }

  /**
   * 将订单分配到队列（快充/慢充 → 满则等候队列）
   */
  static async autoAssignToQueue(order: ChargingOrder) {
    const targetType = order.mode === ChargeMode.Fast ? QueueType.Fast : QueueType.Slow;

    // 获取目标队列
    const { data: queue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', targetType)
      .single();
    if (!queue) throw new Error('队列不存在');

    // 检查目标队列是否已满
    const { count: waitingCount } = await supabase
      .from('queue_entries')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', queue.id)
      .eq('status', 'waiting');

    let targetQueue = queue;
    let isOverflow = false;

    if (waitingCount && waitingCount >= queue.max_size) {
      // 主队列已满，进入等候队列（无长度限制）
      const { data: waitingQueue } = await supabase
        .from('queues')
        .select('*')
        .eq('type', 'waiting')
        .single();
      if (!waitingQueue) throw new Error('等候队列不存在');

      targetQueue = waitingQueue;
      isOverflow = true;
    }

    // 计算排队位置
    const { count: position } = await supabase
      .from('queue_entries')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', targetQueue.id)
      .eq('status', 'waiting');
    const newPosition = (position || 0) + 1;

    // 创建队列条目
    const entry = await QueueEntry.create(
      order.userId, order.id, targetQueue.id,
      newPosition, order.mode, order.requestBatteryLevel
    );

    // 更新订单状态
    await supabase
      .from('charging_orders')
      .update({ status: 'queued', queue_entry_id: entry.id })
      .eq('id', order.id);

    order.status = OrderStatus.Queued;
    order.queueEntryId = entry.id;

    // 发送通知
    await Notification.send(
      order.userId,
      NotificationType.System,
      isOverflow ? '已进入等候队列' : '已加入充电队列',
      isOverflow
        ? `当前${order.mode === 'fast' ? '快充' : '慢充'}队列已满，您已进入等候队列（位置 ${newPosition}），有空位时将自动为您分配`
        : `您已加入${order.mode === 'fast' ? '快充' : '慢充'}队列，当前位置: ${newPosition}，预计等待: ${entry.estimatedWaitMinutes}分钟`,
      order.id
    );

    return { queued: true, entry, isOverflow };
  }

  /**
   * 获取用户排队状态
   */
  static async getUserQueueStatus(userId: string) {
    const { data: entry } = await supabase
      .from('queue_entries')
      .select('*, queues(type)')
      .eq('user_id', userId)
      .in('status', ['waiting', 'ready'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!entry) {
      return { inQueue: false, position: 0, totalWaiting: 0, estimatedWaitMinutes: 0 };
    }

    const { count: aheadCount } = await supabase
      .from('queue_entries')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', (entry as any).queue_id)
      .eq('status', 'waiting')
      .lt('position', (entry as any).position);

    return {
      inQueue: true,
      entry,
      position: (entry as any).position,
      totalWaiting: (aheadCount || 0) + 1,
      estimatedWaitMinutes: (entry as any).estimated_wait_minutes,
    };
  }

  /**
   * 调度：充电完成后，从队列取出下一个等待者并分配充电桩
   */
  static async dispatchNext(queueType: 'fast' | 'slow') {
    const { data: queue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', queueType)
      .single();
    if (!queue) return null;

    // 获取队列中最优先的等待条目
    const { data: entries } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('queue_id', queue.id)
      .eq('status', 'waiting')
      .order('position', { ascending: true })
      .limit(1);

    if (!entries || entries.length === 0) {
      // 主队列空，尝试从等候队列提升
      return QueueService.promoteFromWaiting(queueType);
    }

    const entry = entries[0] as any;
    return QueueService.assignEntryToStation(entry);
  }

  /**
   * 从等候队列提升到主队列
   */
  static async promoteFromWaiting(queueType: 'fast' | 'slow') {
    const { data: waitingQueue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', 'waiting')
      .single();
    if (!waitingQueue) return null;

    const { data: waitingEntries } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('queue_id', waitingQueue.id)
      .eq('status', 'waiting')
      .order('position', { ascending: true })
      .limit(1);

    if (!waitingEntries || waitingEntries.length === 0) return null;

    const entry = waitingEntries[0] as any;
    const { data: targetQueue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', queueType)
      .single();
    if (!targetQueue) return null;

    // 检查主队列是否有空位
    const { count: mainCount } = await supabase
      .from('queue_entries')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', targetQueue.id)
      .eq('status', 'waiting');

    if (mainCount && mainCount >= targetQueue.max_size) {
      // 主队列仍然满，无法提升
      return null;
    }

    // 移到目标队列
    const newPosition = (mainCount || 0) + 1;

    await supabase
      .from('queue_entries')
      .update({
        queue_id: targetQueue.id,
        position: newPosition,
        estimated_wait_minutes: newPosition * (queueType === 'fast' ? 40 : 180),
      })
      .eq('id', entry.id);

    await Notification.send(
      entry.user_id,
      NotificationType.System,
      '已从等候队列进入主队列',
      `您已从等候队列进入${queueType === 'fast' ? '快充' : '慢充'}主队列，当前位置: ${newPosition}`,
      entry.order_id
    );

    // 尝试分配（可能有刚释放的充电桩）
    return QueueService.assignEntryToStation(entry);
  }

  /**
   * 为队列条目分配充电桩
   */
  static async assignEntryToStation(entry: any) {
    const { data: station } = await supabase
      .from('charging_stations')
      .select('*')
      .eq('mode', entry.mode)
      .eq('status', 'available')
      .limit(1)
      .maybeSingle();

    if (!station) return null;

    const { ChargingService } = await import('./ChargingService');
    return ChargingService.assignAndStartCharging(entry.order_id);
  }

  /**
   * 管理员获取所有队列状态
   */
  static async getAllQueuesStatus() {
    const { data: queues } = await supabase
      .from('queues')
      .select('*')
      .order('type');

    const result: any[] = [];
    for (const q of queues || []) {
      const { data: entries } = await supabase
        .from('queue_entries')
        .select('*, users(name, vehicle_plate)')
        .eq('queue_id', (q as any).id)
        .eq('status', 'waiting')
        .order('position', { ascending: true });

      result.push({
        ...q as any,
        entries: entries || [],
        length: entries?.length || 0,
      });
    }

    return result;
  }
}
