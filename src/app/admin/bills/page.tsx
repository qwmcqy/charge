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
}

export default function AdminBillsPage() {
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => { loadBills(); }, []);

  async function loadBills() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('bills')
        .select('*, users(name, vehicle_plate)')
        .order('generated_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      setBills((data || []).map((b: any) => ({
        id: b.id,
        charging_order_id: b.charging_order_id,
        user_name: b.users?.name || '未知',
        user_plate: b.users?.vehicle_plate || '未登记',
        charging_fee: b.charging_fee || 0,
        parking_fee: b.parking_fee || 0,
        total_amount: b.total_amount || 0,
        status: b.status || 'unpaid',
        generated_at: b.generated_at,
      })));
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

      const { data: order } = await supabase
        .from('charging_orders')
        .select('energy_consumed, mode')
        .eq('id', bill.charging_order_id)
        .maybeSingle();

      const rate = (order as any)?.mode === 'fast' ? 1.2 : 0.8;
      const energyConsumed = (order as any)?.energy_consumed || 0;
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

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">费用核算与账单出具 (UM06)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · {bills.length} 条账单</p>

      {message && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg">{message}</div>}

      <div className="flex justify-between items-center mb-4">
        <div className="bg-white rounded-xl shadow px-4 py-3">
          <span className="text-sm text-gray-500">已收款项: </span>
          <span className="text-lg font-bold text-green-600">¥{totalRevenue.toFixed(2)}</span>
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
                <th className="text-left p-4 font-medium text-gray-600">充电费</th>
                <th className="text-left p-4 font-medium text-gray-600">停车费</th>
                <th className="text-left p-4 font-medium text-gray-600">合计</th>
                <th className="text-left p-4 font-medium text-gray-600">状态</th>
                <th className="text-left p-4 font-medium text-gray-600">时间</th>
                <th className="text-right p-4 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {bills.map(bill => (
                <tr key={bill.id} className="border-b last:border-0">
                  <td className="p-4 font-mono text-xs">{bill.id}</td>
                  <td className="p-4">{bill.user_name}</td>
                  <td className="p-4 font-mono">{bill.user_plate}</td>
                  <td className="p-4">¥{bill.charging_fee.toFixed(2)}</td>
                  <td className="p-4">{bill.parking_fee > 0 ? <span className="text-orange-600">¥{bill.parking_fee.toFixed(2)}</span> : '—'}</td>
                  <td className="p-4 font-bold">¥{bill.total_amount.toFixed(2)}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${bill.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {bill.status === 'paid' ? '已支付' : '待支付'}
                    </span>
                  </td>
                  <td className="p-4 text-gray-500 text-xs">{new Date(bill.generated_at).toLocaleString('zh-CN')}</td>
                  <td className="p-4 text-right">
                    <button onClick={() => verifyBill(bill.id)}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                      核算
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
