import { supabase } from '@/lib/supabase';
import { ChargingStation } from '@/models/ChargingStation';

export class MonitorService {
  /**
   * 获取所有充电桩实时数据 (UM01)
   */
  static async getAllStations() {
    const stations = await ChargingStation.fetchAll();
    return stations.map(s => s.getRealtimeData());
  }

  /**
   * 获取单个充电桩实时数据
   */
  static async getStationRealtime(stationId: string) {
    const station = await ChargingStation.fetchById(stationId);
    return station.getRealtimeData();
  }

  /**
   * 获取管理端仪表盘概览数据
   */
  static async getDashboardOverview() {
    const [
      { count: totalStations },
      { count: availableStations },
      { count: chargingStations },
      { count: faultStations },
      { data: stations },
    ] = await Promise.all([
      supabase.from('charging_stations').select('*', { count: 'exact', head: true }),
      supabase.from('charging_stations').select('*', { count: 'exact', head: true }).eq('status', 'available'),
      supabase.from('charging_stations').select('*', { count: 'exact', head: true }).eq('status', 'charging'),
      supabase.from('charging_stations').select('*', { count: 'exact', head: true }).eq('status', 'fault'),
      supabase.from('charging_stations').select('*').order('station_number'),
    ]);

    const totalPower = stations?.reduce((sum, s) => sum + ((s as any).current_power || 0), 0) || 0;
    const totalEnergy = stations?.reduce((sum, s) => sum + ((s as any).cumulative_energy || 0), 0) || 0;

    return {
      totalStations: totalStations || 0,
      availableStations: availableStations || 0,
      chargingStations: chargingStations || 0,
      faultStations: faultStations || 0,
      offlineStations: (totalStations || 0) - (availableStations || 0) - (chargingStations || 0) - (faultStations || 0),
      totalPower: Math.round(totalPower * 100) / 100,
      totalEnergy: Math.round(totalEnergy * 100) / 100,
      stations: stations || [],
    };
  }

  /**
   * 获取实时充电中的订单数据
   */
  static async getActiveChargingOrders() {
    const { data, error } = await supabase
      .from('charging_orders')
      .select('*, users(name, vehicle_plate), charging_stations(station_number, location)')
      .eq('status', 'charging')
      .order('start_time', { ascending: true });

    if (error) throw new Error(`获取活跃充电订单失败: ${error.message}`);
    return data;
  }

  /**
   * 启动充电桩状态变更订阅（Supabase Realtime）
   * 返回取消订阅的函数
   */
  static subscribeToStationUpdates(onUpdate: (payload: any) => void) {
    const channel = supabase
      .channel('station-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'charging_stations' },
        (payload) => onUpdate(payload)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  /**
   * 记录充电桩事件日志
   */
  static async logStationEvent(stationId: string, eventType: string, data: Record<string, unknown> = {}) {
    await supabase.from('station_logs').insert({
      station_id: stationId,
      event_type: eventType,
      data,
    });
  }
}
