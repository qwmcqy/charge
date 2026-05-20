'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

interface RequestRow {
  id: string;
  user_name: string;
  user_plate: string;
  mode: string;
  request_battery_level: number;
  target_battery_level: number;
  created_at: string;
  status: string;
}

export default function RequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => { loadRequests(); }, []);

  async function loadRequests() {
    try {
      const supabase = createClient();
      // 显示待审核和排队中的订单（新流程中订单直接进入 queued，不再需要 pending）
      const { data, error } = await supabase
        .from('charging_orders')
        .select('*, users(name, vehicle_plate)')
        .in('status', ['pending', 'queued'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      setRequests((data || []).map((o: any) => ({
        id: o.id,
        user_name: o.users?.name || '未知',
        user_plate: o.users?.vehicle_plate || '未登记',
        mode: o.mode,
        request_battery_level: o.request_battery_level,
        target_battery_level: o.target_battery_level,
        created_at: o.created_at,
        status: o.status,
      })));
    } catch {
      setMessage('加载请求列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id: string) {
    setProcessingId(id);
    try {
      const supabase = createClient();

      // 更新状态为 queued
      const { error } = await supabase
        .from('charging_orders')
        .update({ status: 'queued' })
        .eq('id', id);
      if (error) throw error;

      // 尝试分配充电桩
      const res = await fetch(`/api/charging/${id}/start`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok) {
        setMessage('已通过审核，但暂无可用充电桩：' + result.error + '（订单已进入队列等待）');
      } else {
        setMessage('已通过！充电桩已分配，充电已开始');
      }

      setRequests(prev => prev.filter(r => r.id !== id));
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('操作失败: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(id: string) {
    setProcessingId(id);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('charging_orders')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
      setMessage('已拒绝请求');
      setRequests(prev => prev.filter(r => r.id !== id));
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('操作失败: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  }

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">充电请求管理 (UM02)</h2>
      <p className="text-xs text-gray-400 mb-2">数据来源: Supabase · {requests.length} 条记录</p>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-700">
        系统默认自动分配：有空闲充电桩时直接充电，无空闲时自动排队。此处仅显示待审核和排队中的订单，管理员可手动干预。
      </div>

      {message && <div className={`mb-4 p-3 border rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>{message}</div>}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-4 font-medium text-gray-600">用户</th>
              <th className="text-left p-4 font-medium text-gray-600">车牌号</th>
              <th className="text-left p-4 font-medium text-gray-600">模式</th>
              <th className="text-left p-4 font-medium text-gray-600">电量</th>
              <th className="text-left p-4 font-medium text-gray-600">时间</th>
              <th className="text-left p-4 font-medium text-gray-600">状态</th>
              <th className="text-right p-4 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {requests.map(req => (
              <tr key={req.id} className="border-b last:border-0">
                <td className="p-4 font-medium">{req.user_name}</td>
                <td className="p-4 font-mono">{req.user_plate}</td>
                <td className="p-4">{req.mode === 'fast' ? '⚡ 快充' : '🔋 慢充'}</td>
                <td className="p-4">{req.request_battery_level}% → {req.target_battery_level}%</td>
                <td className="p-4 text-gray-500 text-xs">{new Date(req.created_at).toLocaleString('zh-CN')}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    req.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {req.status === 'pending' ? '待审核' : '排队中'}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => handleApprove(req.id)} disabled={processingId === req.id}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50">
                      {processingId === req.id ? '处理中...' : '分配充电'}
                    </button>
                    <button onClick={() => handleReject(req.id)} disabled={processingId === req.id}
                      className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 disabled:opacity-50">取消</button>
                  </div>
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-gray-400">暂无待审核或排队中的请求</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
