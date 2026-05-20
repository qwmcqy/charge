import { NextRequest, NextResponse } from 'next/server';
import { FaultService } from '@/services/FaultService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as 'open' | 'resolved' | undefined;

    const faults = await FaultService.getAllFaults(status);
    const stats = await FaultService.getFaultStats();
    return NextResponse.json({ faults, stats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
