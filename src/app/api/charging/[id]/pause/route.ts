import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await ChargingService.pauseCharging(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
