import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { userId, mode, requestedKwh } = body;
    if (!userId) return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });

    const result = await ChargingService.changeRequest(id, userId, mode, requestedKwh);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
