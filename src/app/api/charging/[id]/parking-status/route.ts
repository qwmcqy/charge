import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const status = await ChargingService.getParkingStatus(id);

    if (!status) {
      return NextResponse.json({ parked: false });
    }

    return NextResponse.json({ ...status, parked: status.parked });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
