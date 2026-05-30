import { createServiceClient } from '../src/lib/supabase';

const s = createServiceClient();

async function main() {
  const { data: stations } = await s.from('charging_stations').select('*');
  console.log('=== 充电桩 ===');
  (stations||[]).forEach((st:any) => console.log('  '+st.station_number+' mode='+st.mode+' status='+st.status+' order='+(st.current_order_id||'-').slice(0,8)));

  const { data: fastQ } = await s.from('queue_entries').select('*').eq('queue_id','e62b73d4-2f1b-41b8-ab1c-3302287dcb72').order('position');
  console.log('\n=== 快充队列 ===');
  (fastQ||[]).forEach((e:any) => console.log('  #'+e.position+' status='+e.status+' user='+(e.user_id||'').slice(0,8)+' order='+(e.order_id||'').slice(0,8)));

  const { data: waitQ } = await s.from('queue_entries').select('*').eq('queue_id','ee8e7f9c-78ee-43e5-b460-817d6f1d4a06').order('position');
  console.log('\n=== 等候队列 ===');
  (waitQ||[]).forEach((e:any) => console.log('  #'+e.position+' status='+e.status+' user='+(e.user_id||'').slice(0,8)));

  const { data: activeOrders } = await s.from('charging_orders').select('id,status,user_id,station_id,mode').in('status',['charging','paused','fault_pending','queued']);
  console.log('\n=== 活跃订单 ===');
  (activeOrders||[]).forEach((o:any) => console.log('  '+o.id.slice(0,8)+' status='+o.status+' user='+(o.user_id||'').slice(0,8)+' station='+(o.station_id||'-').slice(0,8)+' mode='+o.mode));

  // Check faults
  const { data: faults } = await s.from('faults').select('id,station_id,resolved_at').is('resolved_at', null);
  console.log('\n=== 未解决故障 ===');
  (faults||[]).forEach((f:any) => console.log('  '+f.id.slice(0,8)+' station='+(f.station_id||'').slice(0,8)));
}

main().catch(console.error);
