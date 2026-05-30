'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

interface BillRow {
  id: string;
  charging_order_id: string;
  user_name: string;
  user_plate: string;
  charging_fee: number;
  parking_fee: number;
  total_amount: number;
  status: string;
  generated_at: string;
  energy_consumed: number;
  charging_duration_minutes: number;
  rate_per_kwh: number;
  charge_mode: string;
}

export default function AdminBillsPage() {
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [expandedBill, setExpandedBill] = useState<string | null>(null);

  useEffect(() => { loadBills(); }, []);

  async function loadBills() {
    try {
      const supabase = createClient();

      const { data: rawBills, error } = await supabase
        .from('bills')
        .select('*, users(name, vehicle_plate)')
        .order('generated_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // 批量获取关联的充电订单
      const orderIds = (rawBills || []).map((b: any) => b.charging_order_id).filter(Boolean);
      const { data: orders } = await supabase
        .from('charging_orders')
        .select('*')
        .in('id', orderIds);

      const ordersMap = new Map((orders || []).map((o: any) => [o.id, o as any]));

      setBills((rawBills || []).map((b: any) => {
        const order = ordersMap.get(b.charging_order_id);
        const mode = order?.mode || 'fast';
        const ratePerKwh = mode === 'fast' ? 1.2 : 0.8;

        let duration = 0;
        if (order?.start_time && order?.end_time) {
          duration = Math.round((new Date(order.end_time).getTime() - new Date(order.start_time).getTime()) / 60000);
        }

        return {
          id: b.id,
          charging_order_id: b.charging_order_id,
          user_name: b.users?.name || '未知',
          user_plate: b.users?.vehicle_plate || '未登记',
          charging_fee: b.charging_fee || 0,
          parking_fee: b.parking_fee || 0,
          total_amount: b.total_amount || 0,
          status: b.status || 'unpaid',
          generated_at: b.generated_at,
          energy_consumed: order?.energy_consumed || 0,
          charging_duration_minutes: duration,
          rate_per_kwh: ratePerKwh,
          charge_mode: mode,
        };
      }));
    } catch {
      // Supabase unavailable
    } finally {
      setLoading(false);
    }
  }

  async function verifyBill(billId: string) {
    try {
      const supabase = createClient();

      const bill = bills.find(b => b.id === billId);
      if (!bill) return;

      const rate = bill.rate_per_kwh;
      const energyConsumed = bill.energy_consumed;
      const chargingFee = Math.round(energyConsumed * rate * 100) / 100;
      const total = Math.round((chargingFee + bill.parking_fee) * 100) / 100;

      const { error } = await supabase
        .from('bills')
        .update({
          charging_fee: chargingFee,
          total_amount: total,
          status: 'paid',
          paid_at: new Date().toISOString(),
        })
        .eq('id', billId);

      if (error) throw error;
      setMessage(`账单已核算: 充电费 ¥${chargingFee.toFixed(2)} (${energyConsumed.toFixed(2)}kWh × ¥${rate}/kWh) + 停车费 ¥${bill.parking_fee.toFixed(2)} = ¥${total.toFixed(2)}`);
      loadBills();
    } catch (err: any) {
      setMessage('核算失败: ' + err.message);
    }
    setTimeout(() => setMessage(''), 5000);
  }

  const totalRevenue = bills.filter(b => b.status === 'paid').reduce((s, b) => s + b.total_amount, 0);
  const totalEnergy = bills.reduce((s, b) => s + b.energy_consumed, 0);

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">费用核算与账单出具 (UM06)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · {bills.length} 条账单 · 含充电详情</p>

      {message && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg">{message}</div>}

      <div className="flex justify-between items-center mb-4 gap-4">
        <div className="bg-white rounded-xl shadow px-4 py-3">
          <span className="text-sm text-gray-500">已收款项: </span>
          <span className="text-lg font-bold text-green-600">¥{totalRevenue.toFixed(2)}</span>
        </div>
        <div className="bg-white rounded-xl shadow px-4 py-3">
          <span className="text-sm text-gray-500">总充电量: </span>
          <span className="text-lg font-bold text-blue-600">{totalEnergy.toFixed(1)} kWh</span>
        </div>
      </div>

      {bills.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400">暂无账单记录</div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium text-gray-600">账单ID</th>
                <th className="text-left p-4 font-medium text-gray-600">用户</th>
                <th className="text-left p-4 font-medium text-gray-600">车牌号</th>
                <th className="text-left p-4 font-medium text-gray-600">充电量</th>
                <th className="text-left p-4 font-medium text-gray-600">时长</th>
                <th className="text-left p-4 font-medium text-gray-600">计费规则</th>
                <th className="text-left p-4 font-medium text-gray-600">充电费</th>
                <th className="text-left p-4 font-medium text-gray-600">停车费</th>
                <th className="text-left p-4 font-medium text-gray-600">合计</th>
                <th className="text-left p-4 font-medium text-gray-600">状态</th>
                <th className="text-right p-4 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {bills.map(bill => (
                <tr key={bill.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-4 font-mono text-xs">
                    <button onClick={() => setExpandedBill(expandedBill === bill.id ? null : bill.id)}
                      className="hover:text-blue-600" title="点击查看详情">
                      {bill.id.slice(0, 8)}...
                    </button>
                  </td>
                  <td className="p-4">{bill.user_name}</td>
                  <td className="p-4 font-mono">{bill.user_plate}</td>
                  <td className="p-4">
                    <span className="font-semibold text-blue-700">{bill.energy_consumed.toFixed(2)}</span>
                    <span className="text-gray-400 ml-1">kWh</span>
                  </td>
                  <td className="p-4">
                    {bill.charging_duration_minutes >= 60
                      ? `${Math.floor(bill.charging_duration_minutes / 60)}h${bill.charging_duration_minutes % 60}m`
                      : `${bill.charging_duration_minutes}分`}
                  </td>
                  <td className="p-4 text-xs">
                    <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                      {bill.charge_mode === 'fast' ? '⚡快充' : '🔋慢充'} ¥{bill.rate_per_kwh.toFixed(2)}/kWh
                    </span>
                  </td>
                  <td className="p-4">¥{bill.charging_fee.toFixed(2)}</td>
                  <td className="p-4">{bill.parking_fee > 0 ? <span className="text-orange-600">¥{bill.parking_fee.toFixed(2)}</span> : '—'}</td>
                  <td className="p-4 font-bold">¥{bill.total_amount.toFixed(2)}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bill.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {bill.status === 'paid' ? '已支付' : '待支付'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <button onClick={() => verifyBill(bill.id)}
                      className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">
                      核算
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 展开的详情面板 */}
          {expandedBill && (() => {
            const bill = bills.find(b => b.id === expandedBill);
            if (!bill) return null;
            return (
              <div className="border-t bg-blue-50 p-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">⚡ 充电详情</p>
                    <div className="text-sm space-y-1">
                      <p>充电量: <span className="font-semibold">{bill.energy_consumed.toFixed(2)} kWh</span></p>
                      <p>充电时长: <span className="font-semibold">
                        {bill.charging_duration_minutes >= 60
                          ? `${Math.floor(bill.charging_duration_minutes / 60)}时${bill.charging_duration_minutes % 60}分`
                          : `${bill.charging_duration_minutes}分钟`}
                      </span></p>
                      <p>充电模式: <span className="font-semibold">{bill.charge_mode === 'fast' ? '快充' : '慢充'}</span></p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">💰 计费明细</p>
                    <div className="text-sm space-y-1">
                      <p>单价: <span className="font-semibold">¥{bill.rate_per_kwh.toFixed(2)}/kWh</span></p>
                      <p>充电费 = {bill.energy_consumed.toFixed(2)} × ¥{bill.rate_per_kwh.toFixed(2)}
                        <span className="ml-2 font-semibold">= ¥{bill.charging_fee.toFixed(2)}</span>
                      </p>
                      <p>停车费: <span className="font-semibold text-orange-600">¥{bill.parking_fee.toFixed(2)}</span></p>
                      <p className="border-t pt-1">合计: <span className="font-semibold text-red-600 text-base">¥{bill.total_amount.toFixed(2)}</span></p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">📋 账单信息</p>
                    <div className="text-sm space-y-1">
                      <p>账单ID: <span className="font-mono text-xs">{bill.id}</span></p>
                      <p>订单ID: <span className="font-mono text-xs">{bill.charging_order_id}</span></p>
                      <p>生成时间: <span>{new Date(bill.generated_at).toLocaleString('zh-CN')}</span></p>
                      <p>状态: <span className={`font-medium ${bill.status === 'paid' ? 'text-green-600' : 'text-red-600'}`}>
                        {bill.status === 'paid' ? '已支付' : '待支付'}
                      </span></p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
