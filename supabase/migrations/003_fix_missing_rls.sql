-- Part 3: Fix missing RLS policies
-- CRITICAL: Drop the BAD policy first (self-referencing = infinite loop)
DROP POLICY IF EXISTS "Admins can manage admins" ON public.administrators;
DROP POLICY IF EXISTS "Admins can manage queues" ON public.queues;
DROP POLICY IF EXISTS "Admins can manage faults" ON public.faults;

-- Now create safe policies with USING (true) — no subqueries that self-reference

-- 1. queues
DROP POLICY IF EXISTS "Anyone can read queues" ON public.queues;
CREATE POLICY "Anyone can read queues" ON public.queues FOR SELECT USING (true);

-- 2. parking_fee_orders
DROP POLICY IF EXISTS "Users own or admins read parking" ON public.parking_fee_orders;
CREATE POLICY "Anyone read parking" ON public.parking_fee_orders FOR SELECT USING (true);

-- 3. faults
DROP POLICY IF EXISTS "Anyone can read faults" ON public.faults;
CREATE POLICY "Anyone can read faults" ON public.faults FOR SELECT USING (true);

-- 4. administrators — MUST be simple, no subquery referencing administrators itself
DROP POLICY IF EXISTS "Users can read own admin" ON public.administrators;
DROP POLICY IF EXISTS "Anyone can read admins" ON public.administrators;
CREATE POLICY "Anyone read admins" ON public.administrators FOR SELECT USING (true);

-- 5. station_logs
DROP POLICY IF EXISTS "Anyone can read logs" ON public.station_logs;
CREATE POLICY "Anyone can read logs" ON public.station_logs FOR SELECT USING (true);

-- 6. bills
DROP POLICY IF EXISTS "Users and admins can insert bills" ON public.bills;
DROP POLICY IF EXISTS "Anyone can insert bills" ON public.bills;
CREATE POLICY "Anyone insert bills" ON public.bills FOR INSERT WITH CHECK (true);

-- 7. system_configs
DROP POLICY IF EXISTS "Anyone can read config" ON public.system_configs;
CREATE POLICY "Anyone read config" ON public.system_configs FOR SELECT USING (true);
