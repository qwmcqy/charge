'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

type ChargeMode = 'fast' | 'slow';

export default function ChargePage() {
  const router = useRouter();
  const [mode, setMode] = useState<ChargeMode>('fast');
  const [batteryLevel, setBatteryLevel] = useState(30);
  const [targetLevel, setTargetLevel] = useState(80);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    async function getUser() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) setUserId(user.id);
      } catch {}
      setCheckingAuth(false);
    }
    getUser();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!userId) {
      setError('登录状态已过期，请重新登录');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/charging/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, mode, batteryLevel, targetLevel }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '提交失败');

      setResult(data);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || '提交失败');
    } finally {
      setLoading(false);
    }
  }

  if (submitted && result) {
    const isDirectCharge = result.directCharge;

    return (
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-6">充电请求已提交 (UC01)</h2>
        <div className="bg-white rounded-xl shadow p-8 text-center">
          <div className="text-6xl mb-4">{isDirectCharge ? '⚡' : '⏳'}</div>
          <h3 className={`text-xl font-semibold mb-2 ${isDirectCharge ? 'text-green-700' : 'text-blue-700'}`}>
            {isDirectCharge ? '充电桩已分配，正在开始充电！' : '已加入充电队列，等待分配充电桩'}
          </h3>
          <p className="text-xs text-gray-400 mb-4">订单ID: {result.orderId}</p>

          <div className="grid grid-cols-2 gap-4 mt-6 text-left">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">充电模式</p>
              <p className="text-lg font-bold">{result.mode === 'fast' ? '⚡ 快充' : '🔋 慢充'}</p>
            </div>
            {isDirectCharge ? (
              <div className="p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-gray-500">分配充电桩</p>
                <p className="text-lg font-bold text-green-700">{result.stationNumber || '已分配'}</p>
              </div>
            ) : (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">排队位置</p>
                <p className="text-lg font-bold">
                  {result.isOverflow ? `等候队列第 ${result.position || '-'} 位` : `第 ${result.position || '-'} 位`}
                </p>
              </div>
            )}
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">目标电量</p>
              <p className="text-lg font-bold">{result.batteryLevel}% → {result.targetLevel}%</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">{isDirectCharge ? '状态' : '预计等待'}</p>
              <p className="text-lg font-bold">
                {isDirectCharge ? '充电中' : `${result.estimatedWaitMinutes || '-'} 分钟`}
              </p>
            </div>
          </div>

          <div className="flex gap-3 mt-6 justify-center">
            <button onClick={() => { setSubmitted(false); setResult(null); }}
              className="px-6 py-2.5 border border-gray-300 text-gray-600 rounded-lg font-medium hover:bg-gray-50 transition">
              发起新请求
            </button>
            {isDirectCharge ? (
              <button onClick={() => router.push('/user/dashboard')}
                className="px-6 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition">
                查看充电进度
              </button>
            ) : (
              <button onClick={() => router.push('/user/queue')}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition">
                查看排队状态
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-6">发起充电请求 (UC01)</h2>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-6 space-y-6 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">充电模式</label>
          <div className="grid grid-cols-2 gap-4">
            {(['fast', 'slow'] as ChargeMode[]).map(m => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`p-4 rounded-xl border-2 text-center transition ${mode === m ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="text-3xl mb-1">{m === 'fast' ? '⚡' : '🔋'}</div>
                <p className="font-semibold">{m === 'fast' ? '快充' : '慢充'}</p>
                <p className="text-xs text-gray-500 mt-1">{m === 'fast' ? '约40分钟充满' : '约3小时充满'}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">当前电量: {batteryLevel}%</label>
          <input type="range" min="0" max="100" value={batteryLevel} onChange={e => setBatteryLevel(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600" />
          <div className="flex justify-between text-xs text-gray-400 mt-1"><span>0%</span><span>50%</span><span>100%</span></div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">目标电量: {targetLevel}%</label>
          <input type="range" min={batteryLevel + 5} max="100" value={targetLevel} onChange={e => setTargetLevel(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-green-600" />
          <div className="flex justify-between text-xs text-gray-400 mt-1"><span>{batteryLevel + 5}%</span><span>75%</span><span>100%</span></div>
        </div>

        <button type="submit" disabled={loading || checkingAuth}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition">
          {checkingAuth ? '正在验证登录状态...' : loading ? '提交中...' : '发起充电请求'}
        </button>

        <p className="text-xs text-gray-400 text-center">
          有空闲充电桩时立即充电，无空闲时自动排队等待
        </p>
      </form>
    </div>
  );
}
