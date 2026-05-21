import { NextRequest, NextResponse } from 'next/server';
import { ConfigService } from '@/services/ConfigService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const adminId = searchParams.get('adminId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const format = searchParams.get('format') as 'csv' | 'pdf' | undefined;

    if (!adminId || !startDate || !endDate) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (format) {
      const reportData = await ConfigService.exportReport(
        format,
        { start: new Date(startDate), end: new Date(endDate) },
        adminId
      );
      return NextResponse.json({ data: reportData, format });
    }

    const report = await ConfigService.getReport(
      new Date(startDate),
      new Date(endDate),
      adminId
    );
    return NextResponse.json(report);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
