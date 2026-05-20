import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { entryId, newPosition } = body;

    if (!entryId || newPosition === undefined) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const { error } = await supabase
      .from('queue_entries')
      .update({ position: newPosition })
      .eq('id', entryId);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
