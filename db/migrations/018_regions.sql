CREATE TABLE IF NOT EXISTS paymentsense_core.regions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_regions_normalized_name UNIQUE (normalized_name)
);

ALTER TABLE paymentsense_core.customers
  ADD COLUMN IF NOT EXISTS region_id BIGINT REFERENCES paymentsense_core.regions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_core_customers_region_id
  ON paymentsense_core.customers (region_id);
