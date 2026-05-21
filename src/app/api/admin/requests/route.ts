import { NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function GET() {
  try {
    const requests = await ChargingService.getPendingRequests();
    return NextResponse.json(requests);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
