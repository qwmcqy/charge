'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

const defaultConfig: Record<string, number | boolean | string> = {
  fastChargeRate: 1.2,
  slowChargeRate: 0.8,
  parkingRatePerMinute: 0.1,
  parkingGracePeriodMinutes: 15,
  fastQueueMaxSize: 20,
  slowQueueMaxSize: 30,
  waitingQueueMaxSize: 50,
  avgFastChargeMinutes: 40,
  avgSlowChargeMinutes: 180,
  overtimeThresholdMinutes: 30,
  autoAuditEnabled: false,
};

export default function ConfigPage() {
  const [config, setConfig] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { loadConfig(); }, []);

  async function loadConfig() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('system_configs')
        .select('*');

      if (error) throw error;

      const cfg: Record<string, any> = { ...defaultConfig };
      if (data) {
        for (const row of data) {
          cfg[row.key] = typeof row.value === 'object' && row.value !== null
            ? (row.value as any).v ?? row.value
            : row.value;
        }
      }
      setConfig(cfg);
    } catch {
      setConfig({ ...defaultConfig });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const entries = Object.entries(config).map(([key, value]) => ({
        key,
        value: { v: value },
        updated_by: user?.id,
      }));

      for (const entry of entries) {
        await supabase
          .from('system_configs')
          .upsert({
            key: entry.key,
            value: entry.value,
            updated_by: entry.updated_by,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key' });
      }

      setMessage('配置已保存到数据库');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function updateConfig(key: string, value: any) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return <div className="flex justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">系统参数配置 (UM08)</h2>
      <p className="text-xs text-gray-400 mb-6">数据来源: Supabase · system_configs 表</p>

      {message && <div className={`mb-4 p-3 border rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>{message}</div>}

      <div className="bg-white rounded-xl shadow p-6 space-y-6 max-w-2xl">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">快充费率 (元/kWh)</label>
            <input type="number" step="0.1" value={config.fastChargeRate ?? 1.2}
              onChange={e => updateConfig('fastChargeRate', Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">慢充费率 (元/kWh)</label>
            <input type="number" step="0.1" value={config.slowChargeRate ?? 0.8}
              onChange={e => updateConfig('slowChargeRate', Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">停车费率 (元/分钟)</label>
            <input type="number" step="0.01" value={config.parkingRatePerMinute ?? 0.1}
              onChange={e => updateConfig('parkingRatePerMinute', Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">停车宽限期 (分钟)</label>
            <input type="number" value={config.parkingGracePeriodMinutes ?? 15}
              onChange={e => updateConfig('parkingGracePeriodMinutes', Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">快充队列上限</label>
            <input type="number" value={config.fastQueueMaxSize ?? 20}
              onChange={e => updateConfig('fastQueueMaxSize', Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">慢充队列上限</label>
            <input type="number" value={config.slowQueueMaxSize ?? 30}
              onChange={e => updateConfig('slowQueueMaxSize', Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">等候队列上限</label>
            <input type="number" value={config.waitingQueueMaxSize ?? 50}
              onChange={e => updateConfig('waitingQueueMaxSize', Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">超时提醒阈值 (分钟)</label>
            <input type="number" value={config.overtimeThresholdMinutes ?? 30}
              onChange={e => updateConfig('overtimeThresholdMinutes', Number(e.target.value))}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={!!config.autoAuditEnabled}
                onChange={e => updateConfig('autoAuditEnabled', e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="text-sm text-gray-700">启用自动审核</span>
            </label>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving}
          className="px-8 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition">
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  );
}
