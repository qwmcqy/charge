import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { Fault } from '@/models/Fault';
import { FaultType, FaultSeverity, NotificationType } from '@/lib/types';
import { Notification } from '@/models/Notification';

const supabase = createServiceClient();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await request.json();

    const { data: order, error: orderErr } = await supabase
      .from('charging_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (orderErr || !order) throw new Error('订单不存在');
    if ((order as any).user_id !== userId) throw new Error('无权操作此订单');
    if (!['charging', 'paused'].includes((order as any).status)) {
      throw new Error('订单不在充电中，无法模拟故障');
    }

    const stationId = (order as any).station_id;
    if (!stationId) throw new Error('订单未分配充电桩');

    const fault = new Fault({
      id: '',
      station_id: stationId,
      type: FaultType.Overheating,
      severity: FaultSeverity.Major,
      description: '模拟演示故障：充电桩温度异常升高（演示用）',
      detected_at: new Date().toISOString(),
      affected_order_id: id,
    });

    await fault.report(true); // 跳过订单状态更新

    // 设置为故障待处理状态，等待用户选择
    await supabase
      .from('charging_orders')
      .update({ status: 'fault_pending' })
      .eq('id', id);

    await Notification.send(
      userId,
      NotificationType.System,
      '充电异常 — 请选择处理方式（模拟故障）',
      `您的充电因模拟故障已中断。您可以：① 结束本次充电；② 优先插入队列第一位，等充电桩恢复后继续充电。故障ID: ${fault.id?.slice(0, 8)}`,
      id
    );

    return NextResponse.json({ success: true, faultId: fault.id, faultPending: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
