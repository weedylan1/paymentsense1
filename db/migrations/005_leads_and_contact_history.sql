CREATE TABLE IF NOT EXISTS paymentsense_core.leads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL UNIQUE REFERENCES paymentsense_core.customers(id) ON DELETE CASCADE,
  lead_status TEXT NOT NULL DEFAULT 'open' CHECK (lead_status IN ('open', 'contacted', 'qualified', 'unqualified', 'closed')),
  primary_prospect_id BIGINT REFERENCES paymentsense_core.prospects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paymentsense_core.lead_prospects (
  lead_id BIGINT NOT NULL REFERENCES paymentsense_core.leads(id) ON DELETE CASCADE,
  prospect_id BIGINT NOT NULL REFERENCES paymentsense_core.prospects(id) ON DELETE CASCADE,
  match_candidate_id BIGINT REFERENCES paymentsense_core.match_candidates(id) ON DELETE SET NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, prospect_id)
);

CREATE TABLE IF NOT EXISTS paymentsense_core.lead_contact_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES paymentsense_core.leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'mail', 'phone_call', 'sms', 'in_person', 'other')),
  contacted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_core_leads_status
  ON paymentsense_core.leads (lead_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_core_lead_prospects_prospect
  ON paymentsense_core.lead_prospects (prospect_id);

CREATE INDEX IF NOT EXISTS idx_core_lead_contact_history_lead
  ON paymentsense_core.lead_contact_history (lead_id, contacted_at DESC);
