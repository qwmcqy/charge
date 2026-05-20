import { NextResponse } from 'next/server';
import { QueueService } from '@/services/QueueService';

export async function GET() {
  try {
    const queues = await QueueService.getAllQueuesStatus();
    return NextResponse.json(queues);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
