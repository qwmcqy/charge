import type { SystemConfig } from './types';

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  fastChargeRate: 1.8,
  slowChargeRate: 1.8,
  parkingRatePerMinute: 0.1,
  parkingGracePeriodMinutes: 15,
  fastQueueMaxSize: 3,
  slowQueueMaxSize: 3,
  waitingQueueMaxSize: 10,
  avgFastChargeMinutes: 60,
  avgSlowChargeMinutes: 180,
  overtimeThresholdMinutes: 30,
  autoAuditEnabled: true,
};

export const FAULT_THRESHOLDS = {
  maxTemperature: 85,
  minVoltage: 200,
  maxVoltage: 450,
  maxCurrent: 250,
  maxCurrentSlow: 32,
};

export const SIMULATION = {
  voltageNominal: 400,
  currentFastNominal: 75,
  currentSlowNominal: 25,
  powerFactor: 1,
  dataReportIntervalMs: 3000,
  chargingSpeedFast: 30,
  chargingSpeedSlow: 10,
};

export const PAYMENT_SIMULATION = {
  successRate: 0.9,
};

export const QUEUE_REFRESH_INTERVAL_MS = 10000;
