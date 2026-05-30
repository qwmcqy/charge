import { supabase } from '@/lib/supabase';
import { ChargingOrder } from '@/models/ChargingOrder';
import { ChargeMode, OrderStatus, QueueType } from '@/lib/types';
import { Notification, NotificationType } from '@/models/Notification';
import { estimateChargeMinutes } from '@/lib/billing';

type StationRow = {
  id: string;
  station_number: string;
  mode: ChargeMode;
  status: string;
  max_power: number;
};

type OrderRow = {
  id: string;
  user_id: string;
  station_id: string | null;
  queue_entry_id: string | null;
  mode: ChargeMode;
  status: string;
  request_battery_level: number;
  target_battery_level: number;
  energy_consumed: number;
  charging_fee: number;
  start_time?: string;
  end_time?: string;
  created_at: string;
};

export class QueueService {
  private static dispatchInFlight: Partial<Record<'fast' | 'slow', Promise<unknown>>> = {};

  static async tryChargeOrQueue(order: ChargingOrder) {
    const assignment = await QueueService.findBestStation(order.mode, order.targetBatteryLevel);
    if (assignment) {
      return QueueService.assignOrderToStationQueue(order, assignment.station, assignment.ordersAhead);
    }
    return QueueService.addToWaitingArea(order);
  }

  static async findBestStation(mode: ChargeMode, requestedKwh: number) {
    const { data: queue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', mode === ChargeMode.Fast ? QueueType.Fast : QueueType.Slow)
      .single();
    if (!queue) throw new Error('充电队列不存在');

    const { data: stations, error } = await supabase
      .from('charging_stations')
      .select('*')
      .eq('mode', mode)
      .neq('status', 'fault')
      .neq('status', 'offline')
      .order('station_number', { ascending: true });
    if (error) throw new Error(`获取充电桩失败: ${error.message}`);

    let best: { station: StationRow; ordersAhead: OrderRow[]; completionMinutes: number } | null = null;

    for (const station of (stations || []) as StationRow[]) {
      const ordersAhead = await QueueService.getStationActiveOrders(station.id);
      if (ordersAhead.length >= (queue as any).max_size) continue;

      const waitMinutes = QueueService.sumRemainingMinutes(ordersAhead, Number(station.max_power));
      const completionMinutes = waitMinutes + estimateChargeMinutes(mode, requestedKwh);
      if (!best || completionMinutes < best.completionMinutes) {
        best = { station, ordersAhead, completionMinutes };
      }
    }

    return best;
  }

  static async getStationActiveOrders(stationId: string): Promise<OrderRow[]> {
    const { data, error } = await supabase
      .from('charging_orders')
      .select('*')
      .eq('station_id', stationId)
      .in('status', ['assigned', 'charging', 'queued'])
      .order('created_at', { ascending: true });
    if (error) throw new Error(`获取充电桩队列失败: ${error.message}`);

    const orders = ((data || []) as OrderRow[]).filter(order =>
      ['assigned', 'charging', 'queued'].includes(order.status)
    );
    return orders.sort((a, b) => {
      const rank = (status: string) => status === 'charging' ? 0 : status === 'assigned' ? 1 : 2;
      return rank(a.status) - rank(b.status) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }

  static sumRemainingMinutes(orders: OrderRow[], power: number): number {
    return orders.reduce((sum, order) => {
      const remaining = Math.max(0, Number(order.target_battery_level || 0) - Number(order.energy_consumed || 0));
      return sum + (remaining / power) * 60;
    }, 0);
  }

  static async assignOrderToStationQueue(order: ChargingOrder, station: StationRow, ordersAhead: OrderRow[]) {
    if (ordersAhead.length === 0 && station.status === 'available') {
      const { ChargingService } = await import('./ChargingService');
      const result = await ChargingService.assignAndStartCharging(order.id, station.id);
      return { directCharge: true, ...result };
    }

    const queueType = order.mode === ChargeMode.Fast ? QueueType.Fast : QueueType.Slow;
    const { data: queue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', queueType)
      .single();
    if (!queue) throw new Error('充电队列不存在');

    const position = ordersAhead.length + 1;
    const estimatedWaitMinutes = Math.round(QueueService.sumRemainingMinutes(ordersAhead, Number(station.max_power)));
    const { data: entry, error } = await supabase
      .from('queue_entries')
      .insert({
        user_id: order.userId,
        order_id: order.id,
        queue_id: (queue as any).id,
        position,
        mode: order.mode,
        battery_level: 0,
        estimated_wait_minutes: estimatedWaitMinutes,
        status: 'waiting',
      })
      .select()
      .single();
    if (error) throw new Error(`创建队列条目失败: ${error.message}`);

    await supabase
      .from('charging_orders')
      .update({ status: 'queued', station_id: station.id, queue_entry_id: (entry as any).id })
      .eq('id', order.id);

    order.status = OrderStatus.Queued;
    order.stationId = station.id;
    order.queueEntryId = (entry as any).id;

    await Notification.send(
      order.userId,
      NotificationType.System,
      '已加入充电桩队列',
      `已分配到${station.station_number}队列，当前队列位置 ${position}，预计等待 ${estimatedWaitMinutes} 分钟`,
      order.id
    );

    return { queued: true, entry, station, position, estimatedWaitMinutes, isOverflow: false };
  }

  static async addToWaitingArea(order: ChargingOrder) {
    const { data: waitingQueue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', QueueType.Waiting)
      .single();
    if (!waitingQueue) throw new Error('等候区队列不存在');

    const { count } = await supabase
      .from('queue_entries')
      .select('*', { count: 'exact', head: true })
      .eq('queue_id', (waitingQueue as any).id)
      .eq('status', 'waiting');
    if ((count || 0) >= (waitingQueue as any).max_size) throw new Error('等候区已满');

    const position = (count || 0) + 1;
    const { data: entry, error } = await supabase
      .from('queue_entries')
      .insert({
        user_id: order.userId,
        order_id: order.id,
        queue_id: (waitingQueue as any).id,
        position,
        mode: order.mode,
        battery_level: 0,
        estimated_wait_minutes: 0,
        status: 'waiting',
      })
      .select()
      .single();
    if (error) throw new Error(`创建等候区条目失败: ${error.message}`);

    await supabase
      .from('charging_orders')
      .update({ status: 'queued', queue_entry_id: (entry as any).id, station_id: null })
      .eq('id', order.id);

    await Notification.send(
      order.userId,
      NotificationType.System,
      '已进入等候区',
      `当前同类型充电桩队列已满，您已进入等候区位置 ${position}`,
      order.id
    );

    return { queued: true, entry, isOverflow: true, position, estimatedWaitMinutes: 0 };
  }

  static async getUserQueueStatus(userId: string) {
    const { data: entry } = await supabase
      .from('queue_entries')
      .select('*, queues(type), charging_orders(station_id, charging_stations(station_number))')
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

  static async dispatchNext(queueType: 'fast' | 'slow') {
    const currentDispatch = QueueService.dispatchInFlight[queueType];
    if (currentDispatch) {
      return currentDispatch;
    }

    const dispatch = QueueService.dispatchNextUnlocked(queueType);
    QueueService.dispatchInFlight[queueType] = dispatch;

    try {
      return await dispatch;
    } finally {
      delete QueueService.dispatchInFlight[queueType];
    }
  }

  private static async dispatchNextUnlocked(queueType: 'fast' | 'slow') {
    const { data: stations } = await supabase
      .from('charging_stations')
      .select('*')
      .eq('mode', queueType)
      .eq('status', 'available')
      .order('station_number', { ascending: true });

    let result = null;
    for (const station of (stations || []) as StationRow[]) {
      const queued = await QueueService.getStationQueuedOrders(station.id);
      if (queued.length > 0) {
        const { ChargingService } = await import('./ChargingService');
        result = await ChargingService.assignAndStartCharging(queued[0].id, station.id);
      }
    }

    while (true) {
      const promoted = await QueueService.promoteFromWaiting(queueType);
      if (!promoted) break;
      result = promoted;
    }

    return result;
  }

  static async getStationQueuedOrders(stationId: string): Promise<OrderRow[]> {
    const { data, error } = await supabase
      .from('charging_orders')
      .select('*')
      .eq('station_id', stationId)
      .eq('status', 'queued')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`获取待充电队列失败: ${error.message}`);
    return (data || []) as OrderRow[];
  }

  static async promoteFromWaiting(queueType: 'fast' | 'slow') {
    const { data: waitingQueue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', 'waiting')
      .single();
    if (!waitingQueue) return null;

    const { data: entries } = await supabase
      .from('queue_entries')
      .select('*, charging_orders(*)')
      .eq('queue_id', (waitingQueue as any).id)
      .eq('status', 'waiting')
      .eq('mode', queueType)
      .order('position', { ascending: true })
      .limit(1);
    if (!entries || entries.length === 0) return null;

    const entry = entries[0] as any;
    const order = new ChargingOrder(entry.charging_orders);
    const assignment = await QueueService.findBestStation(order.mode, order.targetBatteryLevel);
    if (!assignment) return null;

    await supabase.from('queue_entries').update({ status: 'cancelled' }).eq('id', entry.id);
    await supabase
      .from('charging_orders')
      .update({ queue_entry_id: null })
      .eq('id', order.id);
    order.queueEntryId = undefined;

    try {
      return await QueueService.assignOrderToStationQueue(order, assignment.station, assignment.ordersAhead);
    } catch (error) {
      await supabase.from('queue_entries').update({ status: 'waiting' }).eq('id', entry.id);
      await supabase
        .from('charging_orders')
        .update({ queue_entry_id: entry.id, station_id: null, status: 'queued' })
        .eq('id', order.id);
      throw error;
    }
  }

  static async getAllQueuesStatus() {
    const { data: queues } = await supabase
      .from('queues')
      .select('*')
      .order('type');

    const result: any[] = [];
    for (const q of queues || []) {
      const { data: entries } = await supabase
        .from('queue_entries')
        .select('*, users(name, vehicle_plate), charging_orders(station_id, charging_stations(station_number))')
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

  static async rescheduleStationQueue(faultStationId: string, mode: ChargeMode) {
    const affectedOrders = await QueueService.getStationQueuedOrders(faultStationId);
    const entryIds = affectedOrders
      .map(order => order.queue_entry_id)
      .filter((id): id is string => !!id);

    if (entryIds.length > 0) {
      await supabase
        .from('queue_entries')
        .update({ status: 'cancelled' })
        .in('id', entryIds);
    }

    await supabase
      .from('charging_orders')
      .update({ station_id: null, queue_entry_id: null })
      .eq('station_id', faultStationId)
      .eq('status', 'queued');

    for (const orderRow of affectedOrders) {
      const order = new ChargingOrder({ ...orderRow, station_id: undefined, queue_entry_id: undefined });
      const assignment = await QueueService.findBestStation(mode, order.targetBatteryLevel);
      if (assignment) {
        await QueueService.assignOrderToStationQueue(order, assignment.station, assignment.ordersAhead);
      } else {
        await QueueService.addToWaitingArea(order);
      }
    }
  }

  static async rebalanceStationQueues(mode: ChargeMode) {
    const { data: stations } = await supabase
      .from('charging_stations')
      .select('id')
      .eq('mode', mode)
      .neq('status', 'fault')
      .neq('status', 'offline');
    const stationIds = (stations || []).map(station => station.id);
    if (stationIds.length === 0) return;

    const { data: queuedOrders } = await supabase
      .from('charging_orders')
      .select('*')
      .in('station_id', stationIds)
      .eq('status', 'queued')
      .order('created_at', { ascending: true });

    const orders = (queuedOrders || []) as OrderRow[];
    const entryIds = orders
      .map(order => order.queue_entry_id)
      .filter((id): id is string => !!id);

    if (entryIds.length > 0) {
      await supabase
        .from('queue_entries')
        .update({ status: 'cancelled' })
        .in('id', entryIds);
    }

    if (orders.length > 0) {
      await supabase
        .from('charging_orders')
        .update({ station_id: null, queue_entry_id: null })
        .in('id', orders.map(order => order.id));
    }

    for (const orderRow of orders) {
      const order = new ChargingOrder({ ...orderRow, station_id: undefined, queue_entry_id: undefined });
      const assignment = await QueueService.findBestStation(mode, order.targetBatteryLevel);
      if (assignment) {
        await QueueService.assignOrderToStationQueue(order, assignment.station, assignment.ordersAhead);
      } else {
        await QueueService.addToWaitingArea(order);
      }
    }

    await QueueService.dispatchNext(mode);
  }
}
