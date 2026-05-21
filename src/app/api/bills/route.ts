import { NextRequest, NextResponse } from 'next/server';
import { BillService } from '@/services/BillService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
    }

    const bills = await BillService.getUserBills(userId);
    return NextResponse.json(bills);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, chargingOrderId, parkingFeeOrderId } = body;

    if (!userId || !chargingOrderId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const bill = await BillService.generateBillForUser(userId, chargingOrderId, parkingFeeOrderId);
    return NextResponse.json({ success: true, bill });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
