-- Align schema constraints with detailed requirements implementation.

ALTER TABLE public.charging_orders
  DROP CONSTRAINT IF EXISTS charging_orders_status_check;

ALTER TABLE public.charging_orders
  ADD CONSTRAINT charging_orders_status_check
  CHECK (status IN ('pending', 'queued', 'assigned', 'charging', 'paused', 'completed', 'fault_stopped', 'cancelled'));

UPDATE public.queues SET max_size = 3 WHERE type IN ('fast', 'slow');
UPDATE public.queues SET max_size = 10 WHERE type = 'waiting';

DELETE FROM public.charging_stations
WHERE station_number NOT IN ('F-001', 'F-002', 'F-003', 'S-001', 'S-002');
