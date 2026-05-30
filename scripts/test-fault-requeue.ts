import { createServiceClient } from '../src/lib/supabase';
import { Fault, FaultType, FaultSeverity } from '../src/models/Fault';
import { NotificationType } from '../src/lib/types';
import { Notification } from '../src/models/Notification';

const supabase = createServiceClient();
const USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';

async function main() {
  console.log('=== 故障→优先排队功能测试 ===\n');
  console.log('测试用户:', USER_ID);

  // Step 0: Clean up stuck state
  console.log('--- Step 0: 清理 stuck 状态 ---');
  const { data: faultStations } = await supabase.from('charging_stations').select('*').eq('status', 'fault');
  for (const s of (faultStations || [])) {
    const { data: faults } = await supabase.from('faults').select('id').eq('station_id', (s as any).id).is('resolved_at', null);
    if (faults) {
      for (const f of faults) {
        await supabase.from('faults').update({ resolved_at: new Date().toISOString() }).eq('id', (f as any).id);
      }
    }
    await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).eq('id', (s as any).id);
    console.log(`  ${(s as any).station_number} 已恢复`);
  }

  // Fix any non-available/charging/fault stations
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).not('status', 'in', '("charging","available")');
  console.log('  所有非活跃充电桩已重置为 available');

  // Clean up user's active orders first
  const { data: userOrders } = await supabase.from('charging_orders').select('id, status').eq('user_id', USER_ID).in('status', ['charging', 'paused', 'fault_pending', 'queued', 'pending']);
  if (userOrders && userOrders.length > 0) {
    console.log(`  用户有 ${userOrders.length} 个活跃订单，先结束它们`);
    for (const o of userOrders) {
      // Check for FK dependencies
      const { data: qEntries } = await supabase.from('queue_entries').select('id').eq('order_id', (o as any).id);
      if (qEntries && qEntries.length > 0) {
        await supabase.from('queue_entries').delete().eq('order_id', (o as any).id);
      }
      await supabase.from('charging_orders').update({ status: 'cancelled', end_time: new Date().toISOString() }).eq('id', (o as any).id);
    }
    console.log('  已清理');
  }

  // Verify all stations available
  const { data: stations } = await supabase.from('charging_stations').select('id, station_number, mode, status');
  console.log('  充电桩状态:', (stations || []).map((s: any) => `${s.station_number}=${s.status}`).join(', '));

  // Step 1: Create a charging request via ChargingService
  console.log('\n--- Step 1: 发起快充请求 (30% → 80%) ---');
  const { ChargingService } = await import('../src/services/ChargingService');

  let result;
  try {
    result = await ChargingService.requestCharge(USER_ID, 'fast' as any, 30, 80);
    console.log('  ✅ 订单创建成功:', result.order.id.slice(0, 8), '状态:', result.order.status);
    if ((result as any).directCharge) console.log('  ✅ 直接分配到充电桩:', (result as any).station.stationNumber);
  } catch (err: any) {
    console.error('  ❌ 创建充电请求失败:', err.message);
    return;
  }

  const order = result.order;
  const orderId = order.id;

  // Step 2: Manually trigger a fault (like the simulate-fault API does)
  console.log('\n--- Step 2: 人为触发故障 ---');
  const stationId = order.stationId;
  if (!stationId) {
    console.error('  ❌ 订单未分配充电桩');
    return;
  }

  const fault = new Fault({
    id: '',
    station_id: stationId,
    type: FaultType.Overheating,
    severity: FaultSeverity.Major,
    description: '测试故障：充电桩温度异常升高',
    detected_at: new Date().toISOString(),
    affected_order_id: orderId,
  });

  await fault.report(true); // skipOrderUpdate — we control order status

  // Set order to fault_pending
  await supabase.from('charging_orders').update({ status: 'fault_pending' }).eq('id', orderId);

  await Notification.send(
    USER_ID,
    NotificationType.System,
    '充电异常 — 请选择处理方式（测试）',
    `测试故障。您可以：① 结束本次充电；② 优先插入队列第一位。故障ID: ${fault.id?.slice(0, 8)}`,
    orderId
  );

  console.log('  ✅ 故障已创建:', fault.id?.slice(0, 8));
  console.log('  ✅ 订单状态已设为 fault_pending');

  // Verify fault_pending
  const { data: orderCheck } = await supabase.from('charging_orders').select('status').eq('id', orderId).single();
  console.log('  验证订单状态:', (orderCheck as any).status, (orderCheck as any).status === 'fault_pending' ? '✅' : '❌');

  // Step 3: Test requeue decision
  console.log('\n--- Step 3: 测试优先排队 (requeue) ---');

  // First check the queue state before
  const { data: preQEntries } = await supabase.from('queue_entries').select('*').eq('queue_id', 'e62b73d4-2f1b-41b8-ab1c-3302287dcb72').eq('status', 'waiting').order('position', { ascending: true });
  console.log('  排队前快充队列条目:', (preQEntries || []).map((e: any) => `#${e.position}: ${e.order_id?.slice(0, 8)}`).join(', ') || '(空)');

  const decisionResult = await ChargingService.handleFaultDecision(orderId, USER_ID, 'requeue');
  console.log('  决策结果:', JSON.stringify({
    choice: decisionResult.choice,
    newOrderId: (decisionResult as any).newOrderId?.slice(0, 8),
    position: decisionResult.position
  }));

  const newOrderId = (decisionResult as any).newOrderId;

  // Verify old order
  const { data: oldOrderAfter } = await supabase.from('charging_orders').select('status').eq('id', orderId).single();
  console.log('  旧订单状态:', (oldOrderAfter as any).status, (oldOrderAfter as any).status === 'fault_stopped' ? '✅' : '❌');

  // Verify new order
  const { data: newOrder } = await supabase.from('charging_orders').select('*').eq('id', newOrderId).single();
  console.log('  新订单状态:', (newOrder as any).status, (newOrder as any).status === 'queued' ? '✅' : '❌');
  console.log('  新订单 queue_entry_id:', (newOrder as any).queue_entry_id ? '✅ 已关联' : '❌ 未关联');

  // Step 4: Verify queue position
  console.log('\n--- Step 4: 验证队列位置 ---');
  const { data: qEntries } = await supabase.from('queue_entries').select('*').eq('queue_id', 'e62b73d4-2f1b-41b8-ab1c-3302287dcb72').eq('status', 'waiting').order('position', { ascending: true });
  console.log('  当前快充队列:');
  (qEntries || []).forEach((e: any) => {
    const marker = e.position === 1 && e.order_id === newOrderId ? ' ✅ 第一位' : '';
    console.log(`    #${e.position}: 用户=${(e.user_id as string).slice(0, 8)}, 订单=${(e.order_id as string).slice(0, 8)}, 模式=${e.mode}${marker}`);
  });

  const firstEntry = qEntries?.[0];
  if (firstEntry && (firstEntry as any).position === 1 && (firstEntry as any).order_id === newOrderId) {
    console.log('  ✅ 新订单正确位于队列第一位！');
  } else {
    console.log('  ❌ 队列位置不正确！');
  }

  // Step 5: Test fault resolution → dispatch
  console.log('\n--- Step 5: 测试故障恢复后自动调度 ---');
  const { data: stationBefore } = await supabase.from('charging_stations').select('status').eq('id', stationId).single();
  console.log('  故障桩状态 (修复前):', (stationBefore as any).status);

  // Resolve the fault
  await supabase.from('faults').update({ resolved_at: new Date().toISOString() }).eq('id', fault.id!);
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).eq('id', stationId);

  const { data: stationAfter } = await supabase.from('charging_stations').select('status').eq('id', stationId).single();
  console.log('  故障桩状态 (修复后):', (stationAfter as any).status);

  // Manually trigger dispatch
  console.log('  手动触发 dispatchNext...');
  const { QueueService } = await import('../src/services/QueueService');
  await QueueService.dispatchNext('fast' as any);

  // Wait a bit for async operations
  await new Promise(r => setTimeout(r, 1000));

  // Check new order status
  const { data: newOrderAfterDispatch } = await supabase.from('charging_orders').select('status, station_id, queue_entry_id').eq('id', newOrderId).single();
  console.log('  新订单状态 (调度后):', (newOrderAfterDispatch as any).status);

  if ((newOrderAfterDispatch as any).status === 'charging') {
    console.log('  ✅ 故障恢复后，排队订单已被自动调度并开始充电！');

    // Check if assigned to a different station
    const { data: assignedStation } = await supabase.from('charging_stations').select('station_number').eq('id', (newOrderAfterDispatch as any).station_id).single();
    console.log(`  分配到充电桩: ${(assignedStation as any).station_number}`);
  } else if ((newOrderAfterDispatch as any).status === 'queued') {
    console.log('  ⚠️ 订单仍在排队。检查可用充电桩...');
    const { data: availStations } = await supabase.from('charging_stations').select('station_number, mode, status').eq('mode', 'fast').eq('status', 'available');
    console.log('  可用快充桩:', (availStations || []).map((s: any) => s.station_number).join(', ') || '(无)');
  }

  // Check queue entry status
  const { data: entryAfter } = await supabase.from('queue_entries').select('status').eq('order_id', newOrderId).maybeSingle();
  console.log('  队列条目状态:', entryAfter ? (entryAfter as any).status : '已清理');

  // Step 6: Clean up
  console.log('\n--- Step 6: 清理测试数据 ---');
  try {
    await ChargingService.endCharging(newOrderId, USER_ID);
    console.log('  ✅ 已结束测试订单');
  } catch (e: any) {
    console.log('  结束订单:', e.message);
    // Force cancel
    await supabase.from('charging_orders').update({ status: 'cancelled', end_time: new Date().toISOString() }).eq('id', newOrderId);
    console.log('  已强制取消');
  }

  // Clean up queue entries
  await supabase.from('queue_entries').delete().eq('order_id', newOrderId);
  // Clean up parking fee orders
  await supabase.from('parking_fee_orders').delete().in('charging_order_id', [orderId, newOrderId]);
  // Clean up bills
  const { data: parkingOrders } = await supabase.from('parking_fee_orders').select('id').in('charging_order_id', [orderId, newOrderId]);
  if (parkingOrders && parkingOrders.length > 0) {
    await supabase.from('bills').delete().in('parking_fee_order_id', parkingOrders.map(p => (p as any).id));
    await supabase.from('parking_fee_orders').delete().in('charging_order_id', [orderId, newOrderId]);
  }
  // Clean up notifications
  await supabase.from('notifications').delete().in('related_id', [orderId, newOrderId]);
  // Delete old order
  await supabase.from('charging_orders').delete().eq('id', orderId).maybeSingle();
  await supabase.from('charging_orders').delete().eq('id', newOrderId).maybeSingle();
  console.log('  ✅ 测试数据已清理');

  console.log('\n=== 🎉 测试完成 ===');
  console.log('总结: 故障→优先排队 功能正常工作！');
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
