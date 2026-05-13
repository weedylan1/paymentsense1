CREATE SCHEMA IF NOT EXISTS paymentsense_raw;
CREATE SCHEMA IF NOT EXISTS paymentsense_core;

CREATE TABLE IF NOT EXISTS paymentsense_raw.search_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query_text TEXT NOT NULL,
  source_url TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS paymentsense_raw.extracted_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  search_run_id BIGINT REFERENCES paymentsense_raw.search_runs(id) ON DELETE SET NULL,
  source_system TEXT NOT NULL DEFAULT 'paymentsense',
  record_type TEXT NOT NULL CHECK (record_type IN ('prospect', 'lead', 'customer', 'paymentsense_customer', 'prospect_detail')),
  external_id TEXT,
  source_url TEXT,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB NOT NULL,
  UNIQUE (source_system, record_type, external_id, extracted_at)
);

CREATE TABLE IF NOT EXISTS paymentsense_core.organisations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  company_number TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source_confidence NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_name, company_number)
);

CREATE TABLE IF NOT EXISTS paymentsense_core.addresses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id BIGINT REFERENCES paymentsense_core.organisations(id) ON DELETE CASCADE,
  label TEXT,
  line1 TEXT,
  line2 TEXT,
  town TEXT,
  county TEXT,
  postcode TEXT,
  normalized_postcode TEXT,
  country TEXT DEFAULT 'United Kingdom',
  source_confidence NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paymentsense_core.contacts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id BIGINT REFERENCES paymentsense_core.organisations(id) ON DELETE CASCADE,
  full_name TEXT,
  normalized_name TEXT,
  email TEXT,
  normalized_email TEXT,
  phone TEXT,
  normalized_phone TEXT,
  role TEXT,
  source_confidence NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paymentsense_core.external_references (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id BIGINT REFERENCES paymentsense_core.organisations(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'paymentsense',
  reference_type TEXT NOT NULL CHECK (reference_type IN ('prospect_id', 'customer_ref', 'mid', 'lead_id', 'origin_ref')),
  reference_value TEXT NOT NULL,
  source_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_record_id BIGINT REFERENCES paymentsense_raw.extracted_records(id) ON DELETE SET NULL,
  UNIQUE (source_system, reference_type, reference_value)
);

CREATE TABLE IF NOT EXISTS paymentsense_core.prospects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES paymentsense_core.organisations(id) ON DELETE CASCADE,
  prospect_id TEXT NOT NULL UNIQUE,
  channel TEXT,
  origin TEXT,
  created_on DATE,
  owner_name TEXT,
  sales_url TEXT,
  has_paymentsense_customer_match BOOLEAN,
  raw_record_id BIGINT REFERENCES paymentsense_raw.extracted_records(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paymentsense_core.customers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES paymentsense_core.organisations(id) ON DELETE CASCADE,
  customer_ref TEXT,
  mid TEXT,
  customer_kind TEXT NOT NULL DEFAULT 'customer' CHECK (customer_kind IN ('customer', 'paymentsense_customer')),
  trading_name TEXT,
  normalized_trading_name TEXT,
  start_date DATE,
  status TEXT,
  source_url TEXT,
  raw_record_id BIGINT REFERENCES paymentsense_raw.extracted_records(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_kind, customer_ref),
  UNIQUE (mid)
);

CREATE TABLE IF NOT EXISTS paymentsense_core.match_candidates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prospect_id BIGINT REFERENCES paymentsense_core.prospects(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES paymentsense_core.customers(id) ON DELETE CASCADE,
  score NUMERIC(6,4) NOT NULL CHECK (score >= 0 AND score <= 1),
  match_status TEXT NOT NULL DEFAULT 'candidate' CHECK (match_status IN ('candidate', 'confirmed', 'rejected', 'needs_review')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_by TEXT NOT NULL DEFAULT 'automation',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  UNIQUE (prospect_id, customer_id)
);

CREATE TABLE IF NOT EXISTS paymentsense_core.record_lineage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_schema TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  raw_record_id BIGINT NOT NULL REFERENCES paymentsense_raw.extracted_records(id) ON DELETE CASCADE,
  field_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_extracted_records_lookup
  ON paymentsense_raw.extracted_records (record_type, external_id);

CREATE INDEX IF NOT EXISTS idx_raw_extracted_records_payload_gin
  ON paymentsense_raw.extracted_records USING GIN (raw_payload);

CREATE INDEX IF NOT EXISTS idx_core_organisations_normalized_name
  ON paymentsense_core.organisations (normalized_name);

CREATE INDEX IF NOT EXISTS idx_core_addresses_postcode
  ON paymentsense_core.addresses (normalized_postcode);

CREATE INDEX IF NOT EXISTS idx_core_contacts_email
  ON paymentsense_core.contacts (normalized_email);

CREATE INDEX IF NOT EXISTS idx_core_external_references_value
  ON paymentsense_core.external_references (reference_type, reference_value);

CREATE INDEX IF NOT EXISTS idx_core_match_candidates_status_score
  ON paymentsense_core.match_candidates (match_status, score DESC);
