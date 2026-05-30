import { createServiceClient } from '../src/lib/supabase';
import { QueueService } from '../src/services/QueueService';

const supabase = createServiceClient();
const MAIN_USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';

async function main() {
  console.log('=== 自动调度测试 ===\n');

  // 1. 确保所有桩可用
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).neq('status', 'available');
  console.log('✅ 所有充电桩 already→available');

  // 2. 创建 2 个排队订单
  for (let i = 0; i < 2; i++) {
    const { data: order } = await supabase.from('charging_orders').insert({
      user_id: MAIN_USER_ID,
      mode: 'fast',
      status: 'queued',
      request_battery_level: 30 + i * 10,
      target_battery_level: 80,
    }).select().single();
    const orderId = (order as any).id;

    // 手动调 autoAssignToQueue（因为 tryChargeOrQueue 会检测到 available station 然后直接充电）
    await supabase.from('queue_entries').insert({
      user_id: MAIN_USER_ID,
      order_id: orderId,
      queue_id: 'e62b73d4-2f1b-41b8-ab1c-3302287dcb72',
      mode: 'fast',
      position: i + 1,
      status: 'waiting',
      battery_level: 30 + i * 10,
      estimated_wait_minutes: 40,
    });
    console.log(`  排队订单 #${i + 1}: ${orderId.slice(0, 8)}`);
  }

  // 3. 查看调度前状态
  const { data: beforeStations } = await supabase.from('charging_stations').select('station_number,status');
  console.log('\n调度前充电桩:', (beforeStations||[]).map((s:any) => `${s.station_number}=${s.status}`).join(', '));

  const { count: beforeQueue } = await supabase.from('queue_entries').select('*', { count: 'exact', head: true }).eq('status', 'waiting');
  console.log(`排队中: ${beforeQueue || 0} 人`);

  // 4. 调用调度
  console.log('\n📞 调用 dispatchNext("fast")...');
  const result = await QueueService.dispatchNext('fast');
  console.log(`  结果: ${result ? '✅ 已调度' : '❌ 无结果'}`);

  // 5. 查看调度后状态
  const { data: afterStations } = await supabase.from('charging_stations').select('station_number,status,current_order_id');
  console.log('\n调度后充电桩:');
  (afterStations||[]).forEach((s:any) => console.log(`  ${s.station_number}=${s.status} order=${(s.current_order_id || '-').slice(0, 8)}`));

  const { data: afterQueue } = await supabase.from('queue_entries').select('*').eq('status', 'waiting').order('position');
  console.log(`\n剩余排队: ${afterQueue?.length || 0} 人`);
  (afterQueue||[]).forEach((e:any) => console.log(`  #${e.position} ${(e.order_id as string).slice(0, 8)} status=${e.status}`));

  const { data: chargingOrders } = await supabase.from('charging_orders').select('id,status,station_id').eq('status', 'charging');
  console.log(`\n充电中订单: ${chargingOrders?.length || 0}`);
  (chargingOrders||[]).forEach((o:any) => console.log(`  ${o.id.slice(0, 8)} station=${(o.station_id||'').slice(0, 8)}`));

  // 6. 再调度一次（应该能调度第二个）
  console.log('\n📞 第二次 dispatchNext("fast")...');
  const result2 = await QueueService.dispatchNext('fast');
  console.log(`  结果: ${result2 ? '✅ 已调度' : '❌ 无结果'}`);

  const { data: finalStations } = await supabase.from('charging_stations').select('station_number,status');
  console.log('最终充电桩:', (finalStations||[]).map((s:any) => `${s.station_number}=${s.status}`).join(', '));
  const { count: finalQ } = await supabase.from('queue_entries').select('*', { count: 'exact', head: true }).eq('status', 'waiting');
  console.log(`最终排队: ${finalQ || 0} 人`);

  // 清理
  await supabase.from('queue_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { data: cleanupOrders } = await supabase.from('charging_orders').select('id').eq('user_id', MAIN_USER_ID).in('status', ['queued', 'charging']);
  for (const o of (cleanupOrders || [])) {
    await supabase.from('charging_orders').update({ status: 'cancelled', end_time: new Date().toISOString() }).eq('id', (o as any).id);
  }
  await supabase.from('charging_stations').update({ status: 'available', current_order_id: null }).neq('status', 'available');

  console.log('\n✅ 测试完成');
}

main().catch(console.error);
