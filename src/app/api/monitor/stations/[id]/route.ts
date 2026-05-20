import { NextRequest, NextResponse } from 'next/server';
import { MonitorService } from '@/services/MonitorService';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await MonitorService.getStationRealtime(id);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
