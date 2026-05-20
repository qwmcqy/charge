import { supabase } from '@/lib/supabase';
import type {
  AdminProfile, StationData, OrderData, QueueEntryData,
  ParkingFeeOrderData, FaultData, BillData, SystemConfig,
  OperationReport, DateRange, LogFilter, SystemLog, StationInput,
} from '@/lib/types';

export class Administrator {
  id: string;
  userId: string;
  name: string;
  role: 'super' | 'operator' | 'maintenance';
  permissions: string[];

  constructor(profile: AdminProfile, name: string) {
    this.id = profile.id;
    this.userId = profile.userId;
    this.name = name;
    this.role = profile.adminRole;
    this.permissions = profile.permissions;
  }

  // UM01 实时设备监控
  async monitorStations(): Promise<StationData[]> {
    const { data, error } = await supabase
      .from('charging_stations')
      .select('*')
      .order('station_number');

    if (error) throw new Error(`获取充电桩列表失败: ${error.message}`);
    return data as StationData[];
  }

  async getStationRealtimeData(stationId: string) {
    const { data, error } = await supabase
      .from('charging_stations')
      .select('*')
      .eq('id', stationId)
      .single();

    if (error) throw new Error(`获取充电桩数据失败: ${error.message}`);
    return {
      stationId: data.id,
      voltage: data.current_voltage,
      current: data.current_current,
      power: data.current_power,
      energy: data.cumulative_energy,
      temperature: data.temperature,
      status: data.status,
      timestamp: new Date().toISOString(),
    };
  }

  // UM02 充电请求审核
  async getPendingRequests(): Promise<OrderData[]> {
    const { data, error } = await supabase
      .from('charging_orders')
      .select('*, users!inner(name, vehicle_plate)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`获取待审核请求失败: ${error.message}`);
    return data as any;
  }

  async auditRequest(orderId: string, approved: boolean, reason?: string): Promise<void> {
    if (approved) {
      const { data: order } = await supabase
        .from('charging_orders')
        .select('*')
        .eq('id', orderId)
        .single();
      if (!order) throw new Error('订单不存在');

      const queueType = order.mode === 'fast' ? 'fast' : 'slow';
      const { data: queue } = await supabase
        .from('queues')
        .select('*')
        .eq('type', queueType)
        .single();
      if (!queue) throw new Error('队列不存在');

      const { count } = await supabase
        .from('queue_entries')
        .select('*', { count: 'exact', head: true })
        .eq('queue_id', queue.id)
        .eq('status', 'waiting');
      const nextPosition = (count || 0) + 1;

      const avgMinutes = queueType === 'fast' ? 40 : 180;
      const estimatedWait = nextPosition * avgMinutes;

      const { data: entry, error: entryError } = await supabase
        .from('queue_entries')
        .insert({
          user_id: order.user_id,
          order_id: orderId,
          queue_id: queue.id,
          position: nextPosition,
          mode: order.mode,
          battery_level: order.request_battery_level,
          estimated_wait_minutes: estimatedWait,
          status: 'waiting',
        })
        .select()
        .single();

      if (entryError) throw new Error(`创建队列条目失败: ${entryError.message}`);

      await supabase
        .from('charging_orders')
        .update({ status: 'queued', queue_entry_id: (entry as any).id })
        .eq('id', orderId);

      // 发送通知
      await supabase.from('notifications').insert({
        user_id: order.user_id,
        type: 'system',
        title: '充电请求已通过审核',
        content: `您的${order.mode === 'fast' ? '快充' : '慢充'}请求已通过审核，当前排队位置: ${nextPosition}，预计等待: ${estimatedWait}分钟`,
        related_id: orderId,
      });
    } else {
      await supabase
        .from('charging_orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId);

      await supabase.from('notifications').insert({
        user_id: (await supabase.from('charging_orders').select('user_id').eq('id', orderId).single()).data?.user_id,
        type: 'system',
        title: '充电请求未通过审核',
        content: reason || '您的充电请求未通过审核，请联系管理员',
        related_id: orderId,
      });
    }
  }

  // UM03 队列秩序管理
  async getQueueStatus(queueType: 'fast' | 'slow' | 'waiting') {
    const { data: queue } = await supabase
      .from('queues')
      .select('*')
      .eq('type', queueType)
      .single();
    if (!queue) throw new Error('队列不存在');

    const { data: entries, error } = await supabase
      .from('queue_entries')
      .select('*, users(name, vehicle_plate)')
      .eq('queue_id', queue.id)
      .eq('status', 'waiting')
      .order('position', { ascending: true });

    if (error) throw new Error(`获取队列状态失败: ${error.message}`);
    return entries;
  }

  async reorderQueue(_queueId: string, entryId: string, newPosition: number): Promise<void> {
    await supabase
      .from('queue_entries')
      .update({ position: newPosition })
      .eq('id', entryId);
  }

  async removeFromQueue(entryId: string): Promise<void> {
    const { data: entry } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('id', entryId)
      .single();
    if (!entry) throw new Error('队列条目不存在');

    await supabase.from('queue_entries').update({ status: 'cancelled' }).eq('id', entryId);
    await supabase.from('charging_orders').update({ status: 'cancelled' }).eq('id', (entry as any).order_id);

    await supabase.from('notifications').insert({
      user_id: (entry as any).user_id,
      type: 'system',
      title: '排队已取消',
      content: '您的充电排队已被管理员取消',
    });
  }

  async prioritizeEntry(entryId: string): Promise<void> {
    const { data: entry } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('id', entryId)
      .single();
    if (!entry) throw new Error('队列条目不存在');

    await supabase.from('queue_entries').update({ position: 1 }).eq('id', entryId);

    await supabase.from('notifications').insert({
      user_id: (entry as any).user_id,
      type: 'queue_ready',
      title: '排队优先级已提升',
      content: '您的充电排队已被管理员提升为优先处理',
    });
  }

  // UM04 故障处理
  async getFaults(status?: 'open' | 'resolved'): Promise<FaultData[]> {
    let query = supabase.from('faults').select('*, charging_stations(station_number)').order('detected_at', { ascending: false });
    if (status === 'open') query = query.is('resolved_at', null);
    else if (status === 'resolved') query = query.not('resolved_at', 'is', null);

    const { data, error } = await query;
    if (error) throw new Error(`获取故障列表失败: ${error.message}`);
    return data as any;
  }

  async handleFault(faultId: string, resolution: string): Promise<void> {
    await supabase
      .from('faults')
      .update({ handler_id: this.userId, resolution, resolved_at: new Date().toISOString() })
      .eq('id', faultId);
  }

  async resolveFault(faultId: string): Promise<void> {
    const { data: fault } = await supabase.from('faults').select('*').eq('id', faultId).single();
    if (!fault) throw new Error('故障不存在');

    await supabase
      .from('faults')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', faultId);

    // 恢复充电桩状态
    await supabase
      .from('charging_stations')
      .update({ status: 'available', current_order_id: null })
      .eq('id', (fault as any).station_id);
  }

  // UM05 超时车辆管理
  async getOvertimeVehicles(): Promise<ParkingFeeOrderData[]> {
    const { data, error } = await supabase
      .from('parking_fee_orders')
      .select('*, users(name, vehicle_plate), charging_stations(station_number)')
      .eq('status', 'parked')
      .order('charge_complete_time', { ascending: true });

    if (error) throw new Error(`获取超时车辆失败: ${error.message}`);
    return data as any;
  }

  async notifyOvertimeVehicle(orderId: string): Promise<void> {
    const { data: order } = await supabase
      .from('parking_fee_orders')
      .select('*')
      .eq('id', orderId)
      .single();
    if (!order) throw new Error('停车费订单不存在');

    const overtimeMinutes = Math.floor(
      (Date.now() - new Date((order as any).charge_complete_time).getTime()) / 60000
    ) - ((order as any).grace_period_minutes || 15);

    await supabase.from('notifications').insert({
      user_id: (order as any).user_id,
      type: 'overtime_warning',
      title: '超时停车提醒',
      content: `您的车辆已充电完成并超时停放 ${Math.max(0, overtimeMinutes)} 分钟，请尽快驶离。超时停车费: ¥${(order as any).parking_fee}`,
      related_id: orderId,
    });
  }

  // UM06 费用核算与账单
  async verifyBill(billId: string): Promise<void> {
    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) throw new Error('账单不存在');

    const { data: order } = await supabase
      .from('charging_orders')
      .select('*')
      .eq('id', (bill as any).charging_order_id)
      .single();

    if (order) {
      const config = await this.getSystemConfig();
      const rate = order.mode === 'fast' ? config.fastChargeRate : config.slowChargeRate;
      const expectedFee = order.energy_consumed * rate;

      await supabase.from('bills').update({
        charging_fee: expectedFee,
        total_amount: expectedFee + ((bill as any).parking_fee || 0),
      }).eq('id', billId);
    }
  }

  async generateBillForOrder(orderId: string): Promise<BillData> {
    const { data: order, error } = await supabase
      .from('charging_orders')
      .select('*')
      .eq('id', orderId)
      .single();
    if (error || !order) throw new Error('订单不存在');

    const config = await this.getSystemConfig();
    const rate = order.mode === 'fast' ? config.fastChargeRate : config.slowChargeRate;
    const chargingFee = Math.round(order.energy_consumed * rate * 100) / 100;

    // 检查是否有停车费
    const { data: parkingOrder } = await supabase
      .from('parking_fee_orders')
      .select('*')
      .eq('charging_order_id', orderId)
      .maybeSingle();

    const parkingFee = parkingOrder ? (parkingOrder as any).parking_fee : 0;
    const totalAmount = chargingFee + parkingFee;

    const { data: bill, error: billError } = await supabase
      .from('bills')
      .insert({
        user_id: order.user_id,
        charging_order_id: orderId,
        parking_fee_order_id: parkingOrder ? (parkingOrder as any).id : null,
        charging_fee: chargingFee,
        parking_fee: parkingFee,
        total_amount: totalAmount,
        status: 'unpaid',
      })
      .select()
      .single();

    if (billError) throw new Error(`生成账单失败: ${billError.message}`);

    await supabase.from('notifications').insert({
      user_id: order.user_id,
      type: 'bill_generated',
      title: '充电账单已生成',
      content: `您的充电账单已生成，合计: ¥${totalAmount}（充电费: ¥${chargingFee}，停车费: ¥${parkingFee}）`,
      related_id: (bill as any).id,
    });

    return bill as BillData;
  }

  // UM07 运营数据记录
  async getOperationReport(startDate: Date, endDate: Date): Promise<OperationReport> {
    const range = { start: startDate.toISOString(), end: endDate.toISOString() };

    const [
      { count: totalOrders },
      { data: orders },
      { count: faultCount },
    ] = await Promise.all([
      supabase.from('charging_orders').select('*', { count: 'exact', head: true })
        .gte('created_at', range.start).lte('created_at', range.end),
      supabase.from('charging_orders').select('energy_consumed, charging_fee, mode, created_at')
        .gte('created_at', range.start).lte('created_at', range.end),
      supabase.from('faults').select('*', { count: 'exact', head: true })
        .gte('detected_at', range.start).lte('detected_at', range.end),
    ]);

    const totalEnergy = (orders as any[])?.reduce((sum: number, o: any) => sum + (o.energy_consumed || 0), 0) || 0;
    const totalChargingFee = (orders as any[])?.reduce((sum: number, o: any) => sum + (o.charging_fee || 0), 0) || 0;

    const { data: parkingOrders } = await supabase
      .from('parking_fee_orders')
      .select('parking_fee')
      .gte('created_at', range.start).lte('created_at', range.end);
    const totalParkingFee = (parkingOrders as any[])?.reduce((sum: number, o: any) => sum + (o.parking_fee || 0), 0) || 0;

    const hourlyDistribution: Record<number, number> = {};
    (orders as any[])?.forEach((o: any) => {
      const hour = new Date(o.created_at).getHours();
      hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
    });

    return {
      totalOrders: totalOrders || 0,
      totalEnergy: Math.round(totalEnergy * 100) / 100,
      totalChargingFee: Math.round(totalChargingFee * 100) / 100,
      totalParkingFee: Math.round(totalParkingFee * 100) / 100,
      totalRevenue: Math.round((totalChargingFee + totalParkingFee) * 100) / 100,
      faultCount: faultCount || 0,
      avgWaitMinutes: 0,
      stationUtilization: {},
      hourlyDistribution,
      dateRange: { start: range.start, end: range.end },
    };
  }

  async exportReport(format: 'csv' | 'pdf', dateRange: DateRange): Promise<string> {
    const report = await this.getOperationReport(dateRange.start, dateRange.end);
    if (format === 'csv') {
      const headers = '指标,数值\n';
      const rows = [
        `总订单数,${report.totalOrders}`,
        `总充电量(kWh),${report.totalEnergy}`,
        `充电费总收入(元),${report.totalChargingFee}`,
        `停车费总收入(元),${report.totalParkingFee}`,
        `总收入(元),${report.totalRevenue}`,
        `故障次数,${report.faultCount}`,
      ].join('\n');
      return headers + rows;
    }
    return JSON.stringify(report, null, 2);
  }

  // UM08 系统参数配置
  async getSystemConfig(): Promise<SystemConfig> {
    const defaults: SystemConfig = {
      fastChargeRate: 1.2,
      slowChargeRate: 0.8,
      parkingRatePerMinute: 0.1,
      parkingGracePeriodMinutes: 15,
      fastQueueMaxSize: 20,
      slowQueueMaxSize: 30,
      waitingQueueMaxSize: 50,
      avgFastChargeMinutes: 40,
      avgSlowChargeMinutes: 180,
      overtimeThresholdMinutes: 30,
      autoAuditEnabled: true,
    };

    const { data, error } = await supabase.from('system_configs').select('*');
    if (error || !data) return defaults;

    const config: any = { ...defaults };
    for (const row of data) {
      const key = row.key as string;
      if (key in config) {
        config[key] = (row.value as any).v;
      }
    }
    return config;
  }

  async updateSystemConfig(config: Partial<SystemConfig>): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      await supabase
        .from('system_configs')
        .upsert({
          key,
          value: { v: value },
          updated_by: this.userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
    }
  }

  // UM09 充电桩信息管理
  async addStation(data: StationInput) {
    const { data: station, error } = await supabase
      .from('charging_stations')
      .insert({
        station_number: data.stationNumber,
        mode: data.mode,
        location: data.location,
        max_power: data.maxPower,
      })
      .select()
      .single();

    if (error) throw new Error(`添加充电桩失败: ${error.message}`);

    await supabase.from('station_logs').insert({
      station_id: (station as any).id,
      event_type: 'station_added',
      data: { station: station as any, admin_id: this.userId },
    });

    return station;
  }

  async updateStation(stationId: string, data: Partial<StationInput>): Promise<void> {
    const updateData: any = {};
    if (data.stationNumber) updateData.station_number = data.stationNumber;
    if (data.mode) updateData.mode = data.mode;
    if (data.location) updateData.location = data.location;
    if (data.maxPower) updateData.max_power = data.maxPower;

    const { error } = await supabase
      .from('charging_stations')
      .update(updateData)
      .eq('id', stationId);

    if (error) throw new Error(`更新充电桩失败: ${error.message}`);
  }

  async removeStation(stationId: string): Promise<void> {
    const { error } = await supabase
      .from('charging_stations')
      .update({ status: 'offline' })
      .eq('id', stationId);

    if (error) throw new Error(`移除充电桩失败: ${error.message}`);

    await supabase.from('station_logs').insert({
      station_id: stationId,
      event_type: 'station_removed',
      data: { admin_id: this.userId },
    });
  }

  // UM10 系统数据维护
  async archiveData(beforeDate: Date): Promise<void> {
    const cutoff = beforeDate.toISOString();
    await supabase.from('station_logs').delete().lt('created_at', cutoff);
    await supabase.from('notifications').delete().lt('created_at', cutoff).eq('read', true);
  }

  async backupDatabase(): Promise<void> {
    await supabase.from('station_logs').insert({
      event_type: 'backup_initiated',
      data: { admin_id: this.userId, timestamp: new Date().toISOString() },
    });
  }

  async getSystemLogs(filter: LogFilter): Promise<SystemLog[]> {
    let query = supabase.from('station_logs').select('*').order('created_at', { ascending: false }).limit(100);

    if (filter.stationId) query = query.eq('station_id', filter.stationId);
    if (filter.eventType) query = query.eq('event_type', filter.eventType);
    if (filter.startDate) query = query.gte('created_at', filter.startDate.toISOString());
    if (filter.endDate) query = query.lte('created_at', filter.endDate.toISOString());

    const { data, error } = await query;
    if (error) throw new Error(`获取系统日志失败: ${error.message}`);
    return data as SystemLog[];
  }

  // 静态工厂方法
  static async fetchByUserId(userId: string): Promise<Administrator> {
    const { data: admin, error } = await supabase
      .from('administrators')
      .select('*, users!inner(name)')
      .eq('user_id', userId)
      .single();

    if (error || !admin) throw new Error('管理员不存在');
    return new Administrator(
      { id: (admin as any).id, userId: admin.user_id, adminRole: admin.admin_role, permissions: admin.permissions },
      (admin as any).users?.name || '管理员'
    );
  }
}
