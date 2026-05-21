import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function POST(_request: NextRequest) {
  try {
    const results = await ChargingService.simulateAllActiveOrders();
    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
