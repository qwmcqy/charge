import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { FaultService } from '@/services/FaultService';

const supabase = createServiceClient();

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败';
}

// GET: 列出所有故障（用 service client 绕过 RLS 以显示完整数据）
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('faults')
      .select('*, charging_stations(station_number, location)')
      .order('detected_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

// POST: Handle and resolve a fault from the admin fault list.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { faultId, adminId, resolution } = body;

    if (!faultId || !adminId || !resolution) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const fault = await FaultService.handleFault(faultId, adminId, resolution);
    await FaultService.resolveFault(faultId);

    return NextResponse.json({ success: true, fault });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}
