BEGIN;

-- Customers must not be able to create withdrawal rows directly.
-- All withdrawals must go through the server-side /api/withdraw route
-- and the protected process_withdrawal() RPC so the wallet debit
-- and ledger entry happen atomically.

REVOKE INSERT
ON TABLE public.withdrawals
FROM authenticated;

DROP POLICY IF EXISTS
  "Users can insert their own withdrawals"
ON public.withdrawals;

COMMIT;
