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

    const { data: parkings } = await supabase
      .from('parking_fee_orders')
      .select('*')
      .in('charging_order_id', orderIds);
    const parkingMap = new Map((parkings || []).map((p: any) => [p.charging_order_id, p]));

    const bills = (rawBills || []).map((b: any) => {
      const order = ordersMap.get(b.charging_order_id);
      const parking = parkingMap.get(b.charging_order_id);
      const mode = order?.mode || 'fast';
      const ratePerKwh = mode === 'fast' ? 1.2 : 0.8;

      let chargingDuration = 0;
      if (order?.start_time && order?.end_time) {
        chargingDuration = Math.round(
          (new Date(order.end_time).getTime() - new Date(order.start_time).getTime()) / 60000
        );
      }

      let parkingDuration = 0;
      let overtimeMinutes = 0;
      if (parking?.charge_complete_time && parking?.depart_time) {
        parkingDuration = Math.round(
          (new Date(parking.depart_time).getTime() - new Date(parking.charge_complete_time).getTime()) / 60000
        );
      }
      if (parking?.overtime_minutes) {
        overtimeMinutes = parking.overtime_minutes;
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
        charging_duration_minutes: chargingDuration,
        parking_duration_minutes: parkingDuration,
        overtime_minutes: overtimeMinutes,
        rate_per_kwh: ratePerKwh,
        charge_mode: mode,
      };
    });

    return NextResponse.json(bills);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
