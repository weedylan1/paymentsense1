UPDATE paymentsense_core.customers
SET status = 'cancelled',
    updated_at = now()
WHERE status ILIKE 'cancel%';
