// ========== 枚举定义 ==========

export enum StationStatus {
  Available = 'available',
  Charging = 'charging',
  Fault = 'fault',
  Offline = 'offline',
  Reserved = 'reserved',
}

export enum ChargeMode {
  Fast = 'fast',
  Slow = 'slow',
}

export enum OrderStatus {
  Pending = 'pending',
  Queued = 'queued',
  Assigned = 'assigned',
  Charging = 'charging',
  Paused = 'paused',
  FaultPending = 'fault_pending',
  Completed = 'completed',
  FaultStopped = 'fault_stopped',
  Cancelled = 'cancelled',
}

export enum QueueType {
  Fast = 'fast',
  Slow = 'slow',
  Waiting = 'waiting',
}

export enum QueueEntryStatus {
  Waiting = 'waiting',
  Ready = 'ready',
  Charging = 'charging',
  Cancelled = 'cancelled',
  Completed = 'completed',
}

export enum PaymentType {
  ChargingFee = 'charging_fee',
  ParkingFee = 'parking_fee',
  Combined = 'combined',
}

export enum PaymentStatus {
  Unpaid = 'unpaid',
  Pending = 'pending',
  Paid = 'paid',
  Refunded = 'refunded',
  Failed = 'failed',
}

export enum PaymentMethod {
  WeChat = 'wechat',
  AliPay = 'alipay',
  UnionPay = 'unionpay',
  CampusCard = 'campus_card',
}

export enum FaultType {
  PowerFailure = 'power_failure',
  Overheating = 'overheating',
  CommunicationError = 'communication_error',
  CableDamage = 'cable_damage',
  BatteryAnomaly = 'battery_anomaly',
  VoltageAbnormal = 'voltage_abnormal',
  CurrentAbnormal = 'current_abnormal',
  Other = 'other',
}

export enum FaultSeverity {
  Minor = 'minor',
  Major = 'major',
  Critical = 'critical',
}

export enum NotificationType {
  QueueReady = 'queue_ready',
  ChargingStarted = 'charging_started',
  ChargingComplete = 'charging_complete',
  FaultOccurred = 'fault_occurred',
  OvertimeWarning = 'overtime_warning',
  BillGenerated = 'bill_generated',
  PaymentSuccess = 'payment_success',
  System = 'system',
}

export enum AdminRole {
  Super = 'super',
  Operator = 'operator',
  Maintenance = 'maintenance',
}

// ========== 接口定义 ==========

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  vehiclePlate: string;
  vehicleModel: string;
  batteryCapacity: number;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface AdminProfile {
  id: string;
  userId: string;
  adminRole: AdminRole;
  permissions: string[];
}

export interface StationData {
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
  currentOrderId?: string;
  lastMaintenanceAt: string;
}

export interface RealtimeData {
  stationId: string;
  voltage: number;
  current: number;
  power: number;
  energy: number;
  temperature: number;
  status: StationStatus;
  timestamp: string;
}

export interface ChargingProgress {
  orderId: string;
  status: OrderStatus;
  stationNumber?: string;
  mode: ChargeMode;
  startTime?: string;
  currentVoltage: number;
  currentCurrent: number;
  currentPower: number;
  energyConsumed: number;
  durationMinutes: number;
  batteryLevel: number;
  targetBatteryLevel: number;
  estimatedRemainingMinutes: number;
}

export interface OrderData {
  id: string;
  userId: string;
  stationId?: string;
  queueEntryId?: string;
  mode: ChargeMode;
  status: OrderStatus;
  requestBatteryLevel: number;
  targetBatteryLevel: number;
  startTime?: string;
  endTime?: string;
  energyConsumed: number;
  chargingFee: number;
  createdAt: string;
}

export interface QueueData {
  id: string;
  type: QueueType;
  maxSize: number;
}

export interface QueueEntryData {
  id: string;
  userId: string;
  orderId: string;
  queueId: string;
  position: number;
  mode: ChargeMode;
  batteryLevel: number;
  estimatedWaitMinutes: number;
  status: QueueEntryStatus;
  createdAt: string;
  notifiedAt?: string;
}

export interface QueueStatus {
  inQueue: boolean;
  entry?: QueueEntryData;
  position: number;
  totalWaiting: number;
  estimatedWaitMinutes: number;
}

export interface PaymentOrderData {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  type: PaymentType;
  status: PaymentStatus;
  method?: PaymentMethod;
  transactionId?: string;
  paidAt?: string;
  createdAt: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  message: string;
}

export interface ParkingFeeOrderData {
  id: string;
  chargingOrderId: string;
  userId: string;
  stationId: string;
  chargeCompleteTime: string;
  departTime?: string;
  overtimeMinutes: number;
  parkingFee: number;
  ratePerMinute: number;
  gracePeriodMinutes: number;
  status: 'parked' | 'departed' | 'paid';
}

export interface FaultData {
  id: string;
  stationId: string;
  type: FaultType;
  severity: FaultSeverity;
  description: string;
  detectedAt: string;
  resolvedAt?: string;
  handlerId?: string;
  resolution?: string;
  affectedOrderId?: string;
}

export interface NotificationData {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  read: boolean;
  relatedId?: string;
  createdAt: string;
}

export interface BillData {
  id: string;
  userId: string;
  chargingOrderId: string;
  parkingFeeOrderId?: string;
  chargingFee: number;
  parkingFee: number;
  totalAmount: number;
  generatedAt: string;
  paidAt?: string;
  status: 'unpaid' | 'paid' | 'cancelled';
}

export interface BillDetail extends BillData {
  chargingOrder?: OrderData;
  parkingFeeOrder?: ParkingFeeOrderData;
}

export interface SystemConfig {
  fastChargeRate: number;
  slowChargeRate: number;
  parkingRatePerMinute: number;
  parkingGracePeriodMinutes: number;
  fastQueueMaxSize: number;
  slowQueueMaxSize: number;
  waitingQueueMaxSize: number;
  avgFastChargeMinutes: number;
  avgSlowChargeMinutes: number;
  overtimeThresholdMinutes: number;
  autoAuditEnabled: boolean;
}

export interface OperationReport {
  totalOrders: number;
  totalEnergy: number;
  totalChargingFee: number;
  totalParkingFee: number;
  totalRevenue: number;
  faultCount: number;
  avgWaitMinutes: number;
  stationUtilization: Record<string, number>;
  hourlyDistribution: Record<number, number>;
  dateRange: { start: string; end: string };
}

export interface StationInput {
  stationNumber: string;
  mode: ChargeMode;
  location: string;
  maxPower: number;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface LogFilter {
  stationId?: string;
  eventType?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface SystemLog {
  id: string;
  stationId?: string;
  eventType: string;
  data: Record<string, unknown>;
  createdAt: string;
}
