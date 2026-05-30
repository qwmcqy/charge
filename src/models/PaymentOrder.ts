import { supabase } from '@/lib/supabase';
import { PaymentStatus, PaymentType, PaymentMethod } from '@/lib/types';
import { PAYMENT_SIMULATION } from '@/lib/constants';

export { PaymentStatus, PaymentType, PaymentMethod };

export class PaymentOrder {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  type: PaymentType;
  status: PaymentStatus;
  method?: PaymentMethod;
  transactionId?: string;
  paidAt?: Date;
  createdAt: Date;

  constructor(data: {
    id: string; order_id: string; user_id: string; amount: number;
    type: string; status: string; method?: string; transaction_id?: string;
    paid_at?: string; created_at: string;
  }) {
    this.id = data.id;
    this.orderId = data.order_id;
    this.userId = data.user_id;
    this.amount = data.amount;
    this.type = data.type as PaymentType;
    this.status = data.status as PaymentStatus;
    this.method = data.method as PaymentMethod | undefined;
    this.transactionId = data.transaction_id;
    this.paidAt = data.paid_at ? new Date(data.paid_at) : undefined;
    this.createdAt = new Date(data.created_at);
  }

  static async create(
    userId: string, orderId: string, amount: number, type: PaymentType
  ): Promise<PaymentOrder> {
    const { data, error } = await supabase
      .from('payment_orders')
      .insert({
        user_id: userId,
        order_id: orderId,
        amount,
        type,
        status: 'unpaid',
      })
      .select()
      .single();

    if (error) throw new Error(`创建支付单失败: ${error.message}`);
    return new PaymentOrder(data as any);
  }

  async processPayment(method: PaymentMethod) {
    this.method = method;
    this.status = PaymentStatus.Pending;

    await supabase
      .from('payment_orders')
      .update({ status: 'pending', method })
      .eq('id', this.id);

    // 模拟第三方支付
    const success = Math.random() < PAYMENT_SIMULATION.successRate;
    this.transactionId = success
      ? `TXN${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`
      : undefined;

    this.status = success ? PaymentStatus.Paid : PaymentStatus.Failed;
    this.paidAt = success ? new Date() : undefined;

    await supabase
      .from('payment_orders')
      .update({
        status: this.status,
        transaction_id: this.transactionId,
        paid_at: this.paidAt?.toISOString() || null,
      })
      .eq('id', this.id);

    if (success) {
      // 更新关联的账单状态
      await supabase
        .from('bills')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', this.orderId);
    }

    return {
      success,
      transactionId: this.transactionId,
      message: success ? '支付成功' : '支付失败，请重试',
    };
  }

  async verifyPayment(): Promise<boolean> {
    const { data, error } = await supabase
      .from('payment_orders')
      .select('status')
      .eq('id', this.id)
      .single();

    if (error) return false;
    return data.status === 'paid';
  }

  async refund(reason: string): Promise<void> {
    void reason;
    this.status = PaymentStatus.Refunded;

    await supabase
      .from('payment_orders')
      .update({ status: 'refunded' })
      .eq('id', this.id);
  }
}
