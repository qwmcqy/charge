'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

interface StationRow {
  id: string;
  station_number: string;
  mode: string;
  status: string;
  location: string;
  max_power: number;
}

export default function StationsPage() {
  const [stations, setStations] = useState<StationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ station_number: '', mode: 'fast', location: '', max_power: 60 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { loadStations(); }, []);

  async function loadStations() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('charging_stations')
        .select('*')
        .order('station_number');

      if (error) throw error;
      setStations(data || []);
    } catch {
      // Supabase unavailable
    } finally {
      setLoading(false);
    }
  }

  function openAddForm() {
    setEditId(null);
    setForm({ station_number: '', mode: 'fast', location: '', max_power: 60 });
    setShowForm(true);
  }

  function openEditForm(s: StationRow) {
    setEditId(s.id);
    setForm({ station_number: s.station_number, mode: s.mode, location: s.location, max_power: s.max_power });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.station_number || !form.location) return;
    setSaving(true);

    try {
      const supabase = createClient();

      if (editId) {
        const { error } = await supabase
          .from('charging_stations')
          .update({
            station_number: form.station_number,
            mode: form.mode,
            location: form.location,
            max_power: form.max_power,
          })
          .eq('id', editId);
        if (error) throw error;
        setMessage('充电桩信息已更新');
      } else {
        const { error } = await supabase
          .from('charging_stations')
          .insert({
            station_number: form.station_number,
            mode: form.mode,
            location: form.location,
            max_power: form.max_power,
            status: 'available',
            current_voltage: 0,
            current_current: 0,
            current_power: 0,
            cumulative_energy: 0,
            temperature: 25,
            last_maintenance_at: new Date().toISOString(),
          });
        if (error) throw error;
        setMessage('充电桩已添加');
      }

      setShowForm(false);
      setEditId(null);
      loadStations();
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('操作失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleOffline(id: string) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('charging_stations')
        .update({ status: 'offline' })
        .eq('id', id);
      if (error) throw error;
      setStations(prev => prev.map(s => s.id === id ? { ...s, status: 'offline' } : s));
      setMessage('充电桩已下线');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('操作失败: ' + err.message);
    }
  }

  async function handleOnline(id: string) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('charging_stations')
        .update({ status: 'available' })
        .eq('id', id);
      if (error) throw error;
      setStations(prev => prev.map(s => s.id === id ? { ...s, status: 'available' } : s));
      setMessage('充电桩已上线');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('操作失败: ' + err.message);
    }
  }

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">充电桩信息管理 (UM09)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · {stations.length} 个充电桩</p>

      {message && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg">{message}</div>}

      <div className="mb-4">
        <button onClick={showForm ? () => setShowForm(false) : openAddForm}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          {showForm ? '取消' : '+ 添加充电桩'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow p-6 mb-4 max-w-lg">
          <h3 className="font-semibold mb-4">{editId ? '编辑充电桩' : '添加新充电桩'}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">桩编号</label>
              <input type="text" value={form.station_number} onChange={e => setForm({ ...form, station_number: e.target.value })}
                placeholder="如: F-004" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">充电模式</label>
              <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500">
                <option value="fast">快充</option>
                <option value="slow">慢充</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">位置</label>
              <input type="text" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                placeholder="如: 东校区C区1号" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">最大功率 (kW)</label>
              <input type="number" value={form.max_power} onChange={e => setForm({ ...form, max_power: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
              {saving ? '保存中...' : editId ? '保存修改' : '添加'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-4 font-medium text-gray-600">编号</th>
              <th className="text-left p-4 font-medium text-gray-600">模式</th>
              <th className="text-left p-4 font-medium text-gray-600">最大功率</th>
              <th className="text-left p-4 font-medium text-gray-600">位置</th>
              <th className="text-left p-4 font-medium text-gray-600">状态</th>
              <th className="text-right p-4 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {stations.map(s => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="p-4 font-mono font-bold">{s.station_number}</td>
                <td className="p-4">{s.mode === 'fast' ? '快充' : '慢充'}</td>
                <td className="p-4">{s.max_power} kW</td>
                <td className="p-4">{s.location}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    s.status === 'available' ? 'bg-green-100 text-green-700' :
                    s.status === 'charging' ? 'bg-yellow-100 text-yellow-700' :
                    s.status === 'fault' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {s.status === 'available' ? '可用' : s.status === 'charging' ? '充电中' : s.status === 'fault' ? '故障' : '离线'}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => openEditForm(s)}
                      className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">编辑</button>
                    {s.status === 'offline' ? (
                      <button onClick={() => handleOnline(s.id)}
                        className="px-3 py-1.5 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">上线</button>
                    ) : (
                      <button onClick={() => handleOffline(s.id)}
                        className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">下线</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {stations.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-gray-400">暂无充电桩数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
