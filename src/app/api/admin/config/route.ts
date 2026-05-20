import { NextRequest, NextResponse } from 'next/server';
import { ConfigService } from '@/services/ConfigService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const adminId = searchParams.get('adminId') || undefined;

    const config = await ConfigService.getConfig(adminId);
    return NextResponse.json(config);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { config, adminId } = body;

    if (!adminId || !config) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const updated = await ConfigService.updateConfig(config, adminId);
    return NextResponse.json({ success: true, config: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
