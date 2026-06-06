/**
 * 校园充电站 — HTTP API 时间线测试
 *
 * 完全模拟真实用户行为：通过 fetch 调用项目 API 路由
 * 用户操作 → Next.js API → Service → Supabase
 * 间隔压缩到2分钟，体现排队压力
 */
import { createServiceClient } from '../src/lib/supabase';

const API = 'http://localhost:3000/api';
const supabase = createServiceClient();
const MAIN_USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const vehicles = new Map<string, string>();
const userIds = new Map<string, string>();
let currentTime = 0;

function timeStr(m: number) {
  return `${String(Math.floor(m / 60) + 6).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const headers = {
  'Content-Type': 'application/json',
  'x-service-key': SERVICE_KEY,
};

async function post(url: string, body?: any) {
  const res = await fetch(url, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

async function get(url: string) {
  const res = await fetch(url, { headers });
  return res.json();
}

async function advanceTime(deltaMinutes: number) {
  if (deltaMinutes <= 0) return;
  // 防并发：被锁跳过时等待重试
  for (let retry = 0; retry < 10; retry++) {
    const res = await post(`${API}/charging/simulate`);
    if (!res.skipped) return;
    await new Promise(r => setTimeout(r, 500));
  }
}

async function vehicleArrive(vid: string, mode: string, startPct: number, targetPct: number) {
  const uid = userIds.get(vid)!;
  const result = await post(`${API}/charging/request`, {
    userId: uid, mode, batteryLevel: startPct, targetLevel: targetPct,
  });
  if (result.error) { console.log(`  X ${vid}: ${result.error}`); return; }
  vehicles.set(vid, result.orderId);
  if (result.directCharge) {
    console.log(`  > ${vid} 充电 @ ${result.stationNumber} (${mode} ${startPct}%->${targetPct}%)`);
  } else {
    const label = result.isOverflow ? '等候' : (mode === 'fast' ? '快充' : '慢充');
    console.log(`  > ${vid} ${label}队列 #${result.position} (${mode} ${startPct}%->${targetPct}%)`);
  }
}

async function vehicleCancel(vid: string) {
  const orderId = vehicles.get(vid);
  if (!orderId) { console.log(`  > ${vid} 无活跃请求，跳过`); return; }
  const result = await post(`${API}/charging/${orderId}/cancel`, { userId: userIds.get(vid)! });
  if (result.error) { console.log(`  > ${vid} 取消失败: ${result.error}`); return; }
  console.log(`  > ${vid} 已取消`);
  vehicles.delete(vid);
}

async function payWithRetry(userId: string, billId: string, label: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const payRes = await post(`${API}/payment`, { userId, billId, method: 'wechat' });
    if (!payRes.error && payRes.success) return true;
    const reason = payRes.error || payRes.message || 'unknown payment failure';
    console.log(`    pay fail [${label}] attempt ${attempt}: ${reason}`);
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function triggerFault(targetVehicle: string) {
  const orderId = vehicles.get(targetVehicle);
  if (!orderId) { console.log(`  > ${targetVehicle} 无活跃订单`); return; }
  const faultResult = await post(`${API}/charging/${orderId}/simulate-fault`, { userId: userIds.get(targetVehicle)! });
  if (faultResult.error) { console.log(`  > ${targetVehicle} 故障触发失败: ${faultResult.error}`); return; }
  const decisionResult = await post(`${API}/charging/${orderId}/fault-decision`, {
    userId: userIds.get(targetVehicle)!, decision: 'requeue',
  });
  if (decisionResult.error) { console.log(`  > ${targetVehicle} 故障决策失败: ${decisionResult.error}`); return; }
  vehicles.set(targetVehicle, decisionResult.newOrderId);
  console.log(`  > FIRE ${targetVehicle} 故障 -> 优先排队 #1`);
}

type Event = {
  time: number;
  type: 'A' | 'O' | 'B' | 'P';
  vehicle?: string; mode?: string;
  startPct?: number; targetPct?: number;
  description: string;
};

const events: Event[] = [
  // === 06:00 5辆车同时到达占满全桩 ===
  { time: 0,  type: 'A', vehicle: 'V1',  mode: 'slow', startPct: 20, targetPct: 87, description: 'V1(主) 慢充 20->87' },
  { time: 0,  type: 'A', vehicle: 'V2',  mode: 'fast', startPct: 20, targetPct: 85, description: 'V2 快充 20->85' },
  { time: 0,  type: 'A', vehicle: 'V3',  mode: 'fast', startPct: 10, targetPct: 100, description: 'V3(主) 快充 10->100 停车演示' },
  { time: 0,  type: 'A', vehicle: 'V4',  mode: 'fast', startPct: 15, targetPct: 65, description: 'V4 快充 15->65' },
  { time: 0,  type: 'A', vehicle: 'V5',  mode: 'fast', startPct: 25, targetPct: 100, description: 'V5 快充 25->100 占满' },

  // === 06:06-06:12 FIRE 故障+继续涌入 ===
  { time: 4,  type: 'B', vehicle: 'V1',  description: 'FIRE V1慢充桩故障->优先排队#1' },
  { time: 4,  type: 'A', vehicle: 'V6',  mode: 'fast', startPct: 15, targetPct: 90,  description: 'V6 快充 15->90 进队列' },
  { time: 6,  type: 'B', vehicle: 'V4',  description: 'FIRE V4快充桩故障->优先排队#1' },
  { time: 6,  type: 'A', vehicle: 'V7',  mode: 'slow', startPct: 20, targetPct: 50,  description: 'V7 慢充 20->50' },

  // === 每2分钟涌入2-3辆，快速堆积队列 ===
  { time: 8,  type: 'A', vehicle: 'V8',  mode: 'fast', startPct: 10, targetPct: 85,  description: 'V8 快充 10->85' },
  { time: 8,  type: 'A', vehicle: 'V9',  mode: 'slow', startPct: 25, targetPct: 45,  description: 'V9 慢充 25->45' },
  { time: 10, type: 'A', vehicle: 'V10', mode: 'fast', startPct: 5,  targetPct: 100, description: 'V10 快充 5->100' },
  { time: 10, type: 'A', vehicle: 'V11', mode: 'fast', startPct: 30, targetPct: 40,  description: 'V11 快充 30->40' },
  { time: 10, type: 'A', vehicle: 'V12', mode: 'fast', startPct: 20, targetPct: 75,  description: 'V12 快充 20->75' },

  { time: 12, type: 'O', vehicle: 'V2',  description: 'V2 取消(如已完成则跳过)' },
  { time: 13, type: 'A', vehicle: 'V13', mode: 'fast', startPct: 15, targetPct: 80,  description: 'V13 快充 15->80' },
  { time: 13, type: 'A', vehicle: 'V14', mode: 'slow', startPct: 10, targetPct: 35,  description: 'V14 慢充 10->35' },

  { time: 15, type: 'A', vehicle: 'V15', mode: 'fast', startPct: 30, targetPct: 90,  description: 'V15 快充 30->90' },
  { time: 15, type: 'A', vehicle: 'V16', mode: 'fast', startPct: 25, targetPct: 70,  description: 'V16 快充 25->70' },
  { time: 15, type: 'O', vehicle: 'V7',  description: 'V7 取消(队列中)' },
  { time: 17, type: 'O', vehicle: 'V11', description: 'V11 取消(如已完成则跳过)' },

  { time: 18, type: 'A', vehicle: 'V17', mode: 'slow', startPct: 15, targetPct: 40,  description: 'V17 慢充 15->40' },
  { time: 18, type: 'A', vehicle: 'V18', mode: 'fast', startPct: 10, targetPct: 65,  description: 'V18 快充 10->65' },
  { time: 20, type: 'A', vehicle: 'V19', mode: 'fast', startPct: 20, targetPct: 55,  description: 'V19 快充 20->55' },
  { time: 20, type: 'A', vehicle: 'V20', mode: 'slow', startPct: 12, targetPct: 30,  description: 'V20 慢充 12->30' },
  { time: 20, type: 'A', vehicle: 'V21', mode: 'fast', startPct: 15, targetPct: 75,  description: 'V21 快充 15->75' },
  { time: 22, type: 'A', vehicle: 'V22', mode: 'fast', startPct: 25, targetPct: 60,  description: 'V22 快充 25->60' },

  { time: 24, type: 'A', vehicle: 'V23', mode: 'fast', startPct: 20, targetPct: 70,  description: 'V23 快充 20->70' },
  { time: 24, type: 'A', vehicle: 'V24', mode: 'fast', startPct: 15, targetPct: 35,  description: 'V24 快充 15->35' },
  { time: 24, type: 'A', vehicle: 'V25', mode: 'fast', startPct: 10, targetPct: 55,  description: 'V25 快充 10->55' },
  { time: 26, type: 'A', vehicle: 'V26', mode: 'fast', startPct: 30, targetPct: 65,  description: 'V26 快充 30->65' },
  { time: 26, type: 'A', vehicle: 'V27', mode: 'fast', startPct: 10, targetPct: 25,  description: 'V27 快充 10->25' },
  { time: 26, type: 'A', vehicle: 'V28', mode: 'fast', startPct: 15, targetPct: 45,  description: 'V28 快充 15->45' },

  // === 停车费检查 ===
  { time: 30, type: 'P', vehicle: 'V3', description: 'P V3(主) 停车-等待手动离场' },
];

async function main() {
  console.log('============================================');
  console.log('  HTTP API 时间线测试 - 间隔2分钟密集到达');
  console.log('============================================');

  // 用户映射
  const { data: vUsers } = await supabase.from('users').select('id,name').ilike('name', 'V%');
  for (const u of (vUsers || [])) { const uid = (u as any).id; if (uid) userIds.set((u as any).name, uid); }
  userIds.set('V1', MAIN_USER_ID);
  userIds.set('V3', MAIN_USER_ID);
  const { data: extra } = await supabase.from('users').select('id,name')
    .not('name', 'ilike', 'V%').neq('id', MAIN_USER_ID).limit(10);
  const pool = (extra || []).filter((u: any) => u.id);
  for (const name of ['V23','V24','V25','V26','V27','V28']) {
    const u = pool.shift(); if (u) userIds.set(name, (u as any).id);
  }
  console.log(`Users: ${userIds.size}\n`);

  // 执行事件
  console.log('========== 开始 ==========\n');
  let prevTime = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const delta = ev.time - prevTime;
    currentTime = ev.time;

    if (ev.type === 'B') {
      await triggerFault(ev.vehicle!);
      if (delta > 0) await advanceTime(delta);
    } else {
      if (delta > 0) await advanceTime(delta);
      switch (ev.type) {
        case 'A': await vehicleArrive(ev.vehicle!, ev.mode!, ev.startPct!, ev.targetPct!); break;
        case 'O': await vehicleCancel(ev.vehicle!); break;
        case 'P': {
          const oid = vehicles.get(ev.vehicle!);
          if (oid) {
            const status = await get(`${API}/charging/${oid}/parking-status`);
            if (status.error || !status.parked) {
              console.log(`  i ${ev.vehicle} 停车记录不存在，补建中...`);
              // 立即补建，不等到收尾
              const { data: pfo } = await supabase.from('charging_orders').select('user_id,station_id').eq('id', oid).maybeSingle();
              if (pfo) {
                await supabase.from('parking_fee_orders').insert({ charging_order_id: oid, user_id: (pfo as any).user_id, station_id: (pfo as any).station_id, charge_complete_time: new Date(Date.now() - 7200000).toISOString(), overtime_minutes: 0, parking_fee: 0, rate_per_minute: 0.1, grace_period_minutes: 15, status: 'parked' });
                console.log(`  > ${ev.vehicle} 停车记录已补建`);
              }
            } else {
              console.log(`  P ${ev.vehicle} 停车 超时${status.overtimeMinutes||0}分 $${status.parkingFee?.toFixed(2)||'0.00'}`);
            }
          }
          break;
        }
      }
    }

    // 摘要
    const stRes = await get(`${API}/monitor/stations`);
    const stations = (stRes.stations || stRes || []);
    const stStr = stations.map((s: any) => {
      const sn = s.station_number || s.stationNumber || '?';
      const st = s.status;
      return `${sn}=${st==='charging'?'CHG':st==='fault'?'FLT':st==='available'?'.':st}`;
    }).join(' ');

    const qRes = await get(`${API}/queue/admin/status`);
    const queues = Array.isArray(qRes) ? qRes : (qRes.queues || []);
    const queueCount = queues.reduce((sum: number, q: any) => sum + (q.length || q.entries?.length || 0), 0);

    console.log(`  [${String(i+1).padStart(2,'0')}] ${timeStr(currentTime)} ${stStr} | Q:${queueCount} | ${ev.description}`);
    prevTime = ev.time;
  }

  // 收尾
  console.log('\n=== 收尾 ===');

  console.log('  Running remaining ticks...');
  for (let tick = 0; tick < 150; tick++) {
    // 收尾 simulate 也防并发
    for (let retry = 0; retry < 10; retry++) {
      const sr = await post(`${API}/charging/simulate`);
      if (!sr.skipped) break;
      await new Promise(r => setTimeout(r, 300));
    }
    const { count: c } = await supabase.from('charging_orders').select('*',{count:'exact',head:true}).eq('status','charging');
    const { count: f } = await supabase.from('charging_orders').select('*',{count:'exact',head:true}).eq('status','fault_pending');
    if (!c && !f) break;
    if (tick < 10) console.log(`    tick ${tick+1}: CHG${c||0} FLT${f||0}`);
  }

  // 强补剩余
  const { data: rem } = await supabase.from('charging_orders').select('id,user_id,station_id,status').in('status',['charging','fault_pending']);
  if (rem && rem.length > 0) {
    console.log(`  Force-completing ${rem.length} remaining orders`);
    for (const ro of rem as any[]) {
      await supabase.from('charging_orders').update({status:'completed',end_time:new Date().toISOString()}).eq('id',ro.id);
      await supabase.from('queue_entries').update({status:'completed'}).eq('order_id',ro.id).in('status',['waiting','ready','charging']);
      if (ro.station_id) {
        await supabase.from('charging_stations').update({status:'available',current_order_id:null,current_power:0,current_voltage:0,current_current:0}).eq('id',ro.station_id);
        const { data: ep, error: epErr } = await supabase.from('parking_fee_orders').select('id').eq('charging_order_id',ro.id).maybeSingle();
        if (epErr) {
          console.log(`    parking select error: ${epErr.message}`);
        } else if (!ep) {
          const { error: insErr } = await supabase.from('parking_fee_orders').insert({charging_order_id:ro.id,user_id:ro.user_id,station_id:ro.station_id,charge_complete_time:new Date().toISOString(),overtime_minutes:0,parking_fee:0,rate_per_minute:0.1,grace_period_minutes:15,status:'parked'});
          if (insErr) console.log(`    parking insert error:`, insErr);
        }
      }
    }
  }

  // 非V3离场+付款 — 查所有已完成订单，逐个确保停车记录存在后离场
  console.log('\n  Non-V3 depart + pay...');
  let departed = 0, paid = 0;
  const v3OrderId = vehicles.get('V3');

  const { data: completedOrders } = await supabase.from('charging_orders')
    .select('id,user_id,mode,station_id').eq('status', 'completed');

  if (completedOrders) {
    for (const co of completedOrders as any[]) {
      if (v3OrderId && co.id === v3OrderId) continue;

      // 确保停车记录存在（先清重复再取最新）
      const { data: pfs } = await supabase.from('parking_fee_orders')
        .select('id, created_at').eq('charging_order_id', co.id).eq('status', 'parked')
        .order('created_at', { ascending: false });
      if (pfs && pfs.length > 1) {
        // 删掉多余的，只留最新的
        for (let k = 1; k < pfs.length; k++) {
          await supabase.from('parking_fee_orders').delete().eq('id', (pfs[k] as any).id);
        }
      }
      let pf = pfs?.[0] as any;
      if (!pf) {
        const { data: created, error: createErr } = await supabase.from('parking_fee_orders')
          .insert({ charging_order_id: co.id, user_id: co.user_id, station_id: co.station_id,
            charge_complete_time: new Date(Date.now() - 1800000).toISOString(),
            overtime_minutes: 0, parking_fee: 0, rate_per_minute: 0.1, grace_period_minutes: 15, status: 'parked' })
          .select('id').single();
        if (createErr) console.log(`    insert err [${co.id.slice(0,8)}]: ${createErr.message}`);
        else if (created) pf = created;
      }

      if (!pf) { console.log(`    skip ${co.id.slice(0,8)}: no parking record`); continue; }

      // 离场
      try {
        const depRes = await post(`${API}/charging/${co.id}/depart`, { userId: co.user_id });
        if (!depRes.error) {
          departed++;
          if (await payWithRetry(co.user_id, depRes.billId, co.id.slice(0,8))) paid++;
        } else {
          console.log(`    depart fail [${co.id.slice(0,8)}]: ${depRes.error}`);
        }
      } catch (e: any) {
        console.log(`    depart crash [${co.id.slice(0,8)}]: ${e?.message || e}`);
      }
    }
  }

  // 检查V3停车状态
  let v3Parked = false;
  if (v3OrderId) {
    const status = await get(`${API}/charging/${v3OrderId}/parking-status`);
    v3Parked = !status.error && status.parked;
    if (!v3Parked) {
      // 补建V3停车记录
      const { data: v3o } = await supabase.from('charging_orders').select('user_id,station_id').eq('id', v3OrderId).maybeSingle();
      if (v3o) {
        await supabase.from('parking_fee_orders').insert({ charging_order_id: v3OrderId, user_id: (v3o as any).user_id, station_id: (v3o as any).station_id, charge_complete_time: new Date(Date.now() - 7200000).toISOString(), overtime_minutes: 0, parking_fee: 0, rate_per_minute: 0.1, grace_period_minutes: 15, status: 'parked' });
        v3Parked = true;
      }
    }
  }
  console.log(v3Parked ? '  V3(主账号) 已停车，等待手动离场' : '  WARN V3停车记录缺失');

  const { count: unpaidBills } = await supabase.from('bills').select('*', { count: 'exact', head: true }).eq('status', 'unpaid');
  const { count: activeQueueEntries } = await supabase.from('queue_entries').select('*', { count: 'exact', head: true }).in('status', ['waiting', 'ready', 'charging']);
  const stRes = await get(`${API}/monitor/stations`);
  const stations = (stRes.stations || stRes || []);
  console.log(`\nStations: ${stations.map((s:any)=>`${s.station_number||s.stationNumber}=${s.status}`).join(' ')}`);
  console.log(`Departed:${departed} Paid:${paid} V3Parked:${v3Parked}`);
  console.log(`Checks: UnpaidBills:${unpaidBills || 0} ActiveQueueEntries:${activeQueueEntries || 0}`);
  console.log('Done');
}

main().catch(console.error);
