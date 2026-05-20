import { supabase } from '@/lib/supabase';
import { StationStatus, ChargeMode, FaultType, FaultSeverity } from '@/lib/types';
import { Fault } from './Fault';
import { FAULT_THRESHOLDS, SIMULATION } from '@/lib/constants';

export { StationStatus, ChargeMode };

export class ChargingStation {
  id: string;
  stationNumber: string;
  mode: ChargeMode;
  status: StationStatus;
  location: string;
  maxPower: number;
  currentVoltage: number;
  currentCurrent: number;
  currentPower: number;
  cumulativeEnergy: number;
  temperature: number;
  lastMaintenanceAt: Date;
  currentOrderId?: string;

  constructor(data: {
    id: string; station_number: string; mode: string; status: string;
    location: string; max_power: number; current_voltage: number;
    current_current: number; current_power: number; cumulative_energy: number;
    temperature: number; last_maintenance_at: string; current_order_id?: string;
  }) {
    this.id = data.id;
    this.stationNumber = data.station_number;
    this.mode = data.mode as ChargeMode;
    this.status = data.status as StationStatus;
    this.location = data.location;
    this.maxPower = data.max_power;
    this.currentVoltage = data.current_voltage;
    this.currentCurrent = data.current_current;
    this.currentPower = data.current_power;
    this.cumulativeEnergy = data.cumulative_energy;
    this.temperature = data.temperature;
    this.lastMaintenanceAt = new Date(data.last_maintenance_at);
    this.currentOrderId = data.current_order_id || undefined;
  }

  async startCharging(orderId: string): Promise<void> {
    this.status = StationStatus.Charging;
    this.currentOrderId = orderId;

    // Initialize telemetry data
    this.simulateChargingData(0);

    await supabase
      .from('charging_stations')
      .update({
        status: 'charging',
        current_order_id: orderId,
        current_voltage: this.currentVoltage,
        current_current: this.currentCurrent,
        current_power: Math.round(this.currentVoltage * this.currentCurrent * SIMULATION.powerFactor),
        temperature: this.temperature,
      })
      .eq('id', this.id);
  }

  async stopCharging(): Promise<void> {
    this.status = StationStatus.Available;
    this.currentOrderId = undefined;
    this.currentVoltage = 0;
    this.currentCurrent = 0;
    this.currentPower = 0;

    await supabase
      .from('charging_stations')
      .update({
        status: 'available',
        current_order_id: null,
        current_voltage: 0,
        current_current: 0,
        current_power: 0,
      })
      .eq('id', this.id);
  }

  getRealtimeData() {
    return {
      stationId: this.id,
      voltage: this.currentVoltage,
      current: this.currentCurrent,
      power: this.currentPower,
      energy: this.cumulativeEnergy,
      temperature: this.temperature,
      status: this.status,
      timestamp: new Date().toISOString(),
    };
  }

  async reportStatus(): Promise<void> {
    await supabase
      .from('charging_stations')
      .update({
        current_voltage: this.currentVoltage,
        current_current: this.currentCurrent,
        current_power: Math.round(this.currentVoltage * this.currentCurrent * SIMULATION.powerFactor) / 1000,
        cumulative_energy: this.cumulativeEnergy,
        temperature: this.temperature,
      })
      .eq('id', this.id);

    await supabase.from('station_logs').insert({
      station_id: this.id,
      event_type: 'status_report',
      data: this.getRealtimeData() as any,
    });
  }

  detectFault(): Fault | null {
    if (this.status === StationStatus.Fault || this.status === StationStatus.Offline) {
      return null;
    }

    if (this.temperature > FAULT_THRESHOLDS.maxTemperature) {
      return Fault.detect(this.id, FaultType.Overheating, FaultSeverity.Major,
        `温度过高: ${this.temperature}°C，超过阈值 ${FAULT_THRESHOLDS.maxTemperature}°C`);
    }
    if (this.currentVoltage < FAULT_THRESHOLDS.minVoltage && this.currentVoltage > 0) {
      return Fault.detect(this.id, FaultType.VoltageAbnormal, FaultSeverity.Major,
        `电压异常: ${this.currentVoltage}V，低于最低阈值 ${FAULT_THRESHOLDS.minVoltage}V`);
    }
    if (this.currentVoltage > FAULT_THRESHOLDS.maxVoltage) {
      return Fault.detect(this.id, FaultType.VoltageAbnormal, FaultSeverity.Critical,
        `电压异常: ${this.currentVoltage}V，超过最高阈值 ${FAULT_THRESHOLDS.maxVoltage}V`);
    }
    const maxCurrent = this.mode === ChargeMode.Fast ? FAULT_THRESHOLDS.maxCurrent : FAULT_THRESHOLDS.maxCurrentSlow;
    if (this.currentCurrent > maxCurrent) {
      return Fault.detect(this.id, FaultType.CurrentAbnormal, FaultSeverity.Critical,
        `电流异常: ${this.currentCurrent}A，超过阈值 ${maxCurrent}A`);
    }

    return null;
  }

  isAvailable(): boolean {
    return this.status === StationStatus.Available;
  }

  estimateChargeTime(batteryCapacity: number, targetPercent: number): number {
    const speed = this.mode === ChargeMode.Fast
      ? SIMULATION.chargingSpeedFast
      : SIMULATION.chargingSpeedSlow;
    return Math.ceil(targetPercent / speed);
  }

  // 模拟充电数据更新
  simulateChargingData(elapsedMinutes: number) {
    const speed = this.mode === ChargeMode.Fast
      ? SIMULATION.chargingSpeedFast
      : SIMULATION.chargingSpeedSlow;

    this.currentVoltage = SIMULATION.voltageNominal + (Math.random() - 0.5) * 20;
    this.currentCurrent = this.mode === ChargeMode.Fast
      ? SIMULATION.currentFastNominal + (Math.random() - 0.5) * 20
      : SIMULATION.currentSlowNominal + (Math.random() - 0.5) * 4;
    this.currentPower = this.currentVoltage * this.currentCurrent * SIMULATION.powerFactor / 1000;
    this.cumulativeEnergy += this.currentPower * (elapsedMinutes / 60);
    this.temperature = 25 + (this.mode === ChargeMode.Fast ? 30 : 10) * Math.min(1, elapsedMinutes / 60) + (Math.random() - 0.5) * 5;
  }

  static async fetchById(stationId: string): Promise<ChargingStation> {
    const { data, error } = await supabase
      .from('charging_stations')
      .select('*')
      .eq('id', stationId)
      .single();

    if (error || !data) throw new Error('充电桩不存在');
    return new ChargingStation(data as any);
  }

  static async fetchAll(): Promise<ChargingStation[]> {
    const { data, error } = await supabase
      .from('charging_stations')
      .select('*')
      .order('station_number');

    if (error) throw new Error(`获取充电桩列表失败: ${error.message}`);
    return (data || []).map((s: any) => new ChargingStation(s));
  }

  static async fetchAvailable(mode: ChargeMode): Promise<ChargingStation | null> {
    const { data, error } = await supabase
      .from('charging_stations')
      .select('*')
      .eq('mode', mode)
      .eq('status', 'available')
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return new ChargingStation(data as any);
  }
}
