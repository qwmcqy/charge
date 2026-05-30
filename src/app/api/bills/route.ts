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

    // 返回结构化数据，包含充电详情
    const result = bills.map((bill: any) => ({
      id: bill.id,
      chargingOrderId: bill.chargingOrderId || bill.charging_order_id,
      chargingFee: bill.chargingFee ?? bill.charging_fee ?? 0,
      parkingFee: bill.parkingFee ?? bill.parking_fee ?? 0,
      totalAmount: bill.totalAmount ?? bill.total_amount ?? 0,
      generatedAt: bill.generatedAt || bill.generated_at,
      paidAt: bill.paidAt || bill.paid_at,
      status: bill.status,
      // 充电详情
      energyConsumed: bill.energyConsumed ?? 0,
      chargingDurationMinutes: bill.chargingDurationMinutes ?? 0,
      ratePerKwh: bill.ratePerKwh ?? 0,
      chargeMode: bill.chargeMode ?? 'fast',
      startTime: bill.startTime,
      endTime: bill.endTime,
      requestBatteryLevel: bill.requestBatteryLevel,
      targetBatteryLevel: bill.targetBatteryLevel,
    }));

    return NextResponse.json({ bills: result });
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
