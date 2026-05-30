import { createServiceClient } from '../src/lib/supabase';
import { Fault, FaultType, FaultSeverity } from '../src/models/Fault';
import { ChargingService } from '../src/services/ChargingService';
import { QueueService } from '../src/services/QueueService';

async function forceChargeOnStation(userId: string, stationId: string, mode: string, batteryLevel: number, targetLevel: number) {
  const { data: order } = await supabase.from('charging_orders').insert({
    user_id: userId, mode, status: 'charging',
    request_battery_level: batteryLevel, target_battery_level: targetLevel,
    start_time: new Date().toISOString(), station_id: stationId,
    energy_consumed: 0,
  }).select().single();
  const orderId = (order as any).id;
  await supabase.from('charging_stations').update({
    status: 'charging', current_order_id: orderId,
  }).eq('id', stationId);
  return orderId;
}

const supabase = createServiceClient();
const MAIN_USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';

const OTHER_USERS = [
  'f45b72e6-037f-4791-a8dd-d85c219c5bf5',
  '8a4dc4cd-5af1-47f9-9397-61eb28289439',
  '505a5151-9253-4a63-86c8-e269bf8bf9ef',
  '1e16af77-8e7f-4621-b30b-cf34c8d3d349',
];

const FAST_QUEUE_ID = 'e62b73d4-2f1b-41b8-ab1c-3302287dcb72';
const SLOW_QUEUE_ID = '0fa3107d-1ff4-409c-b9a6-d424cc3d0535';
const WAITING_QUEUE_ID = 'ee8e7f9c-78ee-43e5-b460-817d6f1d4a06';

async function getUserName(uid: string) {
  const { data: u } = await supabase.from('users').select('name').eq('id', uid).single();
  return (u as any)?.name || uid.slice(0, 8);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  故障→优先排队 压力测试 (快充+慢充混合)                  ║');
  console.log('║  主账号: 2223632901@qq.com                              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Step 0: 清理 ──
  console.log('[0/8] 清理旧数据...');
  await supabase.from('queue_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  for (const uid of [MAIN_USER_ID, ...OTHER_USERS]) {
    const { data: orders } = await supabase.from('charging_orders')
      .select('id').eq('user_id', uid).in('status', ['charging','paused','fault_pending','queued','pending']);
    if (orders) for (const o of orders) {
      await supabase.from('charging_orders').update({ status: 'cancelled', end_time: new Date().toISOString() }).eq('id', (o as any).id);
    }
  }
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).neq('status', 'available');
  console.log('  ✅ 已清理\n');

  // ── Step 1: 占满所有充电桩（快充3+慢充2）──
  console.log('[1/8] 用其他用户占满所有充电桩...');

  // 快充桩
  const { data: fastStations } = await supabase.from('charging_stations').select('id, station_number').eq('mode', 'fast');
  const fastStationList = fastStations as any[];
  for (let i = 0; i < fastStationList.length; i++) {
    const userId = OTHER_USERS[i % OTHER_USERS.length];
    const station = fastStationList[i];
    const { data: order } = await supabase.from('charging_orders').insert({
      user_id: userId, mode: 'fast', status: 'charging',
      request_battery_level: 30 + i * 10, target_battery_level: 85,
      start_time: new Date().toISOString(), energy_consumed: 10 + i * 5,
      station_id: station.id,
    }).select().single();
    await supabase.from('charging_stations').update({
      status: 'charging', current_order_id: (order as any).id,
    }).eq('id', station.id);
    console.log(`  ${station.station_number} ← ${await getUserName(userId)} (⚡快充, ${30 + i * 10}%)`);
  }

  // 慢充桩
  const { data: slowStations } = await supabase.from('charging_stations').select('id, station_number').eq('mode', 'slow');
  const slowStationList = slowStations as any[];
  for (let i = 0; i < slowStationList.length; i++) {
    const userId = OTHER_USERS[(i + 2) % OTHER_USERS.length];
    const station = slowStationList[i];
    const { data: order } = await supabase.from('charging_orders').insert({
      user_id: userId, mode: 'slow', status: 'charging',
      request_battery_level: 25 + i * 10, target_battery_level: 90,
      start_time: new Date().toISOString(), energy_consumed: 8 + i * 3,
      station_id: station.id,
    }).select().single();
    await supabase.from('charging_stations').update({
      status: 'charging', current_order_id: (order as any).id,
    }).eq('id', station.id);
    console.log(`  ${station.station_number} ← ${await getUserName(userId)} (🔋慢充, ${25 + i * 10}%)`);
  }

  const mainStation = fastStationList[0]; // 第一个快充桩留给主账号触发故障

  // ── Step 2: 填满快充队列 (max=3) ──
  console.log('\n[2/8] 填满快充队列 (3人)...');
  for (let i = 0; i < 3; i++) {
    const userId = OTHER_USERS[(i + 1) % OTHER_USERS.length];
    const { data: order } = await supabase.from('charging_orders').insert({
      user_id: userId, mode: 'fast', status: 'queued',
      request_battery_level: 20 + i * 10, target_battery_level: 80,
    }).select().single();
    const orderId = (order as any).id;
    await supabase.from('queue_entries').insert({
      user_id: userId, order_id: orderId, queue_id: FAST_QUEUE_ID,
      mode: 'fast', position: i + 1, status: 'waiting',
      battery_level: 20 + i * 10, estimated_wait_minutes: 40 + i * 20,
    });
    console.log(`  快充队列 #${i + 1}: ${await getUserName(userId)} (⚡ ${20 + i * 10}%)`);
  }

  // ── Step 3: 填满慢充队列 (max=3) ──
  console.log('\n[3/8] 填满慢充队列 (3人)...');
  for (let i = 0; i < 3; i++) {
    const userId = OTHER_USERS[(i + 3) % OTHER_USERS.length];
    const { data: order } = await supabase.from('charging_orders').insert({
      user_id: userId, mode: 'slow', status: 'queued',
      request_battery_level: 15 + i * 10, target_battery_level: 85,
    }).select().single();
    const orderId = (order as any).id;
    await supabase.from('queue_entries').insert({
      user_id: userId, order_id: orderId, queue_id: SLOW_QUEUE_ID,
      mode: 'slow', position: i + 1, status: 'waiting',
      battery_level: 15 + i * 10, estimated_wait_minutes: 180 + i * 60,
    });
    console.log(`  慢充队列 #${i + 1}: ${await getUserName(userId)} (🔋 ${15 + i * 10}%)`);
  }

  // ── Step 4: 填充等候队列（混合快充+慢充，因为两个主队列都满了）──
  console.log('\n[4/8] 填等候队列 (5人，混合快充+慢充)...');
  const waitingModes = ['fast', 'slow', 'fast', 'slow', 'fast'];
  for (let i = 0; i < 5; i++) {
    const userId = OTHER_USERS[i % OTHER_USERS.length];
    const mode = waitingModes[i];
    const { data: order } = await supabase.from('charging_orders').insert({
      user_id: userId, mode, status: 'queued',
      request_battery_level: 10 + i * 8, target_battery_level: 80,
    }).select().single();
    await supabase.from('queue_entries').insert({
      user_id: userId, order_id: (order as any).id, queue_id: WAITING_QUEUE_ID,
      mode, position: i + 1, status: 'waiting',
      battery_level: 10 + i * 8, estimated_wait_minutes: 80 + i * 15,
    });
    const icon = mode === 'fast' ? '⚡' : '🔋';
    console.log(`  等候队列 #${i + 1}: ${await getUserName(userId)} (${icon}${mode} ${10 + i * 8}%)`);
  }

  // ── Step 5: 主账号替换一个桩开始充电 ──
  console.log('\n[5/8] 主账号替换 F-001 开始充电...');
  // 结束第一个快充桩上的订单 + 清空桩状态，不让 dispatch 抢走
  const { data: occOrders } = await supabase.from('charging_orders')
    .select('id').eq('station_id', mainStation.id).eq('status', 'charging').limit(1);
  if (occOrders && occOrders.length > 0) {
    await supabase.from('charging_orders').update({ status: 'completed', end_time: new Date().toISOString() }).eq('id', (occOrders[0] as any).id);
  }
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).eq('id', mainStation.id);

  // 不 dispatch — 直接让主账号抢占这个桩（bypass 队列，模拟真实充电）
  const chargeOrderId = await forceChargeOnStation(MAIN_USER_ID, mainStation.id, 'fast', 30, 80);
  console.log(`  ✅ 订单 ${chargeOrderId.slice(0, 8)} @ ${mainStation.station_number}，status: charging`);
  await supabase.from('charging_orders').update({ energy_consumed: 12 }).eq('id', chargeOrderId);
  console.log(`  已充电 12 kWh`);

  // ── Step 6: 显示当前系统状态 ──
  console.log('\n[6/8] 当前系统状态:');
  await printFullState();

  // ── Step 7: 🔥 触发故障 → 优先排队 ──
  console.log('\n[7/8] 🔥 主账号触发故障 → 重新排队...');
  const { data: chargeOrder } = await supabase.from('charging_orders').select('station_id').eq('id', chargeOrderId).single();
  const stationId = (chargeOrder as any).station_id;

  const fault = new Fault({
    id: '', station_id: stationId,
    type: FaultType.Overheating, severity: FaultSeverity.Major,
    description: '⚠️ 压力测试：充电桩温度异常升高（快充+慢充混合测试）',
    detected_at: new Date().toISOString(),
    affected_order_id: chargeOrderId,
  });
  await fault.report(true);
  await supabase.from('charging_orders').update({ status: 'fault_pending' }).eq('id', chargeOrderId);
  console.log(`  ⚡ 故障ID: ${fault.id?.slice(0, 8)}`);

  const decision = await ChargingService.handleFaultDecision(chargeOrderId, MAIN_USER_ID, 'requeue');
  const newOrderId = (decision as any).newOrderId;
  console.log(`  🔄 旧订单 ${chargeOrderId.slice(0, 8)} → fault_stopped`);
  console.log(`  ⭐ 新订单 ${newOrderId.slice(0, 8)} → 快充队列第一位！`);

  // ── Step 8: 最终状态 ──
  console.log('\n[8/8] 压力测试完成！最终系统状态:');
  await printFullState();

  // ── 验证 ──
  console.log('\n┌─ 验证结果 ────────────────────────────────────────────┐');
  const { data: fastQ } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', FAST_QUEUE_ID).eq('status', 'waiting').order('position');
  const mainEntry = (fastQ || []).find((e: any) => e.user_id === MAIN_USER_ID && e.order_id === newOrderId);
  if (mainEntry && (mainEntry as any).position === 1) {
    console.log('  ✅ 主账号在快充队列 #1 — 优先排队功能正常');
  } else {
    console.log('  ❌ 主账号不在快充队列 #1！');
    console.log(`     实际位置: ${mainEntry ? (mainEntry as any).position : '未找到'}`);
  }

  // 检查慢充队列是否只有慢充用户
  const { data: slowQ } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', SLOW_QUEUE_ID).eq('status', 'waiting').order('position');
  const slowViolations = (slowQ || []).filter((e: any) => e.mode !== 'slow');
  if (slowViolations.length === 0) {
    console.log('  ✅ 慢充队列中无快充用户 — 队列模式隔离正常');
  } else {
    console.log(`  ❌ 慢充队列中有 ${slowViolations.length} 个快充用户！`);
  }

  // 检查等候队列混合模式
  const { data: waitQ } = await supabase.from('queue_entries')
    .select('mode').eq('queue_id', WAITING_QUEUE_ID).eq('status', 'waiting');
  const fastInWait = (waitQ || []).filter((e: any) => e.mode === 'fast').length;
  const slowInWait = (waitQ || []).filter((e: any) => e.mode === 'slow').length;
  console.log(`  ℹ️  等候队列: ${fastInWait} 快充 + ${slowInWait} 慢充 = ${(waitQ || []).length} 人`);
  console.log('└──────────────────────────────────────────────────────────┘');

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  打开 http://localhost:3000/admin/dashboard             ║');
  console.log('║  → 查看: 5个桩全占 + 快充/慢充/等候队列                   ║');
  console.log('║  → 2223632901 在快充队列 #1 ⭐                          ║');
  console.log('║  → 慢充队列只有慢充用户 ✅                               ║');
  console.log('║                                                         ║');
  console.log('║  打开 http://localhost:3000/user/queue                   ║');
  console.log('║  → 用 2223632901@qq.com / 2223632901 登录               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
}

async function printFullState() {
  // 充电桩
  const { data: stations } = await supabase.from('charging_stations').select('*').order('station_number');
  console.log('  ┌─ 充电桩 ──────────────────────────────────────────┐');
  for (const s of (stations || [])) {
    const st = s as any;
    let userName = '-';
    if (st.current_order_id) {
      const { data: order } = await supabase.from('charging_orders').select('user_id').eq('id', st.current_order_id).maybeSingle();
      if (order) userName = await getUserName((order as any).user_id);
    }
    const isMain = userName === '2223632901' ? ' ⭐' : '';
    const modeIcon = st.mode === 'fast' ? '⚡' : '🔋';
    const statusIcon = st.status === 'charging' ? '⚡' : st.status === 'fault' ? '🔥' : '🟢';
    console.log(`  │ ${modeIcon} ${st.station_number} ${statusIcon} ${st.status.padEnd(10)} ${userName.padEnd(14)}${isMain}`);
  }
  console.log('  └────────────────────────────────────────────────────┘');

  // 快充队列
  const { data: fastQ } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', FAST_QUEUE_ID).eq('status', 'waiting').order('position');
  console.log('  ┌─ ⚡ 快充队列 ─────────────────────────────────────┐');
  if (!fastQ || fastQ.length === 0) console.log('  │ (空)');
  else for (const e of fastQ) {
    const entry = e as any;
    const name = await getUserName(entry.user_id);
    const { data: u } = await supabase.from('users').select('vehicle_plate').eq('id', entry.user_id).maybeSingle();
    const plate = (u as any)?.vehicle_plate || '-';
    const marker = entry.user_id === MAIN_USER_ID ? ' ⭐' : '';
    console.log(`  │ #${entry.position} ${name.padEnd(14)} ${plate.padEnd(10)} ${entry.battery_level}% ~${entry.estimated_wait_minutes}分${marker}`);
  }
  console.log('  └────────────────────────────────────────────────────┘');

  // 慢充队列
  const { data: slowQ } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', SLOW_QUEUE_ID).eq('status', 'waiting').order('position');
  console.log('  ┌─ 🔋 慢充队列 ─────────────────────────────────────┐');
  if (!slowQ || slowQ.length === 0) console.log('  │ (空)');
  else for (const e of slowQ) {
    const entry = e as any;
    const name = await getUserName(entry.user_id);
    const { data: u } = await supabase.from('users').select('vehicle_plate').eq('id', entry.user_id).maybeSingle();
    const plate = (u as any)?.vehicle_plate || '-';
    console.log(`  │ #${entry.position} ${name.padEnd(14)} ${plate.padEnd(10)} ${entry.battery_level}% ~${entry.estimated_wait_minutes}分`);
  }
  console.log('  └────────────────────────────────────────────────────┘');

  // 等候队列
  const { data: waitQ } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', WAITING_QUEUE_ID).eq('status', 'waiting').order('position');
  console.log('  ┌─ 🟠 等候队列 ─────────────────────────────────────┐');
  if (!waitQ || waitQ.length === 0) console.log('  │ (空)');
  else for (const e of waitQ) {
    const entry = e as any;
    const name = await getUserName(entry.user_id);
    const icon = entry.mode === 'fast' ? '⚡' : '🔋';
    console.log(`  │ #${entry.position} ${name.padEnd(14)} ${icon}${entry.mode} ${entry.battery_level}% ~${entry.estimated_wait_minutes}分`);
  }
  console.log('  └────────────────────────────────────────────────────┘');
}

main().catch(console.error);
