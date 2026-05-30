import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();

async function main() {
  // Use the Supabase auth admin API or management API to run SQL
  // Since service client can't run arbitrary SQL via REST,
  // we use the rpc method with a pre-existing function or direct API call.

  // Alternative: use the fetch API to call Supabase's SQL endpoint
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

  const sql = `
    DROP POLICY IF EXISTS "Admins can read all users" ON public.users;
    CREATE POLICY "Admins can read all users" ON public.users FOR SELECT USING (
      EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid())
    );
  `;

  // Try Supabase Management API
  console.log('Attempting to apply RLS fix via Management API...');

  const resp = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const result = await resp.json();
  console.log('Status:', resp.status);
  console.log('Response:', JSON.stringify(result, null, 2));

  if (resp.ok) {
    console.log('✅ RLS policy applied successfully');
  } else {
    console.log('❌ Management API failed, trying alternative method...');

    // Alternative: Check if we can just use the service client
    // The service role key bypasses RLS, so let's verify by testing
    console.log('\nTesting service client read of users table:');
    const { data: users, error } = await supabase.from('users').select('id, name').limit(5);
    if (error) {
      console.log('Service client error:', error.message);
    } else {
      console.log('Service client can read all users:', (users || []).map((u: any) => u.name).join(', '));
    }

    console.log('\n⚠️  RLS migration needs to be applied manually.');
    console.log('Please run this SQL in the Supabase SQL Editor:');
    console.log('\n' + sql);
  }
}

main().catch(console.error);
