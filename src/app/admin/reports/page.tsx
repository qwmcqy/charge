'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState({ start: '2026-05-01', end: '2026-05-20' });
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function generateReport() {
    setLoading(true);
    setMessage('');

    try {
      const supabase = createClient();
      const start = `${dateRange.start}T00:00:00`;
      const end = `${dateRange.end}T23:59:59`;

      // Query orders in date range
      const { data: orders } = await supabase
        .from('charging_orders')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end);

      // Query bills
      const { data: bills } = await supabase
        .from('bills')
        .select('*')
        .gte('generated_at', start)
        .lte('generated_at', end);

      // Query faults
      const { data: faults } = await supabase
        .from('faults')
        .select('*')
        .gte('detected_at', start)
        .lte('detected_at', end);

      const orderList = orders || [];
      const billList = bills || [];
      const faultList = faults || [];

      const totalOrders = orderList.length;
      const totalEnergy = orderList.reduce((sum: number, o: any) => sum + (o.energy_consumed || 0), 0);
      const totalChargingFee = billList.reduce((sum: number, b: any) => sum + (b.charging_fee || 0), 0);
      const totalParkingFee = billList.reduce((sum: number, b: any) => sum + (b.parking_fee || 0), 0);
      const totalRevenue = billList
        .filter((b: any) => b.status === 'paid')
        .reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0);
      const faultCount = faultList.length;

      // Hourly distribution
      const hourly: Record<number, number> = {};
      for (const o of orderList) {
        const hour = new Date(o.created_at).getHours();
        hourly[hour] = (hourly[hour] || 0) + 1;
      }

      // Station utilization
      const stationCounts: Record<string, number> = {};
      for (const o of orderList) {
        if (o.station_id) {
          stationCounts[o.station_id] = (stationCounts[o.station_id] || 0) + 1;
        }
      }
      const maxOrders = Math.max(1, ...Object.values(stationCounts));
      const stationUtilization: Record<string, number> = {};
      for (const [stationId, count] of Object.entries(stationCounts)) {
        stationUtilization[stationId] = Math.round((count / maxOrders) * 100) / 100;
      }

      setReport({
        totalOrders,
        totalEnergy: Math.round(totalEnergy * 100) / 100,
        totalChargingFee: Math.round(totalChargingFee * 100) / 100,
        totalParkingFee: Math.round(totalParkingFee * 100) / 100,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        faultCount,
        avgWaitMinutes: 0,
        stationUtilization,
        hourlyDistribution: hourly,
        dateRange: { start, end },
      });
    } catch (err: any) {
      setMessage('生成报表失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">运营数据记录 (UM07)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase 聚合查询</p>

      {message && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{message}</div>}

      <div className="bg-white rounded-xl shadow p-6 mb-6">
        <div className="flex gap-4 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">开始日期</label>
            <input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">结束日期</label>
            <input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={generateReport} disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? '生成中...' : '生成报表'}
          </button>
        </div>
      </div>

      {report && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '总订单数', value: report.totalOrders },
              { label: '总充电量', value: `${report.totalEnergy.toFixed(1)} kWh` },
              { label: '总收入', value: `¥${report.totalRevenue.toFixed(2)}` },
              { label: '故障次数', value: report.faultCount },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl shadow p-4">
                <p className="text-sm text-gray-500">{card.label}</p>
                <p className="text-2xl font-bold text-green-700">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow p-4">
              <h3 className="font-semibold mb-2">收入明细</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>充电费收入</span><span className="font-bold">¥{report.totalChargingFee.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>停车费收入</span><span className="font-bold text-orange-600">¥{report.totalParkingFee.toFixed(2)}</span></div>
                <div className="flex justify-between pt-2 border-t"><span className="font-semibold">总收入</span><span className="font-bold text-green-600">¥{report.totalRevenue.toFixed(2)}</span></div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow p-4">
              <h3 className="font-semibold mb-2">时段分布 (订单数)</h3>
              <div className="space-y-1">
                {Object.entries(report.hourlyDistribution as Record<string, number>).map(([hour, count]) => (
                  <div key={hour} className="flex items-center gap-2">
                    <span className="text-xs w-10 text-gray-500">{hour}:00</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(100, (Number(count) / Math.max(1, report.totalOrders)) * 100)}%` }} />
                    </div>
                    <span className="text-xs font-medium w-6">{String(count)}</span>
                  </div>
                ))}
                {Object.keys(report.hourlyDistribution).length === 0 && (
                  <p className="text-gray-400 text-sm text-center py-4">暂无数据</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
