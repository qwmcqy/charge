-- Migration: 账单详情扩展
-- 为 bills 表增加充电量、充电时长、计费单价字段

ALTER TABLE public.bills
ADD COLUMN IF NOT EXISTS energy_consumed NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS charging_duration_minutes INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS rate_per_kwh NUMERIC DEFAULT 0;

-- 注释
COMMENT ON COLUMN public.bills.energy_consumed IS '充电量 (kWh)';
COMMENT ON COLUMN public.bills.charging_duration_minutes IS '充电时长 (分钟)';
COMMENT ON COLUMN public.bills.rate_per_kwh IS '充电单价 (元/kWh)';
