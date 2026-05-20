import { NextResponse } from 'next/server';
import { MonitorService } from '@/services/MonitorService';

export async function GET() {
  try {
    const overview = await MonitorService.getDashboardOverview();
    return NextResponse.json(overview);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
