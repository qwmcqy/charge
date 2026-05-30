import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();
const USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';

async function main() {
  // 检查该用户的账单
  const { data: bills } = await supabase.from('bills')
    .select('*')
    .eq('user_id', USER_ID)
    .order('generated_at', { ascending: false });

  console.log(`用户账单数: ${bills?.length || 0}`);

  if (bills && bills.length > 0) {
    for (const b of bills) {
      const bill = b as any;
      console.log(`\n账单 ${bill.id.slice(0,8)}:`);
      console.log(`  charging_order_id: ${bill.charging_order_id}`);
      console.log(`  charging_fee: ${bill.charging_fee}, parking_fee: ${bill.parking_fee}, total: ${bill.total_amount}`);

      // 检查关联的充电订单是否存在
      const { data: order } = await supabase.from('charging_orders')
        .select('id, status, energy_consumed, start_time, end_time, mode')
        .eq('id', bill.charging_order_id)
        .maybeSingle();

      if (order) {
        console.log(`  充电订单存在: status=${(order as any).status}, energy=${(order as any).energy_consumed}, mode=${(order as any).mode}`);
      } else {
        console.log(`  ❌ 充电订单不存在！(已被删除)`);
      }
    }
  } else {
    console.log('该用户没有账单');
  }

  // 也检查所有账单
  const { data: allBills } = await supabase.from('bills')
    .select('id, charging_order_id, charging_fee, total_amount')
    .limit(5);

  console.log(`\n\n数据库中最近 5 条账单:`);
  for (const b of (allBills || [])) {
    const bill = b as any;
    const { data: order } = await supabase.from('charging_orders')
      .select('id, energy_consumed')
      .eq('id', bill.charging_order_id)
      .maybeSingle();
    console.log(`  ${bill.id.slice(0,8)} order=${bill.charging_order_id?.slice(0,8)} order_exists=${!!order} charging_fee=${bill.charging_fee} total=${bill.total_amount}`);
  }
}

main().catch(console.error);
