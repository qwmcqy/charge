import { Notification, NotificationType } from '@/models/Notification';
import { supabase } from '@/lib/supabase';

export class NotificationService {
  /**
   * 获取用户通知列表
   */
  static async getForUser(userId: string, limit = 50) {
    return Notification.fetchByUser(userId, limit);
  }

  /**
   * 获取未读通知数量
   */
  static async getUnreadCount(userId: string) {
    return Notification.getUnreadCount(userId);
  }

  /**
   * 标记通知已读
   */
  static async markAsRead(notificationId: string, userId: string) {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new Error('通知不存在');

    const notification = new Notification(data as any);
    await notification.markAsRead();
    return notification;
  }

  /**
   * 标记所有通知已读
   */
  static async markAllAsRead(userId: string) {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) throw new Error(`标记已读失败: ${error.message}`);
  }

  /**
   * 发送系统通知
   */
  static async sendSystem(
    userId: string,
    title: string,
    content: string,
    relatedId?: string
  ) {
    return Notification.send(userId, NotificationType.System, title, content, relatedId);
  }

  /**
   * 发送充电完成通知
   */
  static async sendChargingComplete(
    userId: string,
    orderId: string,
    energy: number,
    fee: number
  ) {
    return Notification.send(
      userId,
      NotificationType.ChargingComplete,
      '充电已完成',
      `充电已完成！消耗电量: ${energy.toFixed(2)}kWh，费用: ¥${fee.toFixed(2)}`,
      orderId
    );
  }

  /**
   * 发送排队就绪通知
   */
  static async sendQueueReady(userId: string, orderId: string) {
    return Notification.send(
      userId,
      NotificationType.QueueReady,
      '轮到您充电了',
      '您的充电排队已就绪，请前往充电桩',
      orderId
    );
  }

  /**
   * 发送超时警告
   */
  static async sendOvertimeWarning(
    userId: string,
    parkingOrderId: string,
    overtimeMinutes: number,
    fee: number
  ) {
    return Notification.send(
      userId,
      NotificationType.OvertimeWarning,
      '超时停车警告',
      `您已超时停车 ${overtimeMinutes} 分钟，当前停车费: ¥${fee.toFixed(2)}`,
      parkingOrderId
    );
  }

  /**
   * Supabase Realtime 订阅通知
   */
  static subscribeToNotifications(userId: string, onNotification: (payload: any) => void) {
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => onNotification(payload)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
}
