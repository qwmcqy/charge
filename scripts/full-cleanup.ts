import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();

async function main() {
  console.log('=== 全面清理 ===\n');

  // 1. 清理所有未解决的故障
  const { data: faults } = await supabase.from('faults').select('id').is('resolved_at', null);
  if (faults && faults.length > 0) {
    await supabase.from('faults').update({ resolved_at: new Date().toISOString() }).is('resolved_at', null);
    console.log(`✅ 解决 ${faults.length} 个未解决故障`);
  }

  // 2. 清理所有队列条目
  const { data: qEntries } = await supabase.from('queue_entries').select('id');
  if (qEntries && qEntries.length > 0) {
    await supabase.from('queue_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    console.log(`✅ 删除 ${qEntries.length} 个队列条目`);
  }

  // 3. 清理所有非最终状态的订单
  const stuckStatuses = ['pending', 'queued', 'assigned', 'charging', 'paused', 'fault_pending'];
  const { data: stuckOrders } = await supabase.from('charging_orders').select('id,status').in('status', stuckStatuses);
  if (stuckOrders && stuckOrders.length > 0) {
    for (const o of stuckOrders) {
      await supabase.from('charging_orders').update({ status: 'cancelled', end_time: new Date().toISOString() }).eq('id', (o as any).id);
    }
    console.log(`✅ 取消 ${stuckOrders.length} 个未完成订单`);
  }

  // 4. 重置所有充电桩
  await supabase.from('charging_stations').update({
    status: 'available',
    current_order_id: null,
    current_power: 0,
    current_voltage: 0,
    current_current: 0,
  }).neq('status', 'available');
  // Also reset available ones that still have current_order_id set
  await supabase.from('charging_stations').update({
    current_order_id: null,
    current_power: 0,
  }).eq('status', 'available').not('current_order_id', 'is', null);
  console.log('✅ 重置所有充电桩为 available');

  // 5. 删除孤立的 parking_fee_orders（引用了不存在的订单）
  const { data: allOrders } = await supabase.from('charging_orders').select('id');
  const validOrderIds = (allOrders || []).map((o: any) => o.id);
  const { data: allParking } = await supabase.from('parking_fee_orders').select('id, charging_order_id');
  if (allParking) {
    for (const p of allParking) {
      if (!validOrderIds.includes((p as any).charging_order_id)) {
        await supabase.from('bills').delete().eq('parking_fee_order_id', (p as any).id);
        await supabase.from('parking_fee_orders').delete().eq('id', (p as any).id);
      }
    }
  }
  console.log('✅ 清理孤立的停车费订单');

  // 6. Verify final state
  const { data: stations } = await supabase.from('charging_stations').select('station_number,status');
  console.log('\n最终充电桩状态:', (stations || []).map((s: any) => `${s.station_number}=${s.status}`).join(', '));

  const { count: queueCount } = await supabase.from('queue_entries').select('*', { count: 'exact', head: true });
  console.log(`队列条目: ${queueCount || 0}`);

  const { count: faultCount } = await supabase.from('faults').select('*', { count: 'exact', head: true }).is('resolved_at', null);
  console.log(`未解决故障: ${faultCount || 0}`);

  console.log('\n🎉 清理完成');
}

main().catch(console.error);
