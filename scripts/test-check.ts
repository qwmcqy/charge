import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();

async function main() {
  // Get users
  const { data: users } = await supabase.from('users').select('id, name').limit(5);
  console.log('Users:', JSON.stringify(users, null, 2));

  // Get charging stations
  const { data: stations } = await supabase.from('charging_stations').select('*');
  console.log('\nStations:', JSON.stringify(stations, null, 2));

  // Get active orders
  const { data: orders } = await supabase.from('charging_orders').select('*').in('status', ['charging', 'paused', 'fault_pending']).limit(10);
  console.log('\nActive Orders:', JSON.stringify(orders, null, 2));

  // Get queues
  const { data: queues } = await supabase.from('queues').select('*');
  console.log('\nQueues:', JSON.stringify(queues, null, 2));

  // Get queue entries
  const { data: qEntries } = await supabase.from('queue_entries').select('*').eq('status', 'waiting').order('position', { ascending: true });
  console.log('\nQueue Entries (waiting):', JSON.stringify(qEntries, null, 2));
}

main().catch(console.error);
