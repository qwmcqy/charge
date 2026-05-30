import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();

async function main() {
  // 模拟 API 端点返回的数据
  const { data: stations } = await supabase.from('charging_stations').select('*').order('station_number');

  // 获取充电中的订单用户信息
  const chargeIds = (stations || []).filter((s: any) => s.current_order_id).map((s: any) => s.current_order_id);
  if (chargeIds.length > 0) {
    const { data: orders } = await supabase.from('charging_orders').select('id, user_id').in('id', chargeIds);
    if (orders && orders.length > 0) {
      const userIds = [...new Set((orders as any[]).map(o => o.user_id))];
      const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
      const uMap = new Map((users || []).map((u: any) => [u.id, u.name]));
      console.log('充电中的用户:');
      for (const o of orders) {
        console.log(`  order=${(o as any).id.slice(0,8)} user=${uMap.get((o as any).user_id)}`);
      }
    }
  }

  // 获取排队队列 + 用户名
  const { data: qEntries } = await supabase.from('queue_entries').select('*').eq('status', 'waiting').order('position');
  if (qEntries && qEntries.length > 0) {
    const qUserIds = [...new Set(qEntries.map((e: any) => e.user_id))];
    const { data: qUsers } = await supabase.from('users').select('id, name, vehicle_plate').in('id', qUserIds);
    const uMap = new Map((qUsers || []).map((u: any) => [u.id, u]));
    const pMap = new Map((qUsers || []).map((u: any) => [u.id, (u as any).vehicle_plate]));

    console.log('\n排队队列:');
    for (const e of qEntries) {
      const userId = (e as any).user_id;
      console.log(`  #${(e as any).position} ${uMap.get(userId)} | 车牌: ${pMap.get(userId) || '-'} | 电量: ${(e as any).battery_level}%`);
    }
  } else {
    console.log('\n排队队列: 空');
  }

  // 充电桩状态
  console.log('\n充电桩:');
  (stations || []).forEach((s: any) => console.log(`  ${s.station_number} mode=${s.mode} status=${s.status}`));
}

main().catch(console.error);
