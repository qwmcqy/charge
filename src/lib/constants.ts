import type { SystemConfig } from './types';

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  fastChargeRate: 1.2,            // 快充费率(元/kWh)
  slowChargeRate: 0.8,            // 慢充费率(元/kWh)
  parkingRatePerMinute: 0.1,      // 超时停车费(元/分钟)
  parkingGracePeriodMinutes: 15,  // 停车宽限期(分钟)
  fastQueueMaxSize: 20,
  slowQueueMaxSize: 30,
  waitingQueueMaxSize: 9999, // 等候队列无实际长度限制
  avgFastChargeMinutes: 40,       // 快充平均时长(分钟)
  avgSlowChargeMinutes: 180,      // 慢充平均时长(分钟)
  overtimeThresholdMinutes: 30,   // 超时提醒阈值(分钟)
  autoAuditEnabled: true,         // 是否自动审核
};

export const FAULT_THRESHOLDS = {
  maxTemperature: 85,       // 最高温度(°C)，超过触发过热故障
  minVoltage: 200,          // 最低电压(V)
  maxVoltage: 450,          // 最高电压(V)
  maxCurrent: 250,          // 最大电流(A) - 快充
  maxCurrentSlow: 32,       // 最大电流(A) - 慢充
};

export const SIMULATION = {
  voltageNominal: 400,       // 标称电压(V)
  currentFastNominal: 150,   // 快充标称电流(A) — 提速
  currentSlowNominal: 32,    // 慢充标称电流(A) — 提速
  powerFactor: 0.95,         // 功率因数
  dataReportIntervalMs: 3000, // 数据上报间隔(ms)
  chargingSpeedFast: 12.0,   // 快充速度(%/分钟) — 5x提速
  chargingSpeedSlow: 3.0,    // 慢充速度(%/分钟) — 6x提速
};

export const PAYMENT_SIMULATION = {
  successRate: 0.9,  // 支付模拟成功率
};

export const QUEUE_REFRESH_INTERVAL_MS = 10000; // 排队状态刷新间隔
