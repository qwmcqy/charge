'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { ChargeMode } from '@/lib/types';

interface BillItem {
  id: string;
  chargingOrderId: string;
  chargingFee: number;
  parkingFee: number;
  totalAmount: number;
  generatedAt: string;
  paidAt?: string;
  status: string;
  energyConsumed: number;
  chargingDurationMinutes: number;
  ratePerKwh: number;
  chargeMode: string;
  startTime?: string;
  endTime?: string;
  requestBatteryLevel?: number;
  targetBatteryLevel?: number;
}

export default function BillsPage() {
  const [bills, setBills] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const loadBills = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // 使用 API 获取含充电详情的账单
      const res = await fetch(`/api/bills?userId=${user.id}`);
      if (!res.ok) throw new Error('获取账单失败');
      const data = await res.json();
      setBills(data.bills || []);
    } catch {
      // API unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBills(); }, [loadBills]);

  async function handlePay(billId: string) {
    setPaying(billId);
    setMessage('');

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('请先登录');

      const res = await fetch('/api/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, billId, method: 'wechat' }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '支付失败');

      setMessage(`支付成功！流水号: ${result.transactionId}`);
      loadBills();
    } catch (err: any) {
      setMessage('支付失败: ' + (err.message || '未知错误'));
    } finally {
      setPaying(null);
    }
  }

  const totalUnpaid = bills.filter(b => b.status === 'unpaid').reduce((sum, b) => sum + b.totalAmount, 0);

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">我的账单 (UC05)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · 含充电详情</p>

      {bills.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4 mb-4 flex justify-between items-center">
          <span className="text-sm text-gray-600">待支付账单: {bills.filter((b: any) => b.status === 'unpaid').length} 笔</span>
          <span className="text-lg font-bold text-red-600">合计: ¥{totalUnpaid.toFixed(2)}</span>
        </div>
      )}

      {message && <div className={`mb-4 p-3 border rounded-lg text-sm ${message.includes('成功') ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message}</div>}

      {bills.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center">
          <div className="text-5xl mb-4">💰</div>
          <p className="text-gray-500">暂无账单记录</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bills.map(bill => (
            <div key={bill.id} className="bg-white rounded-xl shadow p-5">
              {/* 头部：状态 + 时间 */}
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-semibold text-lg">
                    {bill.chargeMode === 'fast' ? '⚡ 快充账单' : '🔋 慢充账单'}
                  </p>
                  <p className="text-xs font-mono text-gray-400 mt-1">{bill.id.slice(0, 8)}...</p>
                  <p className="text-xs text-gray-400">{new Date(bill.generatedAt).toLocaleString('zh-CN')}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${bill.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {bill.status === 'paid' ? '✅ 已支付' : '⏳ 待支付'}
                  </span>
                  {bill.paidAt && (
                    <p className="text-xs text-gray-400 mt-1">支付时间: {new Date(bill.paidAt).toLocaleString('zh-CN')}</p>
                  )}
                </div>
              </div>

              {/* 充电详情区域 */}
              <div className="bg-gray-50 rounded-lg p-3 mb-3">
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">⚡ 充电详情</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <div>
                    <span className="text-gray-500">充电量:</span>
                    <span className="ml-2 font-semibold text-blue-700">{bill.energyConsumed.toFixed(2)} kWh</span>
                  </div>
                  <div>
                    <span className="text-gray-500">充电模式:</span>
                    <span className={`ml-2 font-semibold ${bill.chargeMode === 'fast' ? 'text-blue-600' : 'text-purple-600'}`}>
                      {bill.chargeMode === 'fast' ? '快充' : '慢充'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">充电时长:</span>
                    <span className="ml-2 font-semibold">
                      {bill.chargingDurationMinutes >= 60
                        ? `${Math.floor(bill.chargingDurationMinutes / 60)}时${bill.chargingDurationMinutes % 60}分`
                        : `${bill.chargingDurationMinutes}分钟`}
                    </span>
                  </div>
                  {(bill.requestBatteryLevel != null && bill.targetBatteryLevel != null) && (
                    <div>
                      <span className="text-gray-500">电量变化:</span>
                      <span className="ml-2 font-semibold text-green-700">
                        {bill.requestBatteryLevel}% → {bill.targetBatteryLevel}%
                      </span>
                    </div>
                  )}
                  {bill.startTime && (
                    <div>
                      <span className="text-gray-500">开始充电:</span>
                      <span className="ml-2 text-xs">{new Date(bill.startTime).toLocaleString('zh-CN')}</span>
                    </div>
                  )}
                  {bill.endTime && (
                    <div>
                      <span className="text-gray-500">结束充电:</span>
                      <span className="ml-2 text-xs">{new Date(bill.endTime).toLocaleString('zh-CN')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 计费规则 + 费用明细 */}
              <div className="bg-amber-50 rounded-lg p-3 mb-3 border border-amber-100">
                <p className="text-xs font-medium text-amber-700 mb-2 uppercase tracking-wider">💰 计费规则</p>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">
                      {bill.chargeMode === 'fast' ? '快充' : '慢充'}单价: ¥{bill.ratePerKwh.toFixed(2)}/kWh
                      × {bill.energyConsumed.toFixed(2)} kWh
                    </span>
                    <span className="font-semibold">= ¥{bill.chargingFee.toFixed(2)}</span>
                  </div>
                  {bill.parkingFee > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">超时停车费:</span>
                      <span className="font-semibold text-orange-600">¥{bill.parkingFee.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-amber-200 pt-1.5 mt-1.5">
                    <span className="font-medium text-gray-800">合计</span>
                    <span className="text-lg font-bold text-red-600">¥{bill.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* 支付按钮 */}
              <div className="flex justify-end">
                {bill.status === 'unpaid' ? (
                  <button onClick={() => handlePay(bill.id)} disabled={paying === bill.id}
                    className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition">
                    {paying === bill.id ? '支付中...' : '💳 立即支付'}
                  </button>
                ) : (
                  <span className="text-sm text-green-600 font-medium">✅ 已支付</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
