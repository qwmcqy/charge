import { supabase } from '@/lib/supabase';
import { Administrator } from '@/models/Administrator';
import { ChargingStation } from '@/models/ChargingStation';
import { DEFAULT_SYSTEM_CONFIG } from '@/lib/constants';
import type { SystemConfig, StationInput, OperationReport, DateRange, LogFilter } from '@/lib/types';

export class ConfigService {
  /**
   * 获取系统配置
   */
  static async getConfig(adminId?: string): Promise<SystemConfig> {
    if (adminId) {
      const admin = await Administrator.fetchByUserId(adminId);
      return admin.getSystemConfig();
    }

    const { data, error } = await supabase.from('system_configs').select('*');
    const config: any = { ...DEFAULT_SYSTEM_CONFIG };
    if (data) {
      for (const row of data) {
        const key = row.key as string;
        if (key in config) {
          config[key] = (row.value as any)?.v ?? DEFAULT_SYSTEM_CONFIG[key as keyof SystemConfig];
        }
      }
    }
    return config;
  }

  /**
   * 更新系统配置
   */
  static async updateConfig(config: Partial<SystemConfig>, adminId: string) {
    const admin = await Administrator.fetchByUserId(adminId);
    await admin.updateSystemConfig(config);
    return ConfigService.getConfig(adminId);
  }

  /**
   * 添加充电桩
   */
  static async addStation(data: StationInput, adminId: string) {
    const admin = await Administrator.fetchByUserId(adminId);
    return admin.addStation(data);
  }

  /**
   * 更新充电桩信息
   */
  static async updateStation(stationId: string, data: Partial<StationInput>, adminId: string) {
    const admin = await Administrator.fetchByUserId(adminId);
    await admin.updateStation(stationId, data);
  }

  /**
   * 移除充电桩
   */
  static async removeStation(stationId: string, adminId: string) {
    const admin = await Administrator.fetchByUserId(adminId);
    await admin.removeStation(stationId);
  }

  /**
   * 获取所有充电桩
   */
  static async getAllStations() {
    return ChargingStation.fetchAll();
  }

  /**
   * 获取运营报表
   */
  static async getReport(startDate: Date, endDate: Date, adminId: string): Promise<OperationReport> {
    const admin = await Administrator.fetchByUserId(adminId);
    return admin.getOperationReport(startDate, endDate);
  }

  /**
   * 导出报表
   */
  static async exportReport(format: 'csv' | 'pdf', dateRange: DateRange, adminId: string): Promise<string> {
    const admin = await Administrator.fetchByUserId(adminId);
    return admin.exportReport(format, dateRange);
  }

  /**
   * 数据归档
   */
  static async archiveData(beforeDate: Date, adminId: string) {
    const admin = await Administrator.fetchByUserId(adminId);
    await admin.archiveData(beforeDate);
  }

  /**
   * 备份数据库
   */
  static async backupDatabase(adminId: string) {
    const admin = await Administrator.fetchByUserId(adminId);
    await admin.backupDatabase();
  }

  /**
   * 获取系统日志
   */
  static async getSystemLogs(filter: LogFilter, adminId: string) {
    const admin = await Administrator.fetchByUserId(adminId);
    return admin.getSystemLogs(filter);
  }

  /**
   * 获取充电桩日志
   */
  static async getStationLogs(stationId: string, limit = 50) {
    const { data, error } = await supabase
      .from('station_logs')
      .select('*')
      .eq('station_id', stationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`获取充电桩日志失败: ${error.message}`);
    return data;
  }
}
