'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

const typeLabels: Record<string, string> = {
  power_failure: '断电', overheating: '过热', communication_error: '通信故障',
  cable_damage: '线缆损坏', battery_anomaly: '电池异常', voltage_abnormal: '电压异常',
  current_abnormal: '电流异常', other: '其他',
};

const severityLabels: Record<string, string> = {
  minor: '一般', major: '重要', critical: '严重',
};

export default function FaultsPage() {
  const [faults, setFaults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [message, setMessage] = useState('');
  const [handleId, setHandleId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => { loadFaults(); }, []);

  async function loadFaults() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('faults')
        .select('*, charging_stations(station_number, location)')
        .order('detected_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setFaults(data || []);
    } catch {
      // Supabase unavailable
    } finally {
      setLoading(false);
    }
  }

  async function handleFault(id: string) {
    if (!resolution.trim()) return;
    setProcessing(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('faults')
        .update({
          resolved_at: new Date().toISOString(),
          handler_id: user?.id,
          resolution: resolution.trim(),
        })
        .eq('id', id);

      if (error) throw error;

      setFaults(prev => prev.map(f => f.id === id ? { ...f, status: 'resolved', resolved_at: new Date().toISOString(), resolution: resolution.trim() } : f));
      setHandleId(null);
      setResolution('');
      setMessage('故障已处理');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('处理失败: ' + err.message);
    } finally {
      setProcessing(false);
    }
  }

  const filtered = faults.filter(f => {
    if (filter === 'open') return !f.resolved_at;
    if (filter === 'resolved') return !!f.resolved_at;
    return true;
  });

  const openCount = faults.filter(f => !f.resolved_at).length;

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">充电桩故障处理 (UM04)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · {faults.length} 条故障记录</p>

      {message && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg">{message}</div>}

      <div className="mb-4 flex justify-between items-center">
        <div className="flex gap-2">
          {(['all', 'open', 'resolved'] as const).map(opt => (
            <button key={opt} onClick={() => setFilter(opt)}
              className={`px-4 py-1.5 text-sm rounded-lg ${filter === opt ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 border border-gray-300'}`}>
              {opt === 'all' ? '全部' : opt === 'open' ? `处理中 (${openCount})` : '已解决'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filtered.map(fault => {
          const station = fault.charging_stations;
          const isOpen = !fault.resolved_at;
          return (
          <div key={fault.id} className={`bg-white rounded-xl shadow p-5 border-l-4 ${isOpen ? 'border-red-500' : 'border-green-500'}`}>
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold">充电桩 {station?.station_number || fault.station_id}</span>
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                    fault.severity === 'critical' ? 'bg-red-100 text-red-700' : fault.severity === 'major' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {severityLabels[fault.severity] || fault.severity}
                  </span>
                  <span className="text-xs text-gray-400">{typeLabels[fault.type] || fault.type}</span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{fault.description}</p>
                <p className="text-xs text-gray-400 mt-1">检测时间: {new Date(fault.detected_at).toLocaleString('zh-CN')}</p>
                {fault.resolved_at && (
                  <p className="text-xs text-green-600 mt-1">
                    解决时间: {new Date(fault.resolved_at).toLocaleString('zh-CN')} | 方案: {fault.resolution}
                  </p>
                )}
              </div>
            </div>

            {isOpen && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                {handleId === fault.id ? (
                  <div className="flex gap-2">
                    <input type="text" value={resolution} onChange={e => setResolution(e.target.value)}
                      placeholder="输入处理方案..." className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={() => handleFault(fault.id)} disabled={processing || !resolution.trim()}
                      className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">确认处理</button>
                    <button onClick={() => setHandleId(null)}
                      className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">取消</button>
                  </div>
                ) : (
                  <button onClick={() => setHandleId(fault.id)}
                    className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">处理故障</button>
                )}
              </div>
            )}
          </div>
        )})}

        {filtered.length === 0 && (
          <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400">暂无故障记录</div>
        )}
      </div>
    </div>
  );
}
