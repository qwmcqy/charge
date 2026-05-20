import { NextRequest, NextResponse } from 'next/server';
import { FaultService } from '@/services/FaultService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { adminId, resolution } = body;

    if (!adminId || !resolution) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const fault = await FaultService.handleFault(id, adminId, resolution);
    return NextResponse.json({ success: true, fault });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
