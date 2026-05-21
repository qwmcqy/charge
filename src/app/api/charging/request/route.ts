import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, mode, batteryLevel = 0, targetLevel, requestedKwh } = body;
    const amount = requestedKwh ?? targetLevel;

    if (!userId || !mode || amount === undefined) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const result = await ChargingService.requestCharge(userId, mode, batteryLevel, Number(amount));

    if ((result as any).directCharge) {
      return NextResponse.json({
        success: true,
        directCharge: true,
        orderId: result.order.id,
        stationNumber: (result as any).station?.stationNumber,
        mode,
        requestedKwh: Number(amount),
      });
    }

    return NextResponse.json({
      success: true,
      queued: true,
      orderId: result.order.id,
      isOverflow: (result as any).isOverflow,
      position: (result as any).entry?.position || (result as any).position,
      estimatedWaitMinutes: (result as any).entry?.estimatedWaitMinutes || (result as any).estimatedWaitMinutes,
      mode,
      requestedKwh: Number(amount),
      stationNumber: (result as any).station?.station_number || (result as any).station?.stationNumber,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
