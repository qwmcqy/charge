-- Part 3: Initial seed data
-- Run AFTER 002_rls_and_seed.sql

-- Default queues
UPDATE public.queues SET max_size = 3 WHERE type = 'fast';
UPDATE public.queues SET max_size = 3 WHERE type = 'slow';
UPDATE public.queues SET max_size = 10 WHERE type = 'waiting';
INSERT INTO public.queues (type, max_size)
  SELECT 'fast', 3
  WHERE NOT EXISTS (SELECT 1 FROM public.queues WHERE type = 'fast');
INSERT INTO public.queues (type, max_size)
  SELECT 'slow', 3
  WHERE NOT EXISTS (SELECT 1 FROM public.queues WHERE type = 'slow');
INSERT INTO public.queues (type, max_size)
  SELECT 'waiting', 10
  WHERE NOT EXISTS (SELECT 1 FROM public.queues WHERE type = 'waiting');

-- Demo charging stations: 3 fast piles and 2 slow piles.
INSERT INTO public.charging_stations (station_number, mode, location, max_power, status)
VALUES
  ('F-001', 'fast', 'East Campus Lot A #1', 30, 'available'),
  ('F-002', 'fast', 'East Campus Lot A #2', 30, 'available'),
  ('F-003', 'fast', 'West Campus Lot B #1', 30, 'available'),
  ('S-001', 'slow', 'East Campus Lot A #3', 10, 'available'),
  ('S-002', 'slow', 'East Campus Lot A #4', 10, 'available')
ON CONFLICT (station_number) DO UPDATE SET
  mode = EXCLUDED.mode,
  location = EXCLUDED.location,
  max_power = EXCLUDED.max_power,
  status = EXCLUDED.status;

DELETE FROM public.charging_stations
WHERE station_number NOT IN ('F-001', 'F-002', 'F-003', 'S-001', 'S-002');
