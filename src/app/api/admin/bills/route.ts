import { NextRequest, NextResponse } from 'next/server';
import { BillService } from '@/services/BillService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chargingOrderId } = body;

    if (!chargingOrderId) {
      return NextResponse.json({ error: '缺少 chargingOrderId' }, { status: 400 });
    }

    const bill = await BillService.generateBillForAdmin(chargingOrderId);
    return NextResponse.json({ success: true, bill });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function GET() {
  try {
    const stats = await BillService.getBillStats();
    return NextResponse.json(stats);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
