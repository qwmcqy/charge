import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, mode, batteryLevel, targetLevel } = body;

    if (!userId || !mode || batteryLevel === undefined || targetLevel === undefined) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const result = await ChargingService.requestCharge(userId, mode, batteryLevel, targetLevel);

    if ((result as any).directCharge) {
      return NextResponse.json({
        success: true,
        directCharge: true,
        orderId: result.order.id,
        stationNumber: (result as any).station?.stationNumber,
        mode,
        batteryLevel,
        targetLevel,
      });
    }

    // 进入队列
    return NextResponse.json({
      success: true,
      queued: true,
      orderId: result.order.id,
      isOverflow: (result as any).isOverflow,
      position: (result as any).entry?.position,
      estimatedWaitMinutes: (result as any).entry?.estimatedWaitMinutes,
      mode,
      batteryLevel,
      targetLevel,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
