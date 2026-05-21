'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';

export default function QueuePage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOrder, setActiveOrder] = useState<any>(null);

  const loadQueue = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // 加载排队条目
      const { data, error } = await supabase
        .from('queue_entries')
        .select('*, queues(type)')
        .eq('user_id', user.id)
        .in('status', ['waiting', 'ready'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEntries(data || []);

      // 检查是否有进行中的充电订单
      const { data: orderData } = await supabase
        .from('charging_orders')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['charging', 'paused'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setActiveOrder(orderData);
    } catch {
      // Supabase unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 5000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">排队状态 (UC02)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · 每5秒自动刷新</p>

      {activeOrder && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-semibold text-green-700">充电进行中</p>
              <p className="text-sm text-green-600 mt-1">
                模式: {activeOrder.mode === 'fast' ? '快充' : '慢充'} |
                状态: {activeOrder.status === 'paused' ? '已暂停' : '充电中'} |
                已消耗: {activeOrder.energy_consumed?.toFixed(2) || '0'} kWh
              </p>
            </div>
            <a href="/user/dashboard" className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
              查看充电进度
            </a>
          </div>
        </div>
      )}

      {entries.length === 0 && !activeOrder ? (
        <div className="bg-white rounded-xl shadow p-8 text-center">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-500">当前没有排队中的充电请求</p>
          <a href="/user/charge" className="inline-block mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition">
            去发起充电
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map(entry => {
            const queueType = entry.queues?.type;
            const isOverflow = queueType === 'waiting';
            return (
              <div key={entry.id} className={`bg-white rounded-xl shadow p-5 border-l-4 ${isOverflow ? 'border-orange-400' : entry.status === 'ready' ? 'border-green-400' : 'border-blue-400'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-lg">
                      {entry.mode === 'fast' ? '⚡ 快充' : '🔋 慢充'}
                      <span className={`text-xs ml-2 px-2 py-0.5 rounded-full ${
                        isOverflow ? 'bg-orange-100 text-orange-700' :
                        queueType === 'fast' ? 'bg-blue-100 text-blue-700' :
                        'bg-purple-100 text-purple-700'
                      }`}>
                        {isOverflow ? '等候队列' : queueType === 'fast' ? '快充队列' : '慢充队列'}
                      </span>
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      电量: {entry.battery_level}% | 队列位置: #{entry.position}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      提交时间: {new Date(entry.created_at).toLocaleString('zh-CN')}
                    </p>
                    {isOverflow && (
                      <p className="text-xs text-orange-500 mt-1">
                        当前{entry.mode === 'fast' ? '快充' : '慢充'}队列已满，您排在等候队列中，有空位时将自动进入主队列
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${entry.status === 'ready' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      <span className={`w-2 h-2 rounded-full animate-pulse ${entry.status === 'ready' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                      {entry.status === 'ready' ? '就绪' : '排队中'}
                    </span>
                    <p className="text-sm text-gray-500 mt-2">
                      预计等待: ~{entry.estimated_wait_minutes || '?'} 分钟
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
