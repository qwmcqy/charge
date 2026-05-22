'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase';

interface ParkingStatus {
  parked: boolean;
  status?: string;
  chargeCompleteTime?: string;
  elapsedMinutes?: number;
  gracePeriodMinutes?: number;
  graceRemainingMinutes?: number;
  isOvertime?: boolean;
  overtimeMinutes?: number;
  parkingFee?: number;
  ratePerMinute?: number;
}

export default function UserDashboard() {
  const [order, setOrder] = useState<any>(null);
  const [station, setStation] = useState<any>(null);
  const [parking, setParking] = useState<ParkingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [departLoading, setDepartLoading] = useState(false);
  const [faultLoading, setFaultLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  // 新增：缓存上一次的状态，用于对比是否真的变化
  const lastStateRef = useRef({
    order: null,
    station: null,
    parking: null
  });
  // 新增：异步锁，防止重复查询
  const isFetchingRef = useRef(false);

  const loadData = useCallback(async () => {
    // 防止前一次查询未完成就发起新查询
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { 
        // 只有缓存状态有值时才更新，避免无意义重渲染
        if (lastStateRef.current.order !== null) {
          setOrder(null);
          setStation(null);
          setParking(null);
          lastStateRef.current = { order: null, station: null, parking: null };
        }
        setLoading(false);
        return;
      }

      // Query for active orders: charging, paused, or recently completed
      const { data: orderData } = await supabase
        .from('charging_orders')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['charging', 'paused', 'completed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let newOrder = null;
      let newStation = null;
      let newParking = null;

      if (orderData) {
        newOrder = orderData;

        // Load station data
        if (orderData.station_id) {
          const { data: stationData } = await supabase
            .from('charging_stations')
            .select('*')
            .eq('id', orderData.station_id)
            .single();
          newStation = stationData;
        }

        // For completed orders, check parking status
        if (orderData.status === 'completed') {
          try {
            const res = await fetch(`/api/charging/${orderData.id}/parking-status`);
            const pData = await res.json();
            if (res.ok) {
              newParking = pData;
              // 优化：仅当明确标记为已离开/已支付时才清空，避免频繁切换
              // 增加判断：只有 parking 状态有效时才清空，防止接口返回异常导致的闪动
              if (pData && (pData.status === 'departed' || pData.status === 'paid' || !pData.parked)) {
                newOrder = null;
                newStation = null;
                newParking = null;
              }
            }
          } catch {
            newParking = null;
            // 异常时保留订单状态，避免清空导致闪动
            newOrder = orderData;
          }
        } else {
          newParking = null;
        }
      } else {
        newOrder = null;
        newStation = null;
        newParking = null;
      }

      // 核心：只有状态真的变化时才更新，避免无意义重渲染
      const stateChanged = 
        JSON.stringify(lastStateRef.current.order) !== JSON.stringify(newOrder) ||
        JSON.stringify(lastStateRef.current.station) !== JSON.stringify(newStation) ||
        JSON.stringify(lastStateRef.current.parking) !== JSON.stringify(newParking);

      if (stateChanged) {
        setOrder(newOrder);
        setStation(newStation);
        setParking(newParking);
        // 更新缓存
        lastStateRef.current = {
          order: newOrder,
          station: newStation,
          parking: newParking
        };
      }
    } catch (err) {
      console.error('Load data error:', err);
      // 出错时保留上一次状态，避免清空导致闪动
    } finally {
      setLoading(false);
      isFetchingRef.current = false; // 释放异步锁
    }
  }, []);

  useEffect(() => {
    // 初始化加载
    loadData();
    
    // 优化定时器：保留2秒刷新，但通过缓存减少状态更新
    const interval = setInterval(() => {
      loadData();
      // Drive simulation tick - 不影响页面状态，保留
      fetch('/api/charging/simulate', { method: 'POST' }).catch(() => {});
    }, 2000);
    
    return () => clearInterval(interval);
  }, [loadData]);

  async function handleAction(action: 'pause' | 'resume' | 'end') {
    if (!order) return;
    setActionLoading(true);
    setMessage('');

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('请先登录');

      const endpoint = action === 'end'
        ? `/api/charging/${order.id}/end`
        : `/api/charging/${order.id}/${action}`;

      const body = action === 'end' ? { userId: user.id } : undefined;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || '操作失败');

      if (action === 'end') {
        setMessage('充电已结束，请在离开时点击"已离开"按钮');
      } else if (action === 'pause') {
        setMessage('充电已暂停');
      } else {
        setMessage('充电已恢复');
      }

      // 操作后强制刷新，但仍会通过缓存判断是否更新状态
      loadData();
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage(err.message || '操作失败');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDepart() {
    if (!order) return;
    setDepartLoading(true);
    setMessage('');

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('请先登录');

      const res = await fetch(`/api/charging/${order.id}/depart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || '操作失败');

      const overtimeInfo = result.overtimeMinutes > 0
        ? `，超时 ${result.overtimeMinutes} 分钟，停车费 ¥${result.parkingFee.toFixed(2)}`
        : '，未超时无需停车费';

      setMessage(`已离开！账单已生成（合计 ¥${result.totalAmount.toFixed(2)}${overtimeInfo}）`);
      // 手动清空状态并更新缓存
      setParking(null);
      setOrder(null);
      setStation(null);
      lastStateRef.current = { order: null, station: null, parking: null };
      setTimeout(() => setMessage(''), 5000);
    } catch (err: any) {
      setMessage(err.message || '操作失败');
    } finally {
      setDepartLoading(false);
    }
  }

  async function handleSimulateFault() {
    if (!order) return;
    setFaultLoading(true);
    setMessage('');

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('请先登录');

      const res = await fetch(`/api/charging/${order.id}/simulate-fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || '操作失败');

      setMessage('模拟故障已触发！充电已停止，请查看通知');
      setOrder(null);
      setStation(null);
      setParking(null);
      lastStateRef.current = { order: null, station: null, parking: null };
      setTimeout(() => setMessage(''), 5000);
    } catch (err: any) {
      setMessage(err.message || '操作失败');
    } finally {
      setFaultLoading(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center p-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  // ====== STATE: No active order ======
  if (!order) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">充电实时监控 (UC04)</h2>
        <p className="text-xs text-gray-400 mb-6">数据每2秒自动刷新</p>

        {message && <div className={`mb-4 p-3 border rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>{message}</div>}

        <div className="bg-white rounded-xl shadow p-8 text-center">
          <div className="text-5xl mb-4">🔋</div>
          <p className="text-gray-500 mb-4">当前没有进行中的充电订单</p>
          <a href="/user/charge"
            className="inline-block px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition">
            发起充电请求
          </a>
        </div>
      </div>
    );
  }

  // Calculate battery progress (for charging/paused states)
  let batteryLevel = 0;
  let durationMinutes = 0;
  let estimatedRemainingMinutes = 0;

  if (order.status === 'charging' || order.status === 'paused') {
    const startTime = order.start_time ? new Date(order.start_time) : new Date();
    durationMinutes = Math.floor((Date.now() - startTime.getTime()) / 60000);
    batteryLevel = Math.min(
      order.target_battery_level,
      order.request_battery_level + (order.energy_consumed / 60) * 100
    );
    if (order.status === 'charging') {
      const remainingEnergy = Math.max(0, (order.target_battery_level - batteryLevel) / 100 * 60);
      const power = station?.current_power || (order.mode === 'fast' ? 45 : 7);
      estimatedRemainingMinutes = power > 0 ? Math.ceil(remainingEnergy / power * 60) : 0;
    }
  } else if (order.status === 'completed') {
    const startTime = order.start_time ? new Date(order.start_time) : new Date();
    durationMinutes = Math.floor((Date.now() - startTime.getTime()) / 60000);
    batteryLevel = order.target_battery_level;
  }

  // ====== STATE: Completed - awaiting departure ======
  if (order.status === 'completed' && parking?.parked) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">充电实时监控 (UC04)</h2>
        <p className="text-xs text-gray-400 mb-6">数据每2秒自动刷新</p>

        {message && <div className={`mb-4 p-3 border rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>{message}</div>}

        {/* Charging complete banner */}
        <div className={`rounded-xl p-6 mb-6 ${parking.isOvertime ? 'bg-red-50 border-2 border-red-300' : 'bg-green-50 border-2 border-green-300'}`}>
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">{parking.isOvertime ? '⏰' : '✅'}</div>
            <h3 className={`text-xl font-bold ${parking.isOvertime ? 'text-red-700' : 'text-green-700'}`}>
              充电已完成！
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              目标电量 {order.target_battery_level}% 已达成
            </p>
          </div>

          {/* Parking timer */}
          <div className="bg-white rounded-lg p-4 max-w-md mx-auto">
            <p className="text-sm text-gray-500 mb-2 text-center">停车计时中</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-gray-800">{parking.elapsedMinutes}</p>
                <p className="text-xs text-gray-400">已停分钟</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${(parking.graceRemainingMinutes ?? 0) <= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {(parking.graceRemainingMinutes ?? 0) <= 0 ? 0 : parking.graceRemainingMinutes}
                </p>
                <p className="text-xs text-gray-400">宽限剩余(分钟)</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${parking.isOvertime ? 'text-red-600' : 'text-gray-800'}`}>
                  ¥{parking.parkingFee?.toFixed(2) || '0.00'}
                </p>
                <p className="text-xs text-gray-400">超时费</p>
              </div>
            </div>
            {parking.isOvertime && (
              <p className="text-xs text-red-600 mt-3 text-center">
                已超宽限期！超时 {parking.overtimeMinutes} 分钟，停车费 ¥{parking.ratePerMinute}/分钟
              </p>
            )}
            {!parking.isOvertime && (parking.graceRemainingMinutes ?? 0) > 0 && (
              <p className="text-xs text-gray-400 mt-3 text-center">
                宽限期 {parking.gracePeriodMinutes} 分钟，超时后 ¥{parking.ratePerMinute}/分钟
              </p>
            )}
          </div>
        </div>

        {/* Order summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: '充电桩编号', value: station?.station_number || '—' },
            { label: '充电模式', value: order.mode === 'fast' ? '快充' : '慢充' },
            { label: '已充时长', value: `${durationMinutes} 分钟` },
          ].map(info => (
            <div key={info.label} className="bg-white rounded-xl shadow p-4">
              <p className="text-sm text-gray-500">{info.label}</p>
              <p className="text-lg font-semibold">{info.value}</p>
            </div>
          ))}
        </div>

        {/* Depart button */}
        <button onClick={handleDepart} disabled={departLoading}
          className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium text-lg hover:bg-blue-700 disabled:opacity-50 transition">
          {departLoading ? '处理中...' : '🚗 已离开（结束停车计时并生成账单）'}
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          请在离开充电桩后点击此按钮，系统将按实际停车时间计算超时费
        </p>
      </div>
    );
  }

  // ====== STATE: Charging or Paused ======
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">充电实时监控 (UC04)</h2>
      <p className="text-xs text-gray-400 mb-6">数据每2秒自动刷新</p>

      {message && <div className={`mb-4 p-3 border rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>{message}</div>}

      {/* Paused banner */}
      {order.status === 'paused' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-yellow-700 text-sm font-medium mb-4">
          充电已暂停 — 点击"恢复充电"继续
        </div>
      )}

      {/* Metrics cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: '电压', value: station?.current_voltage ? `${station.current_voltage.toFixed(0)} V` : '—', color: 'text-blue-600' },
          { label: '电流', value: station?.current_current ? `${station.current_current.toFixed(0)} A` : '—', color: 'text-green-600' },
          { label: '功率', value: station?.current_power ? `${station.current_power.toFixed(1)} kW` : '—', color: 'text-orange-600' },
          { label: '已消耗', value: `${order.energy_consumed?.toFixed(2) || '0.00'} kWh`, color: 'text-purple-600' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl shadow p-4">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="bg-white rounded-xl shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold">充电进度</h3>
          <span className="text-sm text-gray-500">目标 {order.target_battery_level}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div className={`h-4 rounded-full transition-all duration-1000 ${order.status === 'paused' ? 'bg-yellow-400' : 'bg-gradient-to-r from-green-400 to-green-600'}`}
            style={{ width: `${Math.min(100, (batteryLevel / order.target_battery_level) * 100)}%` }} />
        </div>
        <p className="text-center mt-2 text-lg font-bold">
          {batteryLevel.toFixed(0)}% {batteryLevel >= order.target_battery_level ? '✓ 已完成' : order.status === 'paused' ? '(已暂停)' : ''}
        </p>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: '充电桩编号', value: station?.station_number || '分配中...' },
          { label: '充电模式', value: order.mode === 'fast' ? '快充' : '慢充' },
          { label: '已充时长', value: `${durationMinutes} 分钟` },
        ].map(info => (
          <div key={info.label} className="bg-white rounded-xl shadow p-4">
            <p className="text-sm text-gray-500">{info.label}</p>
            <p className="text-lg font-semibold">{info.value}</p>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {order.status === 'charging' && (
        <div className="flex gap-4 flex-wrap">
          <button onClick={() => handleAction('pause')} disabled={actionLoading || faultLoading}
            className="px-6 py-2.5 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600 disabled:opacity-50 transition">
            {actionLoading ? '处理中...' : '暂停充电'}
          </button>
          <button onClick={() => handleAction('end')} disabled={actionLoading || faultLoading}
            className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition">
            {actionLoading ? '处理中...' : '结束充电'}
          </button>
          <button onClick={handleSimulateFault} disabled={faultLoading || actionLoading}
            className="px-6 py-2.5 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 transition">
            {faultLoading ? '故障触发中...' : '⚡ 模拟故障'}
          </button>
          {estimatedRemainingMinutes > 0 && (
            <span className="self-center text-sm text-gray-500">
              预计剩余 {estimatedRemainingMinutes} 分钟
            </span>
          )}
        </div>
      )}

      {order.status === 'paused' && (
        <div className="flex gap-4 flex-wrap">
          <button onClick={() => handleAction('resume')} disabled={actionLoading || faultLoading}
            className="px-6 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition">
            {actionLoading ? '处理中...' : '恢复充电'}
          </button>
          <button onClick={() => handleAction('end')} disabled={actionLoading || faultLoading}
            className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition">
            {actionLoading ? '处理中...' : '结束充电'}
          </button>
          <button onClick={handleSimulateFault} disabled={faultLoading || actionLoading}
            className="px-6 py-2.5 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 transition">
            {faultLoading ? '故障触发中...' : '⚡ 模拟故障'}
          </button>
        </div>
      )}
    </div>
  );
}
