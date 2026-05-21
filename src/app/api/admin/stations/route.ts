import { NextRequest, NextResponse } from 'next/server';
import { ConfigService } from '@/services/ConfigService';

export async function GET() {
  try {
    const stations = await ConfigService.getAllStations();
    return NextResponse.json(stations);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data, adminId } = body;

    if (!adminId || !data) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const station = await ConfigService.addStation(data, adminId);
    return NextResponse.json({ success: true, station });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { stationId, data, adminId } = body;

    if (!stationId || !adminId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    await ConfigService.updateStation(stationId, data, adminId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const stationId = searchParams.get('stationId');
    const adminId = searchParams.get('adminId');

    if (!stationId || !adminId) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    await ConfigService.removeStation(stationId, adminId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
