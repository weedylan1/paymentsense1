CREATE SCHEMA IF NOT EXISTS paymentsense_archive;

CREATE TABLE IF NOT EXISTS paymentsense_archive.archived_customers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_customer_id BIGINT NOT NULL,
  source_organisation_id BIGINT,
  customer_ref TEXT,
  mid TEXT,
  customer_kind TEXT,
  entity_name TEXT,
  trading_name TEXT,
  postcode TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archive_reason TEXT NOT NULL DEFAULT 'manual_cleanse',
  snapshot JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_customers_source
  ON paymentsense_archive.archived_customers (source_customer_id, archived_at DESC);

CREATE TABLE IF NOT EXISTS paymentsense_archive.archived_prospects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_prospect_id BIGINT NOT NULL,
  source_organisation_id BIGINT,
  prospect_ref TEXT NOT NULL,
  business_name TEXT,
  contact_email TEXT,
  postcode TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archive_reason TEXT NOT NULL DEFAULT 'manual_cleanse',
  snapshot JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_prospects_source
  ON paymentsense_archive.archived_prospects (source_prospect_id, archived_at DESC);
