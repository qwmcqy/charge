-- Add 'paused' and 'fault_pending' statuses to charging_orders check constraint
ALTER TABLE public.charging_orders DROP CONSTRAINT IF EXISTS charging_orders_status_check;
ALTER TABLE public.charging_orders ADD CONSTRAINT charging_orders_status_check CHECK (status IN ('pending', 'queued', 'assigned', 'charging', 'paused', 'fault_pending', 'completed', 'fault_stopped', 'cancelled'));
