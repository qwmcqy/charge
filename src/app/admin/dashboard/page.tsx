'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase';

interface StationRow {
  id: string;
  station_number: string;
  mode: string;
  status: string;
  location: string;
  max_power: number;
  current_voltage: number;
  current_current: number;
  current_power: number;
  temperature: number;
  current_order_id?: string;
}

interface ChargingOrderInfo {
  id: string;
  user_name: string;
  energy_consumed: number;
  request_battery_level: number;
  target_battery_level: number;
}

export default function AdminDashboard() {
  const [stations, setStations] = useState<StationRow[]>([]);
  const [activeOrders, setActiveOrders] = useState<Map<string, ChargingOrderInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const isSimulatingRef = useRef(false);

  const loadStations = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('charging_stations')
        .select('*')
        .order('station_number');

      if (error) throw error;
      if (data) {
        setStations(data as StationRow[]);

        // Fetch active orders for stations that are charging
        const chargingStationIds = (data as StationRow[])
          .filter(s => s.status === 'charging' && s.current_order_id)
          .map(s => s.current_order_id);

        if (chargingStationIds.length > 0) {
          const { data: orders } = await supabase
            .from('charging_orders')
            .select('id, user_id, energy_consumed, request_battery_level, target_battery_level, users(name)')
            .in('id', chargingStationIds);

          if (orders) {
            const map = new Map<string, ChargingOrderInfo>();
            for (const o of orders) {
              map.set(o.id, {
                id: o.id,
                user_name: (o as any).users?.name || '未知',
                energy_consumed: o.energy_consumed || 0,
                request_battery_level: o.request_battery_level || 0,
                target_battery_level: o.target_battery_level || 0,
              });
            }
            setActiveOrders(map);
          }
        }
      }
    } catch {
      // Supabase unavailable — keep current data
    } finally {
      setLoading(false);
    }
  }, []);

  // Run simulation tick for all active orders
  const runSimulation = useCallback(async () => {
    if (isSimulatingRef.current) return;
    isSimulatingRef.current = true;
    try {
      await fetch('/api/charging/simulate', { method: 'POST' });
    } catch {
      // Simulation unavailable — skip
    } finally {
      isSimulatingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void loadStations();
    const interval = setInterval(async () => {
      await runSimulation();
      await loadStations();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadStations, runSimulation]);

  const stats = {
    total: stations.length,
    available: stations.filter(s => s.status === 'available').length,
    charging: stations.filter(s => s.status === 'charging').length,
    fault: stations.filter(s => s.status === 'fault').length,
    offline: stations.filter(s => s.status === 'offline').length,
    totalPower: stations.reduce((sum, s) => sum + (s.current_power || 0), 0),
  };

  const statusColors: Record<string, string> = {
    available: 'border-green-300 bg-green-50',
    charging: 'border-yellow-300 bg-yellow-50',
    fault: 'border-red-300 bg-red-50',
    offline: 'border-gray-300 bg-gray-50',
    reserved: 'border-blue-300 bg-blue-50',
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">实时设备监控 (UM01)</h2>
      <p className="text-xs text-gray-400 mb-6">
        数据来源: Supabase · 每5秒自动刷新 · {stations.length} 个充电桩{loading ? ' · 加载中...' : ''}
      </p>

      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: '总数', value: stats.total, color: 'text-blue-600' },
          { label: '可用', value: stats.available, color: 'text-green-600' },
          { label: '充电中', value: stats.charging, color: 'text-yellow-600' },
          { label: '故障', value: stats.fault, color: 'text-red-600' },
          { label: '总功率', value: `${stats.totalPower.toFixed(1)} kW`, color: 'text-purple-600' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl shadow p-4">
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="font-semibold">充电桩实时状态</h3>
          <button onClick={loadStations} className="text-xs text-blue-600 hover:text-blue-800">刷新</button>
        </div>
        {stations.length === 0 ? (
          <div className="p-8 text-center text-gray-400">暂无充电桩数据</div>
        ) : (
          <div className="grid grid-cols-4 gap-4 p-4">
            {stations.map(s => {
              const orderInfo = s.current_order_id ? activeOrders.get(s.current_order_id) : null;
              let batteryPct = 0;
              if (orderInfo && s.status === 'charging') {
                const battery = Math.min(orderInfo.target_battery_level, orderInfo.request_battery_level + (orderInfo.energy_consumed / 60) * 100);
                batteryPct = ((battery - orderInfo.request_battery_level) / (orderInfo.target_battery_level - orderInfo.request_battery_level)) * 100;
              }
              return (
              <div key={s.id} className={`p-4 rounded-xl border-2 transition ${statusColors[s.status] || 'border-gray-300 bg-gray-50'}`}>
                <div className="flex justify-between items-start mb-2">
                  <p className="font-bold font-mono">{s.station_number}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    s.status === 'charging' ? 'bg-yellow-200 text-yellow-700' :
                    s.status === 'available' ? 'bg-green-200 text-green-700' :
                    s.status === 'fault' ? 'bg-red-200 text-red-700' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {s.status === 'charging' ? '充电中' : s.status === 'available' ? '可用' : s.status === 'fault' ? '故障' : s.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{s.mode === 'fast' ? '快充' : '慢充'} | {s.location}</p>
                <p className="text-xs text-gray-400 mt-1">额定 {s.max_power}kW</p>
                {s.status === 'charging' && (
                  <div className="mt-2 space-y-1 text-xs">
                    {orderInfo && <p className="font-medium text-gray-700">用户: {orderInfo.user_name}</p>}
                    <p>{s.current_voltage > 0 ? `${s.current_voltage.toFixed(0)}V / ${s.current_current.toFixed(0)}A` : '启动中...'}</p>
                    <p>功率 {s.current_power.toFixed(1)}kW | 温度 {s.temperature.toFixed(0)}°C</p>
                    {orderInfo && (
                      <div>
                        <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1">
                          <div className="h-1.5 bg-yellow-400 rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, batteryPct))}%` }} />
                        </div>
                        <p className="text-gray-400 mt-0.5">{orderInfo.energy_consumed.toFixed(2)}kWh</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  );
}
