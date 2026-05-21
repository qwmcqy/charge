import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
    }

    const progress = await ChargingService.getChargingProgress(id, userId);
    return NextResponse.json(progress);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
