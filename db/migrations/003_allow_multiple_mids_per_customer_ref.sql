ALTER TABLE paymentsense_core.customers
  DROP CONSTRAINT IF EXISTS customers_customer_kind_customer_ref_key;

CREATE INDEX IF NOT EXISTS idx_core_customers_customer_ref
  ON paymentsense_core.customers (customer_kind, customer_ref);
