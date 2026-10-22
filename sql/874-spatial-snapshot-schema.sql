-- #874: Logan ArcGIS daily spatial snapshot schema
-- Tables for spatial_snapshot_layer and spatial_feature.
-- Spatial ops produce derived facts with full traceability.
-- Run once against the Source Neon Postgres database.

CREATE TABLE IF NOT EXISTS spatial_snapshot_layer (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_name    TEXT NOT NULL UNIQUE,
  layer_url     TEXT NOT NULL,
  last_refresh  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending',
  feature_count INTEGER NOT NULL DEFAULT 0,
  error_detail  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE spatial_snapshot_layer IS
  'Registry of Logan ArcGIS layers ingested daily by the spatial-snapshot cron.';
COMMENT ON COLUMN spatial_snapshot_layer.status IS
  'pending | syncing | synced | error';

CREATE TABLE IF NOT EXISTS spatial_feature (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_id            UUID NOT NULL REFERENCES spatial_snapshot_layer(id) ON DELETE CASCADE,
  feature_id_external TEXT NOT NULL,
  geometry            JSONB NOT NULL,
  attributes          JSONB NOT NULL DEFAULT '{}',
  spatial_basis       TEXT NOT NULL,
  effective_date      DATE,
  retrieved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  limitations         JSONB NOT NULL DEFAULT '[]',
  UNIQUE (layer_id, feature_id_external)
);

CREATE INDEX IF NOT EXISTS idx_spatial_feature_layer ON spatial_feature (layer_id);
CREATE INDEX IF NOT EXISTS idx_spatial_feature_retrieved ON spatial_feature (retrieved_at DESC);

-- Derived facts table: per-parcel spatial intersections with full traceability
CREATE TABLE IF NOT EXISTS spatial_derived_fact (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_plan        TEXT,
  geometry        JSONB,
  layer_name      TEXT NOT NULL,
  fact_type       TEXT NOT NULL,
  fact_value      JSONB NOT NULL,
  derived_from    JSONB NOT NULL DEFAULT '[]',
  effective_date  DATE,
  retrieved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  limitations     JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_spatial_derived_fact_lot ON spatial_derived_fact (lot_plan);
CREATE INDEX IF NOT EXISTS idx_spatial_derived_fact_layer ON spatial_derived_fact (layer_name);
