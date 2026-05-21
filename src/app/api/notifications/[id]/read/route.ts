import { NextRequest, NextResponse } from 'next/server';
import { NotificationService } from '@/services/NotificationService';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const userId = body.userId;

    if (!userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
    }

    await NotificationService.markAsRead(id, userId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
