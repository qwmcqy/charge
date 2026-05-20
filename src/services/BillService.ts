import { supabase } from '@/lib/supabase';
import { Bill } from '@/models/Bill';
import { ChargingOrder } from '@/models/ChargingOrder';
import { ParkingFeeOrder } from '@/models/ParkingFeeOrder';
import { Notification } from '@/models/Notification';
import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';

export class BillService {
  /**
   * 为用户生成账单
   */
  static async generateBillForUser(
    userId: string,
    chargingOrderId: string,
    parkingFeeOrderId?: string
  ) {
    const config = DEFAULT_SYSTEM_CONFIG;
    const chargingOrder = await ChargingOrder.fetchById(chargingOrderId);
    if (chargingOrder.userId !== userId) throw new Error('无权生成此订单的账单');

    const rate = chargingOrder.mode === 'fast'
      ? config.fastChargeRate
      : config.slowChargeRate;

    const bill = await Bill.generate(userId, chargingOrderId, rate, parkingFeeOrderId);
    return bill;
  }

  /**
   * 管理员为订单生成账单
   */
  static async generateBillForAdmin(chargingOrderId: string) {
    const config = DEFAULT_SYSTEM_CONFIG;
    const chargingOrder = await ChargingOrder.fetchById(chargingOrderId);
    const rate = chargingOrder.mode === 'fast'
      ? config.fastChargeRate
      : config.slowChargeRate;

    const parkingFeeOrder = await ParkingFeeOrder.fetchByChargingOrder(chargingOrderId);

    const bill = await Bill.generate(
      chargingOrder.userId,
      chargingOrderId,
      rate,
      parkingFeeOrder?.id
    );
    return bill;
  }

  /**
   * 获取用户账单列表
   */
  static async getUserBills(userId: string) {
    return Bill.fetchByUser(userId);
  }

  /**
   * 获取账单详情
   */
  static async getBillDetail(billId: string, userId: string) {
    const bill = await Bill.fetchById(billId);
    if (bill.userId !== userId) throw new Error('无权查看此账单');
    return bill.getDetail();
  }

  /**
   * 获取超时车辆列表
   */
  static async getOvertimeList() {
    const { data, error } = await supabase
      .from('parking_fee_orders')
      .select('*, users(name, vehicle_plate), charging_stations(station_number, location)')
      .eq('status', 'parked')
      .order('charge_complete_time', { ascending: true });

    if (error) throw new Error(`获取超时列表失败: ${error.message}`);

    // 更新超时费用
    const result = (data || []).map((po: any) => {
      const parkingOrder = new ParkingFeeOrder(po);
      parkingOrder.calculateOvertimeFee();
      return {
        ...po,
        overtime_minutes: parkingOrder.overtimeMinutes,
        parking_fee: parkingOrder.parkingFee,
      };
    });

    return result;
  }

  /**
   * 管理员核算账单
   */
  static async verifyBill(billId: string, adminId: string) {
    const bill = await Bill.fetchById(billId);
    const chargingOrder = await ChargingOrder.fetchById(bill.chargingOrderId);

    const config = DEFAULT_SYSTEM_CONFIG;
    const rate = chargingOrder.mode === 'fast'
      ? config.fastChargeRate
      : config.slowChargeRate;

    const expectedFee = Math.round(chargingOrder.energyConsumed * rate * 100) / 100;

    // 更新账单
    await supabase
      .from('bills')
      .update({
        charging_fee: expectedFee,
        total_amount: expectedFee + bill.parkingFee,
      })
      .eq('id', billId);

    return Bill.fetchById(billId);
  }

  /**
   * 获取账单统计
   */
  static async getBillStats() {
    const { data: bills } = await supabase
      .from('bills')
      .select('status, total_amount');

    const billList = (bills || []) as any[];
    const stats = {
      totalBills: billList.length,
      paidBills: billList.filter((b: any) => b.status === 'paid').length,
      unpaidBills: billList.filter((b: any) => b.status === 'unpaid').length,
      totalRevenue: billList
        .filter((b: any) => b.status === 'paid')
        .reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0),
    };

    return stats;
  }
}
