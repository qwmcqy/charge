import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();

async function main() {
  console.log('=== 全面深度清理 ===\n');

  // 按FK依赖顺序：先删引用方，后删被引用方

  // 0. 充电桩日志（FK关联到充电桩和订单）
  await supabase.from('station_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // 1. 通知
  const { count: nc } = await supabase.from('notifications').select('*', { count: 'exact', head: true });
  await supabase.from('notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`✅ 删除 ${nc || 0} 条通知`);

  // 2. 队列条目
  const { count: qc } = await supabase.from('queue_entries').select('*', { count: 'exact', head: true });
  await supabase.from('queue_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`✅ 删除 ${qc || 0} 条队列条目`);

  // 3. 故障
  const { count: fc } = await supabase.from('faults').select('*', { count: 'exact', head: true });
  await supabase.from('faults').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`✅ 删除 ${fc || 0} 条故障`);

  // 4. 账单（引用 parking_fee_orders, charging_orders）
  const { count: bc } = await supabase.from('bills').select('*', { count: 'exact', head: true });
  await supabase.from('bills').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`✅ 删除 ${bc || 0} 条账单`);

  // 5. 停车费订单（引用 charging_orders）
  const { count: pc } = await supabase.from('parking_fee_orders').select('*', { count: 'exact', head: true });
  await supabase.from('parking_fee_orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`✅ 删除 ${pc || 0} 条停车费订单`);

  // 6. 充电订单 —— 全部删除
  const { count: ocBefore } = await supabase.from('charging_orders').select('*', { count: 'exact', head: true });
  // 先清掉 station 引用
  await supabase.from('charging_stations').update({
    current_order_id: null,
  }).neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('charging_orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(`✅ 删除 ${ocBefore || 0} 条订单`);

  // 7. 重置充电桩
  await supabase.from('charging_stations').update({
    status: 'available', current_order_id: null,
    current_power: 0, current_voltage: 0, current_current: 0,
  }).neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('✅ 充电桩全部重置');

  // 验证
  console.log('\n--- 最终状态 ---');
  const { data: stations } = await supabase.from('charging_stations').select('station_number,status').order('station_number');
  for (const s of (stations || [])) {
    console.log(`  ${(s as any).station_number}=${(s as any).status}`);
  }
  const { count: o } = await supabase.from('charging_orders').select('*', { count: 'exact', head: true });
  const { count: b } = await supabase.from('bills').select('*', { count: 'exact', head: true });
  const { count: p } = await supabase.from('parking_fee_orders').select('*', { count: 'exact', head: true });
  const { count: q } = await supabase.from('queue_entries').select('*', { count: 'exact', head: true });
  console.log(`订单:${o || 0} 账单:${b || 0} 停车:${p || 0} 队列:${q || 0}`);
  console.log('\n🎉 深度清理完成');
}

main().catch(console.error);
