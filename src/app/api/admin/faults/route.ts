import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const supabase = createServiceClient();

// GET: 列出所有故障（用 service client 绕过 RLS 以显示完整数据）
export async function GET(_request: NextRequest) {
  try {
    const { data, error } = await supabase
      .from('faults')
      .select('*, charging_stations(station_number, location)')
      .order('detected_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
