import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';
import { QueueService } from '@/services/QueueService';

let running = false;

export async function POST(_request: NextRequest) {
  if (running) {
    return NextResponse.json({ success: true, skipped: true, reason: 'simulate in progress' });
  }
  running = true;
  try {
    const results = await ChargingService.simulateAllActiveOrders();

    const dispatchResults: { fast: any; slow: any } = { fast: null, slow: null };
    try { dispatchResults.fast = await QueueService.dispatchNext('fast'); } catch {}
    try { dispatchResults.slow = await QueueService.dispatchNext('slow'); } catch {}

    return NextResponse.json({ success: true, results, dispatch: dispatchResults });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  } finally {
    running = false;
  }
}
