import { createServiceClient } from '../src/lib/supabase';
import { Fault, FaultType, FaultSeverity } from '../src/models/Fault';
import { NotificationType } from '../src/lib/types';
import { Notification } from '../src/models/Notification';

const supabase = createServiceClient();
const USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';

async function main() {
  console.log('=== 故障→优先排队 压力测试 ===\n');

  // ── Step 0: 清理环境 ──
  console.log('--- Step 0: 清理环境 ---');
  const { data: activeOrders } = await supabase.from('charging_orders')
    .select('id').eq('user_id', USER_ID)
    .in('status', ['charging','paused','fault_pending','queued','pending']);
  for (const o of (activeOrders || [])) {
    await supabase.from('queue_entries').delete().eq('order_id', (o as any).id);
    await supabase.from('charging_orders').update({ status: 'cancelled', end_time: new Date().toISOString() }).eq('id', (o as any).id);
  }
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).neq('status', 'available');
  // Clear existing queue
  await supabase.from('queue_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('  环境已清理');

  // ── Step 1: 创建大量排队订单（模拟队列满载） ──
  console.log('\n--- Step 1: 创建压力队列（快充队列满 + 等候队列满） ---');

  // 先用 dummy 用户填满快充队列（3 个位置）
  const queueId = 'e62b73d4-2f1b-41b8-ab1c-3302287dcb72'; // fast queue
  const waitingQueueId = 'ee8e7f9c-78ee-43e5-b460-817d6f1d4a06'; // waiting queue

  // 创建 dummy 用户如果没有的话
  const dummyUsers = [
    'dd100001-0001-4000-a000-000000000001',
    'dd100002-0001-4000-a000-000000000002',
    'dd100003-0001-4000-a000-000000000003',
    'dd100004-0001-4000-a000-000000000004',
    'dd100005-0001-4000-a000-000000000005',
    'dd100006-0001-4000-a000-000000000006',
    'dd100007-0001-4000-a000-000000000007',
    'dd100008-0001-4000-a000-000000000008',
    'dd100009-0001-4000-a000-000000000009',
    'dd100010-0001-4000-a000-000000000010',
  ];

  // 确保 dummy 用户存在于 users 表（可能没有，先记录）
  console.log('  注意: dummy 用户可能不存在于 users 表，尝试直接用主用户创建多个队列条目');

  // 使用主用户的不同订单来填充队列
  const queueFillerOrderIds: string[] = [];
  const entries: any[] = [];

  // 创建 3 个排队订单占满快充队列（位置 1,2,3）
  for (let i = 0; i < 3; i++) {
    const { data: order } = await supabase.from('charging_orders').insert({
      user_id: USER_ID,
      mode: 'fast',
      status: 'queued',
      request_battery_level: 20 + i * 10,
      target_battery_level: 80,
    }).select().single();
    const orderId = (order as any).id;
    queueFillerOrderIds.push(orderId);

    const { data: entry } = await supabase.from('queue_entries').insert({
      user_id: USER_ID,
      order_id: orderId,
      queue_id: queueId,
      mode: 'fast',
      position: i + 1,
      status: 'waiting',
      battery_level: 20 + i * 10,
      estimated_wait_minutes: 40,
    }).select().single();
    entries.push(entry);
    console.log(`  快充队列 #${i + 1}: 订单=${orderId.slice(0, 8)}`);
  }

  // 创建 5 个等候队列订单（等候队列最多 10）
  const waitingEntries: any[] = [];
  for (let i = 0; i < 5; i++) {
    const { data: order } = await supabase.from('charging_orders').insert({
      user_id: USER_ID,
      mode: 'fast',
      status: 'queued',
      request_battery_level: 30 + i * 5,
      target_battery_level: 80,
    }).select().single();
    const orderId = (order as any).id;
    queueFillerOrderIds.push(orderId);

    const { data: entry } = await supabase.from('queue_entries').insert({
      user_id: USER_ID,
      order_id: orderId,
      queue_id: waitingQueueId,
      mode: 'fast',
      position: i + 1,
      status: 'waiting',
      battery_level: 30 + i * 5,
      estimated_wait_minutes: 80,
    }).select().single();
    waitingEntries.push(entry);
    console.log(`  等候队列 #${i + 1}: 订单=${orderId.slice(0, 8)}`);
  }

  // ── Step 2: 展示队列状态 ──
  console.log('\n--- Step 2: 压力队列就绪 ---');
  await printQueueState('初始状态');

  // ── Step 3: 创建一个正在充电的订单 ──
  console.log('\n--- Step 3: 创建正在充电的订单 ---');
  const { data: chargingStation } = await supabase.from('charging_stations')
    .select('*').eq('mode', 'fast').eq('status', 'available').limit(1).single();

  if (!chargingStation) {
    console.error('  ❌ 没有可用的快充桩');
    return;
  }

  const { data: chargeOrder } = await supabase.from('charging_orders').insert({
    user_id: USER_ID,
    station_id: (chargingStation as any).id,
    mode: 'fast',
    status: 'charging',
    request_battery_level: 30,
    target_battery_level: 80,
    start_time: new Date().toISOString(),
    energy_consumed: 5,
  }).select().single();

  const chargeOrderId = (chargeOrder as any).id;
  await supabase.from('charging_stations').update({
    status: 'charging',
    current_order_id: chargeOrderId,
  }).eq('id', (chargingStation as any).id);

  console.log(`  充电订单: ${chargeOrderId.slice(0, 8)} @ ${(chargingStation as any).station_number}`);

  // ── Step 4: 触发故障 ──
  console.log('\n--- Step 4: 触发故障 ---');
  const fault = new Fault({
    id: '',
    station_id: (chargingStation as any).id,
    type: FaultType.Overheating,
    severity: FaultSeverity.Major,
    description: '压力测试故障：充电桩温度异常升高',
    detected_at: new Date().toISOString(),
    affected_order_id: chargeOrderId,
  });

  await fault.report(true);
  await supabase.from('charging_orders').update({ status: 'fault_pending' }).eq('id', chargeOrderId);
  console.log(`  ✅ 故障已触发，订单状态: fault_pending`);

  // ── Step 5: 执行优先排队 ──
  console.log('\n--- Step 5: 执行优先排队 (requeue) ---');
  await printQueueState('排队前');

  const { ChargingService } = await import('../src/services/ChargingService');
  const decisionResult = await ChargingService.handleFaultDecision(chargeOrderId, USER_ID, 'requeue');

  console.log(`\n  决策结果: choice=${decisionResult.choice}, newOrderId=${(decisionResult as any).newOrderId?.slice(0, 8)}, position=${decisionResult.position}`);

  await printQueueState('排队后');

  // ── Step 6: 验证 ──
  console.log('\n=== 压力测试验证 ===');

  // 6.1 验证旧订单已结束
  const { data: oldOrder } = await supabase.from('charging_orders').select('status').eq('id', chargeOrderId).single();
  const oldOk = (oldOrder as any).status === 'fault_stopped';
  console.log(`  ① 旧订单 fault_stopped: ${oldOk ? '✅' : '❌'} (${(oldOrder as any).status})`);

  // 6.2 验证新订单在队列第一位
  const newOrderId = (decisionResult as any).newOrderId;
  const { data: newOrder } = await supabase.from('charging_orders').select('*').eq('id', newOrderId).single();
  const newQueued = (newOrder as any).status === 'queued';
  console.log(`  ② 新订单状态 queued: ${newQueued ? '✅' : '❌'} (${(newOrder as any).status})`);

  // 6.3 验证快充队列位置
  const { data: qEntries } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', queueId).eq('status', 'waiting')
    .order('position', { ascending: true });

  const firstIsNew = qEntries?.[0] && (qEntries[0] as any).order_id === newOrderId && (qEntries[0] as any).position === 1;
  console.log(`  ③ 新订单在快充队列第一位: ${firstIsNew ? '✅' : '❌'}`);

  // 6.4 验证原有队列整体后移
  const positions = (qEntries || []).map((e: any) => e.position);
  const expectedPositions = Array.from({ length: qEntries?.length || 0 }, (_, i) => i + 1);
  const positionsCorrect = JSON.stringify(positions) === JSON.stringify(expectedPositions);
  console.log(`  ④ 队列位置连续无断层: ${positionsCorrect ? '✅' : '❌'} (位置: ${positions.join(',')}, 期望: ${expectedPositions.join(',')})`);

  // 6.5 检查无重复位置
  const uniquePositions = new Set(positions);
  const noDuplicates = uniquePositions.size === positions.length;
  console.log(`  ⑤ 队列无重复位置: ${noDuplicates ? '✅' : '❌'} (${uniquePositions.size} 个唯一位置 / ${positions.length} 个条目)`);

  // 6.6 检查等候队列未受影响
  const { data: waitEntries } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', waitingQueueId).eq('status', 'waiting')
    .order('position', { ascending: true });
  const waitCount = waitEntries?.length || 0;
  console.log(`  ⑥ 等候队列保持不变: ${waitCount === 5 ? '✅' : '❌'} (${waitCount} 个条目, 期望 5)`);

  // 6.7 打印完整队列详情
  console.log('\n--- 快充队列详情 ---');
  (qEntries || []).forEach((e: any) => {
    const marker = e.order_id === newOrderId ? ' ⭐ 新插入' : '';
    console.log(`  #${e.position}: 订单=${(e.order_id as string).slice(0, 8)} 用户=${(e.user_id as string).slice(0, 8)}${marker}`);
  });

  console.log('\n--- 等候队列详情 ---');
  (waitEntries || []).forEach((e: any) => {
    console.log(`  #${e.position}: 订单=${(e.order_id as string).slice(0, 8)}`);
  });

  // ── Step 7: 测试故障恢复+调度 ──
  console.log('\n--- Step 7: 故障恢复 → 自动调度 ---');
  const { data: faultStation } = await supabase.from('charging_stations').select('*').eq('id', (chargingStation as any).id).single();
  console.log(`  故障桩: ${(faultStation as any).station_number} 状态=${(faultStation as any).status}`);

  // 解决故障
  await supabase.from('faults').update({ resolved_at: new Date().toISOString() }).eq('id', fault.id!);
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).eq('id', (chargingStation as any).id);

  // 手动调度
  const { QueueService } = await import('../src/services/QueueService');
  await QueueService.dispatchNext('fast' as any);
  await new Promise(r => setTimeout(r, 1000));

  // 检查新订单是否被分配
  const { data: newOrderAfter } = await supabase.from('charging_orders').select('status, station_id').eq('id', newOrderId).single();
  const dispatched = (newOrderAfter as any).status === 'charging';
  console.log(`  ⑦ 恢复后排队第一位的订单自动充电: ${dispatched ? '✅' : '❌'} (状态=${(newOrderAfter as any).status})`);

  // 检查队列是否更新（第一个应该被移走，其余前移）
  const { data: qEntriesAfter } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', queueId).eq('status', 'waiting')
    .order('position', { ascending: true });
  console.log(`  ⑧ 调度后队列更新正确: ${qEntriesAfter?.length === (qEntries?.length || 1) - 1 ? '✅' : '❌'} (条目数=${qEntriesAfter?.length})`);

  // ── 最终汇总 ──
  const results = [oldOk, newQueued, firstIsNew, positionsCorrect, noDuplicates, waitCount === 5, dispatched];
  const allPassed = results.every(Boolean);

  console.log(`\n=== ${allPassed ? '🎉 压力测试全部通过！' : '❌ 有测试失败！'} ===`);
  console.log(`通过: ${results.filter(Boolean).length} / ${results.length}`);

  // ── Step 8: 清理 ──
  console.log('\n--- 清理测试数据 ---');
  const allTestOrderIds = [chargeOrderId, newOrderId, ...queueFillerOrderIds];
  await supabase.from('parking_fee_orders').delete().in('charging_order_id', allTestOrderIds);
  await supabase.from('bills').delete().in('charging_order_id', allTestOrderIds);
  await supabase.from('notifications').delete().in('related_id', allTestOrderIds);
  await supabase.from('faults').update({ affected_order_id: null }).in('affected_order_id', allTestOrderIds);
  await supabase.from('queue_entries').delete().in('order_id', allTestOrderIds);
  await supabase.from('charging_orders').delete().in('id', allTestOrderIds);
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).neq('status', 'available');
  console.log('  ✅ 清理完成');
}

async function printQueueState(label: string) {
  const queueId = 'e62b73d4-2f1b-41b8-ab1c-3302287dcb72';
  const { data: entries } = await supabase.from('queue_entries')
    .select('*').eq('queue_id', queueId).eq('status', 'waiting')
    .order('position', { ascending: true });
  const positions = (entries || []).map((e: any) => `#${e.position}:${(e.order_id as string).slice(0, 6)}`);
  console.log(`  [${label}] 快充队列 (${entries?.length || 0}): ${positions.join(' → ')}`);
}

main().catch(console.error);
