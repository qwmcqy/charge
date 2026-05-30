-- Repair historical duplicate assignments before enforcing state invariants.

WITH ranked_stations AS (
  SELECT
    station.id,
    row_number() OVER (
      PARTITION BY station.current_order_id
      ORDER BY
        CASE WHEN station.id = orders.station_id THEN 0 ELSE 1 END,
        station.station_number
    ) AS assignment_rank
  FROM public.charging_stations AS station
  LEFT JOIN public.charging_orders AS orders
    ON orders.id = station.current_order_id
  WHERE station.current_order_id IS NOT NULL
)
UPDATE public.charging_stations AS station
SET
  status = 'available',
  current_order_id = NULL,
  current_voltage = 0,
  current_current = 0,
  current_power = 0
FROM ranked_stations
WHERE station.id = ranked_stations.id
  AND ranked_stations.assignment_rank > 1;

WITH ranked_entries AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY order_id
      ORDER BY created_at DESC, id DESC
    ) AS entry_rank
  FROM public.queue_entries
  WHERE status IN ('waiting', 'ready', 'charging')
)
UPDATE public.queue_entries AS entry
SET status = 'cancelled'
FROM ranked_entries
WHERE entry.id = ranked_entries.id
  AND ranked_entries.entry_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS charging_stations_one_current_order_idx
  ON public.charging_stations (current_order_id)
  WHERE current_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_one_active_order_idx
  ON public.queue_entries (order_id)
  WHERE status IN ('waiting', 'ready', 'charging');
