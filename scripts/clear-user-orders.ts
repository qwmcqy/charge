import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();
const USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';

async function main() {
  // 1. 查看该用户所有订单
  const { data: orders } = await supabase.from('charging_orders')
    .select('id, status, station_id, queue_entry_id, mode, created_at')
    .eq('user_id', USER_ID)
    .order('created_at', { ascending: false });

  console.log(`用户共有 ${orders?.length || 0} 个订单:`);
  (orders || []).forEach((o: any) => console.log(`  ${o.id.slice(0, 8)}... 状态=${o.status} 桩=${o.station_id?.slice(0, 8) || '-'} 队列=${o.queue_entry_id?.slice(0, 8) || '-'} 时间=${new Date(o.created_at).toLocaleString('zh-CN')}`));

  // 2. 清理：按 FK 顺序删除
  const orderIds = (orders || []).map((o: any) => o.id);
  if (orderIds.length === 0) { console.log('\n✅ 无需清理'); return; }

  console.log(`\n开始清理 ${orderIds.length} 个订单...`);

  // Step 1: 删除 bills
  const { data: bills } = await supabase.from('bills').select('id').in('charging_order_id', orderIds);
  if (bills && bills.length > 0) {
    const billIds = bills.map((b: any) => b.id);
    await supabase.from('bills').delete().in('id', billIds);
    console.log(`  ✅ 删除 ${billIds.length} 条 bills`);
  }

  // Step 2: 删除 parking_fee_orders
  await supabase.from('parking_fee_orders').delete().in('charging_order_id', orderIds);
  console.log(`  ✅ 删除 parking_fee_orders`);

  // Step 3: 删除 queue_entries
  await supabase.from('queue_entries').delete().in('order_id', orderIds);
  console.log(`  ✅ 删除 queue_entries`);

  // Step 4: 删除 notifications
  await supabase.from('notifications').delete().in('related_id', orderIds);
  console.log(`  ✅ 删除 notifications`);

  // Step 5: 解除 faults 引用
  await supabase.from('faults').update({ affected_order_id: null }).in('affected_order_id', orderIds);
  console.log(`  ✅ 解除 faults 引用`);

  // Step 6: 删除充电订单
  const { error: delErr } = await supabase.from('charging_orders').delete().in('id', orderIds);
  if (delErr) {
    console.error(`  ❌ 删除订单失败: ${delErr.message}`);
  } else {
    console.log(`  ✅ 删除 ${orderIds.length} 个充电订单`);
  }

  // Step 7: 重置该用户的充电桩
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null, current_power: 0 }).neq('status', 'available');
  console.log(`  ✅ 重置所有充电桩状态`);

  console.log('\n🎉 清理完成！');
}

main().catch(console.error);
