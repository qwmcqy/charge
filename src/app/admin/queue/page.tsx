'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';

interface QueueEntryRow {
  id: string;
  user_name: string;
  user_plate: string;
  battery_level: number;
  position: number;
  estimated_wait_minutes: number;
  status: string;
  mode: string;
}

export default function AdminQueuePage() {
  const [queues, setQueues] = useState<Record<string, QueueEntryRow[]>>({ fast: [], slow: [], waiting: [] });
  const [activeTab, setActiveTab] = useState<'fast' | 'slow' | 'waiting'>('fast');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadQueues = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('queue_entries')
        .select('*, users(name, vehicle_plate), queues(type)')
        .in('status', ['waiting', 'ready'])
        .order('position', { ascending: true });

      if (error) throw error;

      const result: Record<string, QueueEntryRow[]> = { fast: [], slow: [], waiting: [] };
      (data || []).forEach((e: any) => {
        const qType = e.queues?.type || 'waiting';
        if (result[qType]) {
          result[qType].push({
            id: e.id,
            user_name: e.users?.name || '未知',
            user_plate: e.users?.vehicle_plate || '未登记',
            battery_level: e.battery_level,
            position: e.position,
            estimated_wait_minutes: e.estimated_wait_minutes || 0,
            status: e.status,
            mode: e.mode,
          });
        }
      });
      setQueues(result);
    } catch {
      // Supabase unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadQueues(); }, [loadQueues]);

  async function removeEntry(entryId: string) {
    try {
      const supabase = createClient();
      await supabase.from('queue_entries').update({ status: 'cancelled' }).eq('id', entryId);
      setMessage(`已移除队列条目`);
      loadQueues();
    } catch {
      setMessage('操作失败');
    }
    setTimeout(() => setMessage(''), 3000);
  }

  async function prioritizeEntry(entryId: string) {
    try {
      const supabase = createClient();
      await supabase.from('queue_entries').update({ position: 1 }).eq('id', entryId);
      setMessage(`已设为最高优先级`);
      loadQueues();
    } catch {
      setMessage('操作失败');
    }
    setTimeout(() => setMessage(''), 3000);
  }

  const tabs: Array<{ key: 'fast' | 'slow' | 'waiting'; label: string; color: string }> = [
    { key: 'fast', label: '快充队列', color: 'border-yellow-500 text-yellow-700' },
    { key: 'slow', label: '慢充队列', color: 'border-blue-500 text-blue-700' },
    { key: 'waiting', label: '等候队列', color: 'border-gray-500 text-gray-700' },
  ];

  const currentEntries = queues[activeTab] || [];

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">队列秩序管理 (UM03)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · 共 {Object.values(queues).flat().length} 条排队</p>

      {message && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg">{message}</div>}

      <div className="bg-white rounded-xl shadow">
        <div className="border-b flex">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === tab.key ? tab.color : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {tab.label} ({queues[tab.key]?.length || 0})
            </button>
          ))}
        </div>

        <div className="p-4">
          {currentEntries.length === 0 ? (
            <p className="text-center text-gray-400 py-8">暂无排队</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className="text-left p-3 text-gray-500 font-medium">位置</th>
                  <th className="text-left p-3 text-gray-500 font-medium">用户</th>
                  <th className="text-left p-3 text-gray-500 font-medium">车牌号</th>
                  <th className="text-left p-3 text-gray-500 font-medium">电量</th>
                  <th className="text-left p-3 text-gray-500 font-medium">模式</th>
                  <th className="text-left p-3 text-gray-500 font-medium">预计等待</th>
                  <th className="text-left p-3 text-gray-500 font-medium">状态</th>
                  <th className="text-right p-3 text-gray-500 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {currentEntries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0">
                    <td className="p-3 font-bold">#{entry.position}</td>
                    <td className="p-3">{entry.user_name}</td>
                    <td className="p-3 font-mono">{entry.user_plate}</td>
                    <td className="p-3">{entry.battery_level}%</td>
                    <td className="p-3">{entry.mode === 'fast' ? '⚡ 快充' : '🔋 慢充'}</td>
                    <td className="p-3">~{entry.estimated_wait_minutes}分钟</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${entry.status === 'ready' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {entry.status === 'ready' ? '就绪' : '等待中'}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => prioritizeEntry(entry.id)}
                          className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">优先</button>
                        <button onClick={() => removeEntry(entry.id)}
                          className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">移除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
