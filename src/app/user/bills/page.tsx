'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

export default function BillsPage() {
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => { loadBills(); }, []);

  async function loadBills() {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('bills')
        .select('*')
        .eq('user_id', user.id)
        .order('generated_at', { ascending: false });

      if (error) throw error;
      setBills(data || []);
    } catch {
      // Supabase unavailable
    } finally {
      setLoading(false);
    }
  }

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

  const totalUnpaid = bills.filter(b => b.status === 'unpaid').reduce((sum, b) => sum + (b.total_amount || 0), 0);

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">我的账单 (UC05)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase</p>

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
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">充电账单</p>
                  <p className="text-xs font-mono text-gray-400 mt-1">{bill.id}</p>
                  <p className="text-xs text-gray-400">{new Date(bill.generated_at).toLocaleString('zh-CN')}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${bill.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {bill.status === 'paid' ? '已支付' : '待支付'}
                  </span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                <div className="space-y-1 text-sm">
                  <p>充电费: <span className="font-medium">¥{(bill.charging_fee || 0).toFixed(2)}</span></p>
                  {bill.parking_fee > 0 && <p>停车费: <span className="font-medium text-orange-600">¥{(bill.parking_fee || 0).toFixed(2)}</span></p>}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-800">¥{(bill.total_amount || 0).toFixed(2)}</p>
                  {bill.status === 'unpaid' && (
                    <button onClick={() => handlePay(bill.id)} disabled={paying === bill.id}
                      className="mt-2 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      {paying === bill.id ? '支付中...' : '立即支付'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
