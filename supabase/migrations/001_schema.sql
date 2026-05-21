-- BUPT Campus Charging Station System - Database Schema
-- Run this in Supabase SQL Editor: https://app.supabase.com

-- ========== TABLES ==========

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  vehicle_plate TEXT UNIQUE,
  vehicle_model TEXT,
  battery_capacity NUMERIC DEFAULT 60.0,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.administrators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  admin_role TEXT DEFAULT 'operator' CHECK (admin_role IN ('super', 'operator', 'maintenance')),
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.charging_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_number TEXT UNIQUE NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fast', 'slow')),
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'charging', 'fault', 'offline', 'reserved')),
  location TEXT NOT NULL,
  max_power NUMERIC NOT NULL,
  current_voltage NUMERIC DEFAULT 0,
  current_current NUMERIC DEFAULT 0,
  current_power NUMERIC DEFAULT 0,
  cumulative_energy NUMERIC DEFAULT 0,
  temperature NUMERIC DEFAULT 25.0,
  current_order_id UUID,
  last_maintenance_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.charging_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  station_id UUID REFERENCES public.charging_stations(id),
  queue_entry_id UUID,
  mode TEXT NOT NULL CHECK (mode IN ('fast', 'slow')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'assigned', 'charging', 'paused', 'completed', 'fault_stopped', 'cancelled')),
  request_battery_level NUMERIC DEFAULT 0,
  target_battery_level NUMERIC DEFAULT 80,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  energy_consumed NUMERIC DEFAULT 0,
  charging_fee NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('fast', 'slow', 'waiting')),
  max_size INT NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  order_id UUID NOT NULL REFERENCES public.charging_orders(id),
  queue_id UUID NOT NULL REFERENCES public.queues(id),
  position INT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fast', 'slow')),
  battery_level NUMERIC DEFAULT 0,
  estimated_wait_minutes INT DEFAULT 0,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'ready', 'charging', 'cancelled', 'completed')),
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id),
  amount NUMERIC NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('charging_fee', 'parking_fee', 'combined')),
  status TEXT DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'pending', 'paid', 'refunded', 'failed')),
  method TEXT CHECK (method IN ('wechat', 'alipay', 'unionpay', 'campus_card')),
  transaction_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.parking_fee_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charging_order_id UUID NOT NULL REFERENCES public.charging_orders(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  station_id UUID NOT NULL REFERENCES public.charging_stations(id),
  charge_complete_time TIMESTAMPTZ NOT NULL,
  depart_time TIMESTAMPTZ,
  overtime_minutes INT DEFAULT 0,
  parking_fee NUMERIC DEFAULT 0,
  rate_per_minute NUMERIC DEFAULT 0.1,
  grace_period_minutes INT DEFAULT 15,
  status TEXT DEFAULT 'parked' CHECK (status IN ('parked', 'departed', 'paid')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.faults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES public.charging_stations(id),
  type TEXT NOT NULL CHECK (type IN ('power_failure', 'overheating', 'communication_error', 'cable_damage', 'battery_anomaly', 'voltage_abnormal', 'current_abnormal', 'other')),
  severity TEXT DEFAULT 'minor' CHECK (severity IN ('minor', 'major', 'critical')),
  description TEXT NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  handler_id UUID REFERENCES public.users(id),
  resolution TEXT,
  affected_order_id UUID REFERENCES public.charging_orders(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  type TEXT NOT NULL CHECK (type IN ('queue_ready', 'charging_started', 'charging_complete', 'fault_occurred', 'overtime_warning', 'bill_generated', 'payment_success', 'system')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  related_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  charging_order_id UUID NOT NULL REFERENCES public.charging_orders(id),
  parking_fee_order_id UUID REFERENCES public.parking_fee_orders(id),
  charging_fee NUMERIC DEFAULT 0,
  parking_fee NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  generated_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ,
  status TEXT DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS public.system_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.station_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID REFERENCES public.charging_stations(id),
  event_type TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
