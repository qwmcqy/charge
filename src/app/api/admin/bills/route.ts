import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const supabase = createServiceClient();

export async function GET(_request: NextRequest) {
  try {
    const { data: rawBills } = await supabase
      .from('bills')
      .select('*, users(name, vehicle_plate)')
      .order('generated_at', { ascending: false })
      .limit(50);

    const orderIds = (rawBills || []).map((b: any) => b.charging_order_id).filter(Boolean);
    const { data: orders } = await supabase
      .from('charging_orders')
      .select('*')
      .in('id', orderIds);

    const ordersMap = new Map((orders || []).map((o: any) => [o.id, o]));

    const bills = (rawBills || []).map((b: any) => {
      const order = ordersMap.get(b.charging_order_id);
      const mode = order?.mode || 'fast';
      const ratePerKwh = mode === 'fast' ? 1.2 : 0.8;

      let duration = 0;
      if (order?.start_time && order?.end_time) {
        duration = Math.round(
          (new Date(order.end_time).getTime() - new Date(order.start_time).getTime()) / 60000
        );
      }

      return {
        id: b.id,
        charging_order_id: b.charging_order_id,
        user_name: b.users?.name || '未知',
        user_plate: b.users?.vehicle_plate || '未登记',
        charging_fee: b.charging_fee || 0,
        parking_fee: b.parking_fee || 0,
        total_amount: b.total_amount || 0,
        status: b.status || 'unpaid',
        generated_at: b.generated_at,
        paid_at: b.paid_at,
        energy_consumed: order?.energy_consumed || 0,
        charging_duration_minutes: duration,
        rate_per_kwh: ratePerKwh,
        charge_mode: mode,
      };
    });

    return NextResponse.json(bills);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
