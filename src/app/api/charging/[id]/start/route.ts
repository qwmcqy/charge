import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';
import { createServiceClient } from '@/lib/supabase';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Debug: check what stations are available
    const supabase = createServiceClient();
    const { data: stations } = await supabase
      .from('charging_stations')
      .select('station_number, mode, status');

    const availableStations = (stations || []).filter((s: any) => s.status === 'available');

    const { data: order } = await supabase
      .from('charging_orders')
      .select('mode')
      .eq('id', id)
      .single();

    const matchingAvailable = availableStations.filter((s: any) => s.mode === (order as any)?.mode);

    if (matchingAvailable.length === 0) {
      const allStations = (stations || []).map((s: any) => `${s.station_number}(${s.mode}/${s.status})`).join(', ');
      return NextResponse.json({
        error: `暂无可用的充电桩。订单模式: ${(order as any)?.mode}。充电桩状态: ${allStations || '(无充电桩数据)'}。请确认 charging_stations 表中有 status='available' 的充电桩。`
      }, { status: 400 });
    }

    const result = await ChargingService.assignAndStartCharging(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
