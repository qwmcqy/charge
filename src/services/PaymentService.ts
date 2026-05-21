import { supabase } from '@/lib/supabase';
import { PaymentOrder } from '@/models/PaymentOrder';
import { Bill } from '@/models/Bill';
import { Notification } from '@/models/Notification';
import { PaymentType, PaymentMethod, NotificationType } from '@/lib/types';
import { PAYMENT_SIMULATION } from '@/lib/constants';

export class PaymentService {
  /**
   * 处理支付（模拟第三方支付）
   */
  static async processPayment(
    userId: string,
    billId: string,
    method: PaymentMethod
  ) {
    // 获取账单
    const bill = await Bill.fetchById(billId);
    if (bill.userId !== userId) throw new Error('无权支付此账单');
    if (bill.status === 'paid') throw new Error('账单已支付');

    // 创建支付单
    const paymentOrder = await PaymentOrder.create(
      userId,
      billId,
      bill.totalAmount,
      bill.parkingFee > 0 ? PaymentType.Combined : PaymentType.ChargingFee
    );

    // 执行支付
    const result = await paymentOrder.processPayment(method);

    // 发送通知
    if (result.success) {
      await Notification.send(
        userId,
        NotificationType.PaymentSuccess,
        '支付成功',
        `账单 ¥${bill.totalAmount} 已支付成功，流水号: ${result.transactionId}`,
        billId
      );
    }

    return result;
  }

  /**
   * 获取用户的支付记录
   */
  static async getUserPaymentHistory(userId: string) {
    const { data, error } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(`获取支付记录失败: ${error.message}`);
    return data;
  }

  /**
   * 验证支付状态
   */
  static async verifyPayment(paymentId: string) {
    const { data, error } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (error) throw new Error(`验证支付失败: ${error.message}`);
    return data;
  }

  /**
   * 退款处理
   */
  static async refund(paymentId: string, reason: string) {
    const { data: payment, error: fetchError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (fetchError || !payment) throw new Error('支付记录不存在');
    if ((payment as any).status !== 'paid') throw new Error('只能对已支付的记录退款');

    const paymentOrder = new PaymentOrder(payment as any);
    await paymentOrder.refund(reason);

    // 更新关联账单
    await supabase
      .from('bills')
      .update({ status: 'cancelled' })
      .eq('id', (payment as any).order_id);

    await Notification.send(
      (payment as any).user_id,
      NotificationType.System,
      '退款已处理',
      `支付 ¥${(payment as any).amount} 已退款，原因: ${reason}`,
      paymentId
    );

    return paymentOrder;
  }
}
