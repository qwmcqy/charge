import { NextRequest, NextResponse } from 'next/server';
import { QueueService } from '@/services/QueueService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
    }

    const status = await QueueService.getUserQueueStatus(userId);
    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
