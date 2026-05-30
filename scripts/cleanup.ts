import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();
const USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';

async function main() {
  // 1. Clean user active orders
  const { data: activeOrders } = await supabase.from('charging_orders')
    .select('id,status').eq('user_id', USER_ID)
    .in('status', ['charging','paused','fault_pending','queued','pending']);

  if (activeOrders && activeOrders.length > 0) {
    console.log(`清理 ${activeOrders.length} 个活跃订单...`);
    for (const o of activeOrders) {
      await supabase.from('queue_entries').delete().eq('order_id', (o as any).id);
      await supabase.from('charging_orders')
        .update({ status: 'cancelled', end_time: new Date().toISOString() })
        .eq('id', (o as any).id);
    }
  }

  // 2. Reset all stations
  await supabase.from('charging_stations')
    .update({ status: 'available', current_order_id: null })
    .neq('status', 'available');

  // 3. Show clean state
  const { data: stations } = await supabase.from('charging_stations')
    .select('station_number,mode,status');
  console.log('充电桩:', (stations || []).map((s: any) => `${s.station_number}=${s.status}`).join(', '));

  const { data: qEntries } = await supabase.from('queue_entries').select('*').eq('status', 'waiting');
  console.log('排队中:', qEntries?.length || 0, '个');

  console.log('\n✅ 环境已就绪，可以进行测试');
}

main().catch(console.error);
