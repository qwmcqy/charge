'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

const typeLabels: Record<string, string> = {
  system: '📢 系统通知', queue_ready: '🔌 排队就绪', charging_started: '⚡ 充电开始',
  charging_complete: '✅ 充电完成', fault_occurred: '⚠️ 故障告警', overtime_warning: '⏰ 超时提醒',
  bill_generated: '💰 账单生成', payment_success: '💳 支付成功',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadNotifications(); }, []);

  async function loadNotifications() {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setNotifications(data || []);
    } catch {
      // Supabase unavailable
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    try {
      const supabase = createClient();
      await supabase.from('notifications').update({ read: true }).eq('id', id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch {
      // silent
    }
  }

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">通知中心 (UC03)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · {notifications.filter((n: any) => !n.read).length} 条未读</p>

      {notifications.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-8 text-center">
          <div className="text-5xl mb-4">🔔</div>
          <p className="text-gray-500">暂无通知</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map(n => (
            <div key={n.id} onClick={() => markRead(n.id)}
              className={`bg-white rounded-xl shadow p-4 cursor-pointer transition border-l-4 ${n.read ? 'border-gray-200 opacity-60' : 'border-blue-500'}`}>
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-gray-400">{typeLabels[n.type] || n.type}</p>
                  <p className="font-semibold mt-1">{n.title}</p>
                  <p className="text-sm text-gray-600 mt-1">{n.content}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {!n.read && <span className="w-2 h-2 bg-blue-500 rounded-full" />}
                  <span className="text-xs text-gray-400">{new Date(n.created_at).toLocaleString('zh-CN')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
