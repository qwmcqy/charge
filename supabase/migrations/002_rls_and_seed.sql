-- Part 2: Indexes, RLS policies, trigger, and seed data
-- Run AFTER 001_schema.sql in Supabase SQL Editor

-- ========== INDEXES ==========
CREATE INDEX IF NOT EXISTS idx_charging_orders_user ON public.charging_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_charging_orders_station ON public.charging_orders(station_id);
CREATE INDEX IF NOT EXISTS idx_charging_orders_status ON public.charging_orders(status);
CREATE INDEX IF NOT EXISTS idx_queue_entries_queue ON public.queue_entries(queue_id);
CREATE INDEX IF NOT EXISTS idx_queue_entries_user ON public.queue_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON public.payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_parking_fee_orders_user ON public.parking_fee_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_parking_fee_orders_status ON public.parking_fee_orders(status);
CREATE INDEX IF NOT EXISTS idx_faults_station ON public.faults(station_id);
CREATE INDEX IF NOT EXISTS idx_faults_status ON public.faults(resolved_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_bills_user ON public.bills(user_id);
CREATE INDEX IF NOT EXISTS idx_station_logs_station ON public.station_logs(station_id);
CREATE INDEX IF NOT EXISTS idx_station_logs_time ON public.station_logs(created_at);

-- ========== ROW LEVEL SECURITY ==========
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charging_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charging_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_fee_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.station_logs ENABLE ROW LEVEL SECURITY;

-- RLS: users table
DROP POLICY IF EXISTS "Users can read own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
CREATE POLICY "Users can read own data" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own data" ON public.users FOR UPDATE USING (auth.uid() = id);

-- RLS: charging_stations
DROP POLICY IF EXISTS "Anyone can read stations" ON public.charging_stations;
DROP POLICY IF EXISTS "Admins can insert stations" ON public.charging_stations;
DROP POLICY IF EXISTS "Admins can update stations" ON public.charging_stations;
DROP POLICY IF EXISTS "Admins can delete stations" ON public.charging_stations;
CREATE POLICY "Anyone can read stations" ON public.charging_stations FOR SELECT USING (true);
CREATE POLICY "Admins can insert stations" ON public.charging_stations FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));
CREATE POLICY "Admins can update stations" ON public.charging_stations FOR UPDATE USING (EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));
CREATE POLICY "Admins can delete stations" ON public.charging_stations FOR DELETE USING (EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));

-- RLS: charging_orders
DROP POLICY IF EXISTS "Users own or admins read orders" ON public.charging_orders;
DROP POLICY IF EXISTS "Users can insert own orders" ON public.charging_orders;
DROP POLICY IF EXISTS "Users and admins can update orders" ON public.charging_orders;
CREATE POLICY "Users own or admins read orders" ON public.charging_orders FOR SELECT USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));
CREATE POLICY "Users can insert own orders" ON public.charging_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users and admins can update orders" ON public.charging_orders FOR UPDATE USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));

-- RLS: queue_entries
DROP POLICY IF EXISTS "Users own or admins read queue" ON public.queue_entries;
DROP POLICY IF EXISTS "Users can insert own queue" ON public.queue_entries;
DROP POLICY IF EXISTS "Admins can manage queue" ON public.queue_entries;
CREATE POLICY "Users own or admins read queue" ON public.queue_entries FOR SELECT USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));
CREATE POLICY "Users can insert own queue" ON public.queue_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage queue" ON public.queue_entries FOR UPDATE USING (EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));

-- RLS: payment_orders
DROP POLICY IF EXISTS "Users own or admins read payments" ON public.payment_orders;
DROP POLICY IF EXISTS "Users can insert own payments" ON public.payment_orders;
DROP POLICY IF EXISTS "Users can update own payments" ON public.payment_orders;
CREATE POLICY "Users own or admins read payments" ON public.payment_orders FOR SELECT USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));
CREATE POLICY "Users can insert own payments" ON public.payment_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own payments" ON public.payment_orders FOR UPDATE USING (auth.uid() = user_id);

-- RLS: notifications
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can read own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert notifications" ON public.notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- RLS: bills
DROP POLICY IF EXISTS "Users own or admins read bills" ON public.bills;
CREATE POLICY "Users own or admins read bills" ON public.bills FOR SELECT USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));

-- RLS: system_configs
DROP POLICY IF EXISTS "Admins can read config" ON public.system_configs;
DROP POLICY IF EXISTS "Admins can insert config" ON public.system_configs;
DROP POLICY IF EXISTS "Admins can update config" ON public.system_configs;
CREATE POLICY "Admins can read config" ON public.system_configs FOR SELECT USING (EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));
CREATE POLICY "Admins can insert config" ON public.system_configs FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));
CREATE POLICY "Admins can update config" ON public.system_configs FOR UPDATE USING (EXISTS (SELECT 1 FROM public.administrators WHERE user_id = auth.uid()));

-- ========== TRIGGER FUNCTION ==========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, name, email, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email), NEW.email, 'user');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
