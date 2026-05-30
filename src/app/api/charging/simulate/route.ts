import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';
import { QueueService } from '@/services/QueueService';

export async function POST(_request: NextRequest) {
  try {
    const results = await ChargingService.simulateAllActiveOrders();

    // 充电模拟后，尝试将排队的订单调度到空闲充电桩
    const dispatchResults: { fast: any; slow: any } = { fast: null, slow: null };
    try {
      dispatchResults.fast = await QueueService.dispatchNext('fast');
    } catch {}
    try {
      dispatchResults.slow = await QueueService.dispatchNext('slow');
    } catch {}

    return NextResponse.json({ success: true, results, dispatch: dispatchResults });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
