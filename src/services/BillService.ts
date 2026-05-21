import { supabase } from '@/lib/supabase';
import { Bill } from '@/models/Bill';
import { ChargingOrder } from '@/models/ChargingOrder';
import { ParkingFeeOrder } from '@/models/ParkingFeeOrder';
import { calculateTimeOfUseFee } from '@/lib/billing';

export class BillService {
  static async generateBillForUser(
    userId: string,
    chargingOrderId: string,
    parkingFeeOrderId?: string
  ) {
    const chargingOrder = await ChargingOrder.fetchById(chargingOrderId);
    if (chargingOrder.userId !== userId) throw new Error('无权生成此订单的账单');
    return Bill.generate(userId, chargingOrderId, undefined, parkingFeeOrderId);
  }

  static async generateBillForAdmin(chargingOrderId: string) {
    const chargingOrder = await ChargingOrder.fetchById(chargingOrderId);
    const parkingFeeOrder = await ParkingFeeOrder.fetchByChargingOrder(chargingOrderId);
    return Bill.generate(chargingOrder.userId, chargingOrderId, undefined, parkingFeeOrder?.id);
  }

  static async getUserBills(userId: string) {
    return Bill.fetchByUser(userId);
  }

  static async getBillDetail(billId: string, userId: string) {
    const bill = await Bill.fetchById(billId);
    if (bill.userId !== userId) throw new Error('无权查看此账单');
    return bill.getDetail();
  }

  static async getOvertimeList() {
    const { data, error } = await supabase
      .from('parking_fee_orders')
      .select('*, users(name, vehicle_plate), charging_stations(station_number, location)')
      .eq('status', 'parked')
      .order('charge_complete_time', { ascending: true });
    if (error) throw new Error(`获取超时列表失败: ${error.message}`);

    return (data || []).map((po: any) => {
      const parkingOrder = new ParkingFeeOrder(po);
      parkingOrder.calculateOvertimeFee();
      return {
        ...po,
        overtime_minutes: parkingOrder.overtimeMinutes,
        parking_fee: parkingOrder.parkingFee,
      };
    });
  }

  static async verifyBill(billId: string, adminId: string) {
    const bill = await Bill.fetchById(billId);
    const chargingOrder = await ChargingOrder.fetchById(bill.chargingOrderId);
    const expectedFee = chargingOrder.startTime
      ? calculateTimeOfUseFee(chargingOrder.startTime, chargingOrder.energyConsumed, chargingOrder.mode).totalFee
      : chargingOrder.chargingFee;

    await supabase
      .from('bills')
      .update({
        charging_fee: expectedFee,
        total_amount: expectedFee + bill.parkingFee,
      })
      .eq('id', billId);

    return Bill.fetchById(billId);
  }

  static async getBillStats() {
    const { data: bills } = await supabase.from('bills').select('status, total_amount');
    const billList = (bills || []) as any[];
    return {
      totalBills: billList.length,
      paidBills: billList.filter((b: any) => b.status === 'paid').length,
      unpaidBills: billList.filter((b: any) => b.status === 'unpaid').length,
      totalRevenue: billList
        .filter((b: any) => b.status === 'paid')
        .reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0),
    };
  }
}
