import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, decision } = await request.json();

    if (!userId || !decision) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['end', 'requeue'].includes(decision)) {
      return NextResponse.json({ error: 'decision 必须为 end 或 requeue' }, { status: 400 });
    }

    const result = await ChargingService.handleFaultDecision(id, userId, decision);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
