import { supabase } from '@/lib/supabase';
import { Fault } from '@/models/Fault';
import { OrderStatus } from '@/lib/types';
import { calculateTimeOfUseFee } from '@/lib/billing';

export class FaultService {
  /**
   * 获取所有故障
   */
  static async getAllFaults(status?: 'open' | 'resolved') {
    let query = supabase
      .from('faults')
      .select('*, charging_stations(station_number, location)')
      .order('detected_at', { ascending: false });

    if (status === 'open') {
      query = query.is('resolved_at', null);
    } else if (status === 'resolved') {
      query = query.not('resolved_at', 'is', null);
    }

    const { data, error } = await query;
    if (error) throw new Error(`获取故障列表失败: ${error.message}`);
    return data;
  }

  /**
   * 获取单个故障详情
   */
  static async getFaultDetail(faultId: string) {
    const fault = await Fault.fetchById(faultId);
    return fault;
  }

  /**
   * 管理员处理故障
   */
  static async handleFault(faultId: string, adminId: string, resolution: string) {
    const fault = await Fault.fetchById(faultId);
    await fault.handle(adminId, resolution);
    await fault.resolve();
    return fault;
  }

  /**
   * 管理员解决故障
   */
  static async resolveFault(faultId: string) {
    const fault = await Fault.fetchById(faultId);
    await fault.resolve();
    return fault;
  }

  /**
   * 自动故障检测（对所有充电中的充电桩）
   */
  static async autoDetectFaults() {
    const { data: chargingStations } = await supabase
      .from('charging_stations')
      .select('*')
      .eq('status', 'charging');

    const faults: Fault[] = [];
    for (const stationData of chargingStations || []) {
      const { ChargingStation } = await import('@/models/ChargingStation');
      const station = new ChargingStation(stationData as any);
      const fault = station.detectFault();

      if (fault) {
        fault.affectedOrderId = (stationData as any).current_order_id;
        const { ChargingOrder } = await import('@/models/ChargingOrder');
        const order = fault.affectedOrderId
          ? await ChargingOrder.fetchById(fault.affectedOrderId)
          : null;
        if (order) {
          order.chargingFee = calculateTimeOfUseFee(
            order.startTime || new Date(),
            order.energyConsumed,
            order.mode
          ).totalFee;
        }

        await fault.report();
        if (order) {
          await order.endCharging(OrderStatus.FaultStopped);
          const { Bill } = await import('@/models/Bill');
          const { QueueService } = await import('@/services/QueueService');
          await Bill.generate(order.userId, order.id);
          await QueueService.dispatchNext(order.mode);
        }
        faults.push(fault);
      }
    }

    return faults;
  }

  /**
   * 获取故障统计
   */
  static async getFaultStats() {
    const { count: totalFaults } = await supabase
      .from('faults')
      .select('*', { count: 'exact', head: true });

    const { count: openFaults } = await supabase
      .from('faults')
      .select('*', { count: 'exact', head: true })
      .is('resolved_at', null);

    const { count: criticalFaults } = await supabase
      .from('faults')
      .select('*', { count: 'exact', head: true })
      .is('resolved_at', null)
      .eq('severity', 'critical');

    return {
      totalFaults: totalFaults || 0,
      openFaults: openFaults || 0,
      criticalFaults: criticalFaults || 0,
    };
  }
}
