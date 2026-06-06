'use client';

import { useState, useEffect, useCallback } from 'react';

interface OvertimeRow {
  id: string;
  user_name: string;
  user_plate: string;
  station_number: string;
  charge_complete_time: string;
  overtime_minutes: number;
  parking_fee: number;
  grace_period_minutes: number;
  status: string;
}

export default function OvertimePage() {
  const [list, setList] = useState<OvertimeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadOvertime = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/overtime');
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const flat = (data || []).map((item: any) => ({
        id: item.id,
        user_name: item.users?.name || '未知',
        user_plate: item.users?.vehicle_plate || '未登记',
        station_number: item.charging_stations?.station_number || '-',
        charge_complete_time: item.charge_complete_time,
        overtime_minutes: item.overtime_minutes || 0,
        parking_fee: item.parking_fee || 0,
        grace_period_minutes: item.grace_period_minutes || 1,
        status: item.status,
      }));
      setList(flat);
    } catch {
      // unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOvertime(); }, [loadOvertime]);

  async function notifyVehicle(id: string) {
    try {
      const res = await fetch('/api/admin/overtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parkingOrderId: id }),
      });
      if (res.ok) setMessage('已向车主发送催离通知');
      else setMessage('通知发送失败');
    } catch {
      setMessage('通知发送失败');
    }
    setTimeout(() => setMessage(''), 3000);
  }

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">超时车辆管理 (UM05)</h2>
      <p className="text-xs text-gray-400 mb-6">
        数据来源: Supabase · 宽限期 1 分钟 · 每60秒自动刷新
        <button onClick={loadOvertime} className="ml-3 text-blue-600 hover:text-blue-800">刷新</button>
      </p>

      {message && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg">{message}</div>}

      {list.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400">暂无超时车辆</div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium text-gray-600">用户</th>
                <th className="text-left p-4 font-medium text-gray-600">车牌号</th>
                <th className="text-left p-4 font-medium text-gray-600">充电桩</th>
                <th className="text-left p-4 font-medium text-gray-600">充电完成时间</th>
                <th className="text-left p-4 font-medium text-gray-600">超时(分钟)</th>
                <th className="text-left p-4 font-medium text-gray-600">停车费</th>
                <th className="text-right p-4 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map(item => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="p-4 font-medium">{item.user_name}</td>
                  <td className="p-4 font-mono text-gray-500">{item.user_plate}</td>
                  <td className="p-4">{item.station_number}</td>
                  <td className="p-4 text-gray-500 text-xs">{new Date(item.charge_complete_time).toLocaleString('zh-CN')}</td>
                  <td className="p-4">
                    <span className={item.overtime_minutes > 30 ? 'text-red-600 font-bold' : 'text-orange-600'}>
                      {item.overtime_minutes} 分钟
                    </span>
                  </td>
                  <td className="p-4 font-bold text-red-600">¥{item.parking_fee.toFixed(2)}</td>
                  <td className="p-4 text-right">
                    <button onClick={() => notifyVehicle(item.id)}
                      className="px-4 py-1.5 bg-orange-600 text-white text-xs rounded-lg hover:bg-orange-700">
                      催离通知
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
