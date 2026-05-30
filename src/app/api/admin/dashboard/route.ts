import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const supabase = createServiceClient();

/**
 * GET /api/admin/dashboard
 * 管理员仪表盘数据（使用 service client 绕过 RLS，可读所有用户数据）
 */
export async function GET(_request: NextRequest) {
  try {
    // 1. 获取所有充电桩
    const { data: stations } = await supabase
      .from('charging_stations')
      .select('*')
      .order('station_number');

    // 2. 批量获取充电中的订单 + 用户信息
    const chargingStationIds = (stations || [])
      .filter((s: any) => s.status === 'charging' && s.current_order_id)
      .map((s: any) => s.current_order_id);

    let ordersMap = new Map();
    if (chargingStationIds.length > 0) {
      const { data: orders } = await supabase
        .from('charging_orders')
        .select('id, user_id, energy_consumed, request_battery_level, target_battery_level, mode')
        .in('id', chargingStationIds);

      if (orders) {
        // 批量获取用户名
        const userIds = [...new Set((orders as any[]).map((o: any) => o.user_id))];
        const { data: users } = await supabase
          .from('users')
          .select('id, name, vehicle_plate')
          .in('id', userIds);

        const usersMap = new Map((users || []).map((u: any) => [u.id, u]));

        for (const o of orders) {
          const user = usersMap.get((o as any).user_id);
          ordersMap.set(o.id, {
            id: o.id,
            user_name: user?.name || '未知',
            user_plate: user?.vehicle_plate || '-',
            energy_consumed: (o as any).energy_consumed || 0,
            request_battery_level: (o as any).request_battery_level || 0,
            target_battery_level: (o as any).target_battery_level || 0,
          });
        }
      }
    }

    // 3. 获取排队队列 + 用户信息 + 车牌号
    const { data: queueEntries } = await supabase
      .from('queue_entries')
      .select('id, position, mode, battery_level, estimated_wait_minutes, queue_id, user_id, order_id')
      .eq('status', 'waiting')
      .order('position', { ascending: true })
      .limit(50);

    let queueWithUsers: any[] = [];
    if (queueEntries && queueEntries.length > 0) {
      const qUserIds = [...new Set((queueEntries as any[]).map((e: any) => e.user_id))];
      const { data: qUsers } = await supabase
        .from('users')
        .select('id, name, vehicle_plate')
        .in('id', qUserIds);

      const qUsersMap = new Map((qUsers || []).map((u: any) => [u.id, u]));

      // 获取队列类型
      const { data: queues } = await supabase.from('queues').select('id, type');
      const queuesMap = new Map((queues || []).map((q: any) => [q.id, q.type]));

      queueWithUsers = (queueEntries as any[]).map((e: any) => {
        const user = qUsersMap.get(e.user_id);
        return {
          ...e,
          user_name: user?.name || '未知',
          user_plate: user?.vehicle_plate || '-',
          queue_type: queuesMap.get(e.queue_id) || '?',
        };
      });
    }

    return NextResponse.json({
      stations: stations || [],
      orders: Object.fromEntries(ordersMap),
      queue: queueWithUsers,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
