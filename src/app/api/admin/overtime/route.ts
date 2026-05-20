import { NextRequest, NextResponse } from 'next/server';
import { BillService } from '@/services/BillService';
import { NotificationService } from '@/services/NotificationService';

export async function GET() {
  try {
    const list = await BillService.getOvertimeList();
    return NextResponse.json(list);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { parkingOrderId } = body;

    if (!parkingOrderId) {
      return NextResponse.json({ error: '缺少 parkingOrderId' }, { status: 400 });
    }

    // 发送催离通知（在 Administrator 中已实现逻辑，这里简化处理）
    const { supabase } = await import('@/lib/supabase');
    const { data: order } = await supabase
      .from('parking_fee_orders')
      .select('*')
      .eq('id', parkingOrderId)
      .single();

    if (!order) throw new Error('停车费订单不存在');

    await NotificationService.sendOvertimeWarning(
      (order as any).user_id,
      parkingOrderId,
      (order as any).overtime_minutes,
      (order as any).parking_fee
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
