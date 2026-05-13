CREATE UNIQUE INDEX IF NOT EXISTS organisations_normalized_name_no_company_key
  ON paymentsense_core.organisations (normalized_name)
  WHERE company_number IS NULL;
