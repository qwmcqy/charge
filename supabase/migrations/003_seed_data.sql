-- Part 3: Initial seed data
-- Run AFTER 002_rls_and_seed.sql

-- Default queues (skip if already exist)
INSERT INTO public.queues (type, max_size)
  SELECT 'fast', 20
  WHERE NOT EXISTS (SELECT 1 FROM public.queues WHERE type = 'fast');
INSERT INTO public.queues (type, max_size)
  SELECT 'slow', 30
  WHERE NOT EXISTS (SELECT 1 FROM public.queues WHERE type = 'slow');
INSERT INTO public.queues (type, max_size)
  SELECT 'waiting', 50
  WHERE NOT EXISTS (SELECT 1 FROM public.queues WHERE type = 'waiting');

-- Demo charging stations (skip if already exist)
INSERT INTO public.charging_stations (station_number, mode, location, max_power)
  SELECT 'F-001', 'fast', 'East Campus Lot A #1', 120
  WHERE NOT EXISTS (SELECT 1 FROM public.charging_stations WHERE station_number = 'F-001');
INSERT INTO public.charging_stations (station_number, mode, location, max_power)
  SELECT 'F-002', 'fast', 'East Campus Lot A #2', 120
  WHERE NOT EXISTS (SELECT 1 FROM public.charging_stations WHERE station_number = 'F-002');
INSERT INTO public.charging_stations (station_number, mode, location, max_power)
  SELECT 'F-003', 'fast', 'West Campus Lot B #1', 120
  WHERE NOT EXISTS (SELECT 1 FROM public.charging_stations WHERE station_number = 'F-003');
INSERT INTO public.charging_stations (station_number, mode, location, max_power)
  SELECT 'S-001', 'slow', 'East Campus Lot A #3', 7
  WHERE NOT EXISTS (SELECT 1 FROM public.charging_stations WHERE station_number = 'S-001');
INSERT INTO public.charging_stations (station_number, mode, location, max_power)
  SELECT 'S-002', 'slow', 'East Campus Lot A #4', 7
  WHERE NOT EXISTS (SELECT 1 FROM public.charging_stations WHERE station_number = 'S-002');
INSERT INTO public.charging_stations (station_number, mode, location, max_power)
  SELECT 'S-003', 'slow', 'West Campus Lot B #2', 7
  WHERE NOT EXISTS (SELECT 1 FROM public.charging_stations WHERE station_number = 'S-003');
INSERT INTO public.charging_stations (station_number, mode, location, max_power)
  SELECT 'S-004', 'slow', 'West Campus Lot B #3', 7
  WHERE NOT EXISTS (SELECT 1 FROM public.charging_stations WHERE station_number = 'S-004');
INSERT INTO public.charging_stations (station_number, mode, location, max_power)
  SELECT 'S-005', 'slow', 'West Campus Lot B #4', 7
  WHERE NOT EXISTS (SELECT 1 FROM public.charging_stations WHERE station_number = 'S-005');
