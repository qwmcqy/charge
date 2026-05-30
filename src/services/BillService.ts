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
   * 获取用户账单列表（含充电订单详细信息）
   */
  static async getUserBills(userId: string) {
    const bills = await Bill.fetchByUser(userId);

    // 批量获取关联的充电订单
    const orderIds = bills.map((b) => b.chargingOrderId).filter(Boolean);
    if (orderIds.length === 0) return bills;

    const { data: orders } = await supabase
      .from('charging_orders')
      .select('*')
      .in('id', orderIds);

    const ordersMap = new Map((orders || []).map((o: any) => [o.id, o]));

    // 将充电订单详情合并到账单对象
    return bills.map((bill) => {
      const order = ordersMap.get(bill.chargingOrderId);
      if (!order) return bill;

      const mode = order.mode || 'fast';
      const ratePerKwh = mode === 'fast' ? 1.2 : 0.8;

      let chargingDurationMinutes = 0;
      if (order.start_time && order.end_time) {
        const start = new Date(order.start_time).getTime();
        const end = new Date(order.end_time).getTime();
        chargingDurationMinutes = Math.round((end - start) / 60000);
      }

      return Object.assign(bill, {
        energyConsumed: order.energy_consumed || 0,
        chargingDurationMinutes,
        ratePerKwh,
        chargeMode: mode,
        startTime: order.start_time,
        endTime: order.end_time,
        requestBatteryLevel: order.request_battery_level,
        targetBatteryLevel: order.target_battery_level,
      });
    });
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
