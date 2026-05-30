import { BillService } from '../src/services/BillService';
import { createServiceClient } from '../src/lib/supabase';

const supabase = createServiceClient();
const USER_ID = '93889d55-59b5-4a62-88b1-bb69e761d98d';

async function main() {
  // Test 1: BillService.getUserBills()
  console.log('=== Test 1: BillService.getUserBills() ===');
  const bills = await BillService.getUserBills(USER_ID);
  console.log(`Count: ${bills.length}`);
  bills.forEach((bill: any, i: number) => {
    console.log(`\nBill ${i + 1}:`);
    console.log(`  id: ${bill.id}`);
    console.log(`  chargingOrderId: ${bill.chargingOrderId}`);
    console.log(`  chargingFee: ${bill.chargingFee}`);
    console.log(`  energyConsumed: ${bill.energyConsumed}`);
    console.log(`  chargingDurationMinutes: ${bill.chargingDurationMinutes}`);
    console.log(`  ratePerKwh: ${bill.ratePerKwh}`);
    console.log(`  chargeMode: ${bill.chargeMode}`);
    // Check if Object.assign worked
    console.log(`  has own 'energyConsumed': ${bill.hasOwnProperty('energyConsumed')}`);
  });

  // Test 2: Check the actual charging order
  if (bills.length > 0) {
    const bill = bills[0] as any;
    console.log('\n=== Test 2: Raw charging order ===');
    const { data: order } = await supabase.from('charging_orders')
      .select('*')
      .eq('id', bill.chargingOrderId)
      .single();
    console.log(`  energy_consumed: ${(order as any).energy_consumed}`);
    console.log(`  mode: ${(order as any).mode}`);
    console.log(`  start_time: ${(order as any).start_time}`);
    console.log(`  end_time: ${(order as any).end_time}`);
    console.log(`  request_battery_level: ${(order as any).request_battery_level}`);
    console.log(`  target_battery_level: ${(order as any).target_battery_level}`);

    // Calculate what should show
    const energy = (order as any).energy_consumed;
    const mode = (order as any).mode;
    const rate = mode === 'fast' ? 1.2 : 0.8;
    console.log(`\n  期望充电费: ${energy} kWh × ¥${rate}/kWh = ¥${(energy * rate).toFixed(2)}`);
    console.log(`  实际账单 charging_fee: ${bill.chargingFee}`);
  }

  // Test 3: Simulate API response
  console.log('\n=== Test 3: Simulated API response ===');
  const result = bills.map((bill: any) => ({
    id: bill.id,
    chargingFee: bill.chargingFee ?? bill.charging_fee ?? 0,
    totalAmount: bill.totalAmount ?? bill.total_amount ?? 0,
    energyConsumed: bill.energyConsumed ?? 0,
    chargingDurationMinutes: bill.chargingDurationMinutes ?? 0,
    ratePerKwh: bill.ratePerKwh ?? 0,
    chargeMode: bill.chargeMode ?? 'fast',
  }));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
