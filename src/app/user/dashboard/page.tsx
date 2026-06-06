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

interface OrderWithDetails {
  order: any;
  station: any;
  parking: ParkingStatus | null;
}

export default function UserDashboard() {
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [departLoading, setDepartLoading] = useState<string | null>(null);
  const [faultLoading, setFaultLoading] = useState(false);
  const [faultDecisionLoading, setFaultDecisionLoading] = useState(false);
  const [message, setMessage] = useState('');

  const lastOrdersRef = useRef<string>('');
  const isFetchingRef = useRef(false);

  const loadData = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (lastOrdersRef.current !== '') {
          setOrders([]);
          lastOrdersRef.current = '';
        }
        setLoading(false);
        return;
      }

      // 拉取该用户所有相关订单（不限1条）
      const { data: orderList } = await supabase
        .from('charging_orders')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['charging', 'paused', 'fault_pending', 'completed'])
        .order('created_at', { ascending: false });

      if (!orderList || orderList.length === 0) {
        if (lastOrdersRef.current !== '[]') {
          setOrders([]);
          lastOrdersRef.current = '[]';
        }
        setLoading(false);
        return;
      }

      // 为每个订单加载桩信息和停车状态
      const enriched: OrderWithDetails[] = [];
      for (const o of orderList) {
        const order = o as any;
        let station = null;
        let parking: ParkingStatus | null = null;

        if (order.station_id) {
          const { data: st } = await supabase
            .from('charging_stations')
            .select('*')
            .eq('id', order.station_id)
            .maybeSingle();
          station = st;
        }

        if (order.status === 'completed') {
          try {
            const res = await fetch(`/api/charging/${order.id}/parking-status`);
            const pData = await res.json();
            if (res.ok && pData) parking = pData;
          } catch { parking = null; }
        }

        enriched.push({ order, station, parking });
      }

      // 排序：充电中/暂停/故障待处理优先，再按时间倒序
      const priority = (s: string) => {
        if (s === 'fault_pending') return 0;
        if (s === 'charging') return 1;
        if (s === 'paused') return 2;
        if (s === 'completed') return 3;
        return 4;
      };
      enriched.sort((a, b) => {
        const pa = priority(a.order.status);
        const pb = priority(b.order.status);
        if (pa !== pb) return pa - pb;
        return new Date(b.order.created_at).getTime() - new Date(a.order.created_at).getTime();
      });

      const newKey = JSON.stringify(enriched.map(e => ({ id: e.order.id, status: e.order.status, parked: e.parking?.parked })));
      if (lastOrdersRef.current !== newKey) {
        setOrders(enriched);
        lastOrdersRef.current = newKey;
      }
    } catch {
      // keep last state
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData();
      fetch('/api/charging/simulate', { method: 'POST' }).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [loadData]);

  // 按状态分组
  const faultOrders = orders.filter(o => o.order.status === 'fault_pending');
  const chargingOrders = orders.filter(o => o.order.status === 'charging' || o.order.status === 'paused');
  const parkedOrders = orders.filter(o => o.order.status === 'completed' && o.parking?.parked);
  const otherCompleted = orders.filter(o => o.order.status === 'completed' && !o.parking?.parked);

  // ── 操作函数 ──
  async function handleAction(orderId: string, action: 'pause' | 'resume' | 'end') {
    setActionLoading(true);
    setMessage('');
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('请先登录');

      const endpoint = action === 'end'
        ? `/api/charging/${orderId}/end`
        : `/api/charging/${orderId}/${action}`;
      const body = action === 'end' ? { userId: user.id } : undefined;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '操作失败');

      setMessage(action === 'end' ? '充电已结束' : action === 'pause' ? '已暂停' : '已恢复');
      loadData();
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage(err.message || '操作失败');
    } finally { setActionLoading(false); }
  }

  async function handleDepart(orderId: string) {
    setDepartLoading(orderId);
    setMessage('');
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('请先登录');

      const res = await fetch(`/api/charging/${orderId}/depart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '操作失败');

      const ot = result.overtimeMinutes > 0
        ? `，超时 ${result.overtimeMinutes} 分钟，停车费 ¥${result.parkingFee.toFixed(2)}`
        : '，未超时无需停车费';
      setMessage(`已离开！账单 ¥${result.totalAmount.toFixed(2)}${ot}`);
      loadData();
      setTimeout(() => setMessage(''), 5000);
    } catch (err: any) {
      setMessage(err.message || '操作失败');
    } finally { setDepartLoading(null); }
  }

  async function handleSimulateFault(orderId: string) {
    setFaultLoading(true);
    setMessage('');
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('请先登录');

      const res = await fetch(`/api/charging/${orderId}/simulate-fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '操作失败');
      setMessage('故障已触发！');
      loadData();
      setTimeout(() => setMessage(''), 5000);
    } catch (err: any) {
      setMessage(err.message || '操作失败');
    } finally { setFaultLoading(false); }
  }

  async function handleFaultDecision(orderId: string, decision: 'end' | 'requeue') {
    setFaultDecisionLoading(true);
    setMessage('');
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('请先登录');

      const res = await fetch(`/api/charging/${orderId}/fault-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, decision }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '操作失败');

      setMessage(decision === 'end' ? '充电已终止' : '已插入队列第一位！');
      loadData();
      setTimeout(() => setMessage(''), 5000);
    } catch (err: any) {
      setMessage(err.message || '操作失败');
    } finally { setFaultDecisionLoading(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center p-12">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>;
  }

  // ── 没有订单 ──
  if (orders.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">充电实时监控 (UC04)</h2>
        <p className="text-xs text-gray-400 mb-6">数据每2秒自动刷新</p>
        {message && <div className={`mb-4 p-3 border rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>{message}</div>}
        <div className="bg-white rounded-xl shadow p-8 text-center">
          <div className="text-5xl mb-4">🔋</div>
          <p className="text-gray-500 mb-4">当前没有进行中的充电订单</p>
          <a href="/user/charge" className="inline-block px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition">
            发起充电请求
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">充电实时监控 (UC04)</h2>
      <p className="text-xs text-gray-400 mb-2">
        数据每2秒自动刷新{orders.length > 1 ? ` · ${orders.length} 个订单` : ''}
      </p>

      {message && <div className={`mb-4 p-3 border rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>{message}</div>}

      <div className="space-y-6">

        {/* ═══ 故障待处理 ═══ */}
        {faultOrders.map(o => (
          <FaultPendingCard
            key={o.order.id}
            order={o.order}
            station={o.station}
            loading={faultDecisionLoading}
            onDecision={(d) => handleFaultDecision(o.order.id, d)}
          />
        ))}

        {/* ═══ 充电中 / 暂停 ═══ */}
        {chargingOrders.map(o => (
          <ChargingCard
            key={o.order.id}
            order={o.order}
            station={o.station}
            actionLoading={actionLoading}
            faultLoading={faultLoading}
            onAction={(a) => handleAction(o.order.id, a)}
            onSimulateFault={() => handleSimulateFault(o.order.id)}
          />
        ))}

        {/* ═══ 已充电完成 + 停车中 ═══ */}
        {parkedOrders.map(o => (
          <ParkedCard
            key={o.order.id}
            order={o.order}
            station={o.station}
            parking={o.parking!}
            departLoading={departLoading === o.order.id}
            onDepart={() => handleDepart(o.order.id)}
          />
        ))}

        {/* ═══ 已离场/无停车记录 ═══ */}
        {otherCompleted.length > 0 && (
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-semibold text-gray-600 mb-3">
              已完成 ({otherCompleted.length})
            </h3>
            <div className="space-y-2">
              {otherCompleted.map(o => (
                <div key={o.order.id} className="flex justify-between items-center text-sm text-gray-500">
                  <span>{o.station?.station_number || '—'} · {o.order.mode === 'fast' ? '快充' : '慢充'}</span>
                  <span>{o.order.energy_consumed?.toFixed(1)}kWh · {o.order.status === 'completed' ? '已完成' : o.order.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════
// 子组件
// ══════════════════════════════════════

function FaultPendingCard({ order, station, loading, onDecision }: {
  order: any; station: any; loading: boolean;
  onDecision: (d: 'end' | 'requeue') => void;
}) {
  return (
    <div>
      <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6 mb-6 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h3 className="text-xl font-bold text-red-700 mb-2">充电桩故障</h3>
        <p className="text-red-600 mb-2">充电过程中检测到充电桩异常，已自动中断充电</p>
        <p className="text-sm text-gray-500">请选择以下方式处理：</p>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <button onClick={() => onDecision('end')} disabled={loading}
          className="p-6 bg-white rounded-xl shadow border-2 border-gray-200 hover:border-red-300 transition text-center disabled:opacity-50">
          <div className="text-3xl mb-2">🛑</div>
          <div className="font-semibold mb-1">结束充电</div>
          <div className="text-xs text-gray-400">按已充电量计费</div>
        </button>
        <button onClick={() => onDecision('requeue')} disabled={loading}
          className="p-6 bg-white rounded-xl shadow border-2 border-blue-300 hover:border-blue-500 transition text-center disabled:opacity-50">
          <div className="text-3xl mb-2">⚡</div>
          <div className="font-semibold text-blue-700 mb-1">优先排队</div>
          <div className="text-xs text-gray-400">插入队列第一位，恢复正常后优先充电</div>
        </button>
      </div>
      {loading && <div className="text-center text-sm text-gray-400">处理中...</div>}
      <OrderInfo order={order} station={station} />
    </div>
  );
}

function ChargingCard({ order, station, actionLoading, faultLoading, onAction, onSimulateFault }: {
  order: any; station: any; actionLoading: boolean; faultLoading: boolean;
  onAction: (a: 'pause' | 'resume' | 'end') => void;
  onSimulateFault: () => void;
}) {
  const startTime = order.start_time ? new Date(order.start_time) : new Date();
  const durationMinutes = Math.floor((Date.now() - startTime.getTime()) / 60000);
  const batteryLevel = order.status === 'paused' ? order.target_battery_level : (
    Math.min(order.target_battery_level, order.request_battery_level + (order.energy_consumed / 60) * 100)
  );
  const remainingEnergy = Math.max(0, (order.target_battery_level - batteryLevel) / 100 * 60);
  const power = station?.current_power || (order.mode === 'fast' ? 45 : 7);
  const estimatedRemainingMinutes = power > 0 ? Math.ceil(remainingEnergy / power * 60) : 0;

  return (
    <div>
      {order.status === 'paused' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-yellow-700 text-sm font-medium mb-4">
          充电已暂停 — 点击"恢复充电"继续
        </div>
      )}

      {/* Metrics */}
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

      <OrderInfo order={order} station={station} durationMinutes={durationMinutes} />

      {/* Buttons */}
      {order.status === 'charging' && (
        <div className="flex gap-4 flex-wrap mt-4">
          <button onClick={() => onAction('pause')} disabled={actionLoading || faultLoading}
            className="px-6 py-2.5 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600 disabled:opacity-50 transition">
            {actionLoading ? '...' : '暂停充电'}
          </button>
          <button onClick={() => onAction('end')} disabled={actionLoading || faultLoading}
            className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition">
            {actionLoading ? '...' : '结束充电'}
          </button>
          <button onClick={onSimulateFault} disabled={faultLoading || actionLoading}
            className="px-6 py-2.5 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 transition">
            ⚡ 模拟故障
          </button>
          {estimatedRemainingMinutes > 0 && (
            <span className="self-center text-sm text-gray-500">预计剩余 {estimatedRemainingMinutes} 分钟</span>
          )}
        </div>
      )}
      {order.status === 'paused' && (
        <div className="flex gap-4 flex-wrap mt-4">
          <button onClick={() => onAction('resume')} disabled={actionLoading || faultLoading}
            className="px-6 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition">
            恢复充电
          </button>
          <button onClick={() => onAction('end')} disabled={actionLoading || faultLoading}
            className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition">
            结束充电
          </button>
          <button onClick={onSimulateFault} disabled={faultLoading || actionLoading}
            className="px-6 py-2.5 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 transition">
            ⚡ 模拟故障
          </button>
        </div>
      )}
    </div>
  );
}

function ParkedCard({ order, station, parking, departLoading, onDepart }: {
  order: any; station: any; parking: ParkingStatus; departLoading: boolean;
  onDepart: () => void;
}) {
  const isOvertime = parking.isOvertime ?? (parking.overtimeMinutes ?? 0) > 0;

  return (
    <div className={`rounded-xl p-6 ${isOvertime ? 'bg-red-50 border-2 border-red-300' : 'bg-green-50 border-2 border-green-300'}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{isOvertime ? '⏰' : '✅'}</span>
            <h3 className={`text-xl font-bold ${isOvertime ? 'text-red-700' : 'text-green-700'}`}>
              充电已完成
            </h3>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {station?.station_number || '—'} · {order.mode === 'fast' ? '快充' : '慢充'} · 目标 {order.target_battery_level}%
          </p>
        </div>
        <button onClick={onDepart} disabled={departLoading}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition whitespace-nowrap">
          {departLoading ? '处理中...' : '🚗 已离开'}
        </button>
      </div>

      {/* Parking timer */}
      <div className="bg-white rounded-lg p-4">
        <p className="text-sm text-gray-500 mb-2">停车计时中</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold text-gray-800">{parking.elapsedMinutes ?? 0}</p>
            <p className="text-xs text-gray-400">已停分钟</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${(parking.graceRemainingMinutes ?? 0) <= 0 ? 'text-red-600' : 'text-green-600'}`}>
              {(parking.graceRemainingMinutes ?? 0) <= 0 ? 0 : parking.graceRemainingMinutes}
            </p>
            <p className="text-xs text-gray-400">宽限剩余(分)</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${isOvertime ? 'text-red-600' : 'text-gray-800'}`}>
              ¥{parking.parkingFee?.toFixed(2) || '0.00'}
            </p>
            <p className="text-xs text-gray-400">超时费</p>
          </div>
        </div>
        {isOvertime && (
          <p className="text-xs text-red-600 mt-3 text-center">
            已超宽限期！超时 {parking.overtimeMinutes} 分钟，¥{parking.ratePerMinute}/分钟
          </p>
        )}
        {!isOvertime && (parking.graceRemainingMinutes ?? 0) > 0 && (
          <p className="text-xs text-gray-400 mt-3 text-center">
            宽限期 {parking.gracePeriodMinutes} 分钟，超时后 ¥{parking.ratePerMinute}/分钟
          </p>
        )}
      </div>
    </div>
  );
}

function OrderInfo({ order, station, durationMinutes }: { order: any; station: any; durationMinutes?: number }) {
  return (
    <div className="grid grid-cols-3 gap-4 mb-4">
      {[
        { label: '充电桩编号', value: station?.station_number || '—' },
        { label: '充电模式', value: order.mode === 'fast' ? '快充' : '慢充' },
        { label: '目标电量', value: `${order.target_battery_level}%` },
      ].map(info => (
        <div key={info.label} className="bg-white rounded-xl shadow p-4">
          <p className="text-sm text-gray-500">{info.label}</p>
          <p className="text-lg font-semibold">{info.value}</p>
        </div>
      ))}
    </div>
  );
}
