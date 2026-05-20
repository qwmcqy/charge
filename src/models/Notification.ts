import { supabase } from '@/lib/supabase';
import { NotificationType } from '@/lib/types';

export { NotificationType };

export class Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  read: boolean;
  relatedId?: string;
  createdAt: Date;

  constructor(data: {
    id: string; user_id: string; type: string; title: string;
    content: string; read: boolean; related_id?: string; created_at: string;
  }) {
    this.id = data.id;
    this.userId = data.user_id;
    this.type = data.type as NotificationType;
    this.title = data.title;
    this.content = data.content;
    this.read = data.read;
    this.relatedId = data.related_id;
    this.createdAt = new Date(data.created_at);
  }

  static async send(
    userId: string, type: NotificationType, title: string, content: string,
    relatedId?: string
  ): Promise<Notification> {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        title,
        content,
        related_id: relatedId || null,
      })
      .select()
      .single();

    if (error) throw new Error(`发送通知失败: ${error.message}`);
    return new Notification(data as any);
  }

  async markAsRead(): Promise<void> {
    this.read = true;
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', this.id);
  }

  static async fetchByUser(userId: string, limit = 50): Promise<Notification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`获取通知失败: ${error.message}`);
    return (data || []).map((n: any) => new Notification(n));
  }

  static async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) return 0;
    return count || 0;
  }
}
