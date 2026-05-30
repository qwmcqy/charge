'use client';

import { useState, useEffect, useCallback } from 'react';

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

interface QueueEntryRow {
  id: string;
  position: number;
  user_name: string;
  user_plate: string;
  mode: string;
  battery_level: number;
  estimated_wait_minutes: number;
  queue_type: string;
}

export default function AdminDashboard() {
  const [stations, setStations] = useState<StationRow[]>([]);
  const [activeOrders, setActiveOrders] = useState<Map<string, ChargingOrderInfo>>(new Map());
  const [queueEntries, setQueueEntries] = useState<QueueEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulateMsg, setSimulateMsg] = useState('');

  // 通过服务端 API 获取数据（service client 绕过 RLS，可读取所有用户名）
  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dashboard');
      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      if (data.stations) setStations(data.stations);
      if (data.orders) {
        const map = new Map<string, ChargingOrderInfo>();
        Object.entries(data.orders).forEach(([id, info]: [string, any]) => {
          map.set(id, info as ChargingOrderInfo);
        });
        setActiveOrders(map);
      }
      if (data.queue) setQueueEntries(data.queue);
    } catch {
      // API unavailable — keep current data
    } finally {
      setLoading(false);
    }
  }, []);

  // Run simulation tick for all active orders + dispatch queue
  const runSimulation = useCallback(async () => {
    try {
      const res = await fetch('/api/charging/simulate', { method: 'POST' });
      const result = await res.json();
      if (result.dispatch) {
        const parts: string[] = [];
        if (result.dispatch.fast) parts.push('快充队列已调度');
        if (result.dispatch.slow) parts.push('慢充队列已调度');
        if (parts.length > 0) setSimulateMsg(parts.join(' + '));
        else setSimulateMsg('无等待订单');
      }
    } catch {
      // Simulation unavailable — skip
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    runSimulation();
    const interval = setInterval(() => {
      runSimulation();
      loadDashboard();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadDashboard, runSimulation]);

  useEffect(() => {
    if (simulateMsg) {
      const t = setTimeout(() => setSimulateMsg(''), 4000);
      return () => clearTimeout(t);
    }
  }, [simulateMsg]);

  const stats = {
    total: stations.length,
    available: stations.filter(s => s.status === 'available').length,
    charging: stations.filter(s => s.status === 'charging').length,
    fault: stations.filter(s => s.status === 'fault').length,
    offline: stations.filter(s => s.status === 'offline').length,
    totalPower: stations.reduce((sum, s) => sum + (s.current_power || 0), 0),
    queueTotal: queueEntries.length,
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
        数据来源: Supabase · 每5秒自动刷新 · {stations.length} 个充电桩
        {simulateMsg && <span className="ml-3 text-blue-500 font-medium">⚡ {simulateMsg}</span>}
      </p>

      <div className="grid grid-cols-6 gap-3 mb-6">
        {[
          { label: '总数', value: stats.total, color: 'text-blue-600' },
          { label: '可用', value: stats.available, color: 'text-green-600' },
          { label: '充电中', value: stats.charging, color: 'text-yellow-600' },
          { label: '故障', value: stats.fault, color: 'text-red-600' },
          { label: '排队中', value: stats.queueTotal, color: 'text-purple-600' },
          { label: '总功率', value: `${stats.totalPower.toFixed(1)} kW`, color: 'text-indigo-600' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl shadow p-3">
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* 排队状态 */}
      {queueEntries.length > 0 && (
        <div className="bg-white rounded-xl shadow mb-6 overflow-hidden">
          <div className="p-3 border-b border-gray-200 bg-purple-50">
            <h3 className="font-semibold text-purple-800 text-sm">📋 当前排队队列 ({queueEntries.length} 人)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 font-medium text-gray-600">位置</th>
                  <th className="text-left p-2 font-medium text-gray-600">用户</th>
                  <th className="text-left p-2 font-medium text-gray-600">车牌</th>
                  <th className="text-left p-2 font-medium text-gray-600">模式</th>
                  <th className="text-left p-2 font-medium text-gray-600">电量</th>
                  <th className="text-left p-2 font-medium text-gray-600">预计等待</th>
                  <th className="text-left p-2 font-medium text-gray-600">队列类型</th>
                </tr>
              </thead>
              <tbody>
                {queueEntries.map(e => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="p-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 font-bold text-xs">
                        {e.position}
                      </span>
                    </td>
                    <td className="p-2 font-medium">{e.user_name}</td>
                    <td className="p-2 font-mono text-gray-500">{e.user_plate}</td>
                    <td className="p-2">{e.mode === 'fast' ? '⚡快充' : '🔋慢充'}</td>
                    <td className="p-2">{e.battery_level}%</td>
                    <td className="p-2">~{e.estimated_wait_minutes}分</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        e.queue_type === 'fast' ? 'bg-blue-100 text-blue-700' :
                        e.queue_type === 'slow' ? 'bg-purple-100 text-purple-700' :
                        'bg-orange-100 text-orange-700'
                      }`}>
                        {e.queue_type === 'fast' ? '快充队列' : e.queue_type === 'slow' ? '慢充队列' : '等候队列'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="font-semibold">充电桩实时状态</h3>
          <button onClick={loadDashboard} className="text-xs text-blue-600 hover:text-blue-800">刷新</button>
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
