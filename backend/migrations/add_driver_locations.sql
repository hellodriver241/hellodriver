-- Phase 1: Add driver GPS location tracking
-- Tracks real-time driver location and online status

-- Enable PostGIS extension if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable pg_cron for scheduled maintenance jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Driver locations: real-time position and availability tracking
CREATE TABLE IF NOT EXISTS driver_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  latitude numeric(10, 7) NOT NULL,
  longitude numeric(10, 7) NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  is_online boolean DEFAULT false,
  is_available boolean DEFAULT false,
  last_heartbeat timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trip location pings: append-only trip history
CREATE TABLE IF NOT EXISTS trip_location_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  driver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  latitude numeric(10, 7) NOT NULL,
  longitude numeric(10, 7) NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  speed numeric(5, 2),
  bearing numeric(5, 2),
  accuracy numeric(5, 2),
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_driver_locations_geom ON driver_locations USING GIST(geom);
CREATE INDEX idx_driver_locations_online ON driver_locations(is_online) WHERE is_online = true;
CREATE INDEX idx_driver_locations_available_geom ON driver_locations USING GIST(geom) WHERE is_available = true AND is_online = true;
CREATE INDEX idx_trip_location_pings_trip_id ON trip_location_pings(trip_id);
CREATE INDEX idx_trip_location_pings_driver_id ON trip_location_pings(driver_id);
CREATE INDEX idx_trip_location_pings_created_at ON trip_location_pings(created_at DESC);

-- Data retention policy
-- Delete trip_location_pings older than 30 days to prevent unbounded table growth
-- Runs daily at 2 AM UTC
SELECT cron.schedule(
  'cleanup-old-trip-pings',
  '0 2 * * *',
  'DELETE FROM trip_location_pings WHERE created_at < NOW() - INTERVAL ''30 days'''
);
