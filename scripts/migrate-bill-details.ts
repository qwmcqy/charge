import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();

async function main() {
  // Try to add columns via raw SQL REST API
  // Since hosted Supabase doesn't allow arbitrary SQL from client,
  // check if columns already exist; if not, add them one by one via REST

  // First, check the current state
  const { data: sample, error } = await supabase.from('bills').select('*').limit(1);
  if (error) {
    console.error('Cannot fetch bills:', error.message);
    return;
  }
  const columns = Object.keys(sample?.[0] || {});
  console.log('Current bills columns:', columns.join(', '));

  // The Supabase JS client doesn't support ALTER TABLE.
  // We need to use the Supabase Management API or run SQL in the dashboard.
  // For now, let's try supabase.rpc or just note what needs to happen.

  const needed = ['energy_consumed', 'charging_duration_minutes', 'rate_per_kwh'];
  const missing = needed.filter(c => !columns.includes(c));

  if (missing.length === 0) {
    console.log('✅ All columns already exist. No migration needed.');
  } else {
    console.log('❌ Missing columns:', missing.join(', '));
    console.log('\nPlease run this SQL in the Supabase SQL Editor:');
    console.log(`
ALTER TABLE public.bills
ADD COLUMN IF NOT EXISTS energy_consumed NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS charging_duration_minutes INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS rate_per_kwh NUMERIC DEFAULT 0;
    `);
  }
}

main().catch(console.error);
