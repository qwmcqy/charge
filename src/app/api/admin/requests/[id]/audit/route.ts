import { NextRequest, NextResponse } from 'next/server';
import { ChargingService } from '@/services/ChargingService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { adminId, approved, reason } = body;

    if (!adminId) {
      return NextResponse.json({ error: '缺少 adminId' }, { status: 400 });
    }

    await ChargingService.auditRequest(id, adminId, approved, reason);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
