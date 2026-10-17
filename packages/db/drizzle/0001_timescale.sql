-- TimescaleDB is optional: turn candles into a hypertable when the extension can be installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('candles', 'time', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;
END $$;
