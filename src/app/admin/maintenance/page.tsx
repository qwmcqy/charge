'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

export default function MaintenancePage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [stationFilter, setStationFilter] = useState('');
  const [stations, setStations] = useState<any[]>([]);

  useEffect(() => { loadLogs(); loadStations(); }, []);

  async function loadStations() {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('charging_stations')
        .select('station_number')
        .order('station_number');
      setStations(data || []);
    } catch { /* ignore */ }
  }

  async function loadLogs() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('station_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setLogs(data || []);
    } catch {
      // Supabase unavailable
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = stationFilter
    ? logs.filter((l: any) => l.station_id && stations.find(s => s.station_number === stationFilter))
    : logs;

  async function handleArchive() {
    try {
      const supabase = createClient();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);

      const { error: logError } = await supabase
        .from('station_logs')
        .delete()
        .lt('created_at', cutoff.toISOString());

      if (logError) throw logError;

      const { error: notifError } = await supabase
        .from('notifications')
        .delete()
        .eq('read', true)
        .lt('created_at', cutoff.toISOString());

      if (notifError && !notifError.message.includes('PGRST')) throw notifError;

      setMessage(`已归档 30 天前的日志和已读通知`);
      loadLogs();
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('归档失败: ' + err.message);
    }
  }

  async function handleBackup() {
    setMessage('正在导出数据备份...');

    try {
      const supabase = createClient();

      const tables = ['charging_stations', 'charging_orders', 'bills', 'faults', 'notifications', 'station_logs'];
      const backup: Record<string, any[]> = {};

      for (const table of tables) {
        try {
          const { data } = await supabase.from(table).select('*');
          backup[table] = data || [];
        } catch { backup[table] = []; }
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setMessage('备份已下载');
      setTimeout(() => setMessage(''), 5000);
    } catch (err: any) {
      setMessage('备份失败: ' + err.message);
    }
  }

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">系统数据维护 (UM10)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · station_logs 表 · {logs.length} 条记录</p>

      {message && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg">{message}</div>}

      <div className="flex gap-4 mb-6 flex-wrap">
        <button onClick={handleArchive}
          className="px-6 py-2.5 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition">
          数据归档 (清理30天前)
        </button>
        <button onClick={handleBackup}
          className="px-6 py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition">
          导出备份
        </button>

        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">筛选充电桩:</label>
          <select value={stationFilter} onChange={e => setStationFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm outline-none">
            <option value="">全部</option>
            {stations.map(s => (
              <option key={s.station_number} value={s.station_number}>{s.station_number}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-4 font-medium text-gray-600">时间</th>
              <th className="text-left p-4 font-medium text-gray-600">充电桩ID</th>
              <th className="text-left p-4 font-medium text-gray-600">事件类型</th>
              <th className="text-left p-4 font-medium text-gray-600">数据 (JSON)</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log: any) => (
              <tr key={log.id} className="border-b last:border-0">
                <td className="p-4 text-gray-500 font-mono text-xs">{new Date(log.created_at).toLocaleString('zh-CN')}</td>
                <td className="p-4 font-mono text-xs">{log.station_id ? log.station_id.slice(0, 8) + '...' : '—'}</td>
                <td className="p-4">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                    {log.event_type}
                  </span>
                </td>
                <td className="p-4 text-xs text-gray-500 font-mono max-w-md truncate">{typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-gray-400">暂无系统日志</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
