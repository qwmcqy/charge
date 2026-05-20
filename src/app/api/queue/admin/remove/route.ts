import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { Notification, NotificationType } from '@/models/Notification';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { entryId } = body;

    if (!entryId) {
      return NextResponse.json({ error: '缺少 entryId' }, { status: 400 });
    }

    const { data: entry } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('id', entryId)
      .single();

    if (!entry) throw new Error('队列条目不存在');

    await supabase.from('queue_entries').update({ status: 'cancelled' }).eq('id', entryId);
    await supabase.from('charging_orders').update({ status: 'cancelled' }).eq('id', (entry as any).order_id);

    await Notification.send(
      (entry as any).user_id,
      'system' as NotificationType,
      '排队已取消',
      '您的充电排队已被管理员取消',
      (entry as any).order_id
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
