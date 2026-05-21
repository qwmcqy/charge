import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
    }

    const result = await ChargingService.depart(id, userId);

    return NextResponse.json({
      success: true,
      overtimeMinutes: result.overtimeMinutes,
      parkingFee: result.parkingFee,
      totalAmount: result.totalAmount,
      billId: result.bill.id,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
