import { createServiceClient } from '../src/lib/supabase';
const s = createServiceClient();
async function main() {
  const { data: q } = await s.from('queues').select('*');
  q?.forEach((x: any) => console.log(x.id, x.type, x.max_size));
}
main();
