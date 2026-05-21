import { NextRequest, NextResponse } from 'next/server';
import { PaymentService } from '@/services/PaymentService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, billId, method } = body;

    if (!userId || !billId || !method) {
      return NextResponse.json({ error: '缺少必要参数 (userId, billId, method)' }, { status: 400 });
    }

    const result = await PaymentService.processPayment(userId, billId, method);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
    }

    const history = await PaymentService.getUserPaymentHistory(userId);
    return NextResponse.json(history);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
