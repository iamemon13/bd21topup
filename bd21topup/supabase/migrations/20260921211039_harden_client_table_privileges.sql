-- =========================================================
-- Sensitive tables: remove all direct client privileges
-- =========================================================

REVOKE ALL
ON TABLE
  public.orders,
  public.wallet_transactions,
  public.profiles,
  public.add_money_requests,
  public.notifications,
  public.packages,
  public.withdrawals
FROM anon, authenticated;


-- =========================================================
-- Packages
-- Public package list must remain readable
-- =========================================================

GRANT SELECT
ON TABLE public.packages
TO anon, authenticated;


-- =========================================================
-- Withdrawals
-- Only authenticated users need direct SELECT + INSERT
-- RLS limits rows to auth.uid()
-- =========================================================

GRANT SELECT, INSERT
ON TABLE public.withdrawals
TO authenticated;


-- =========================================================
-- Tighten withdrawal policies from PUBLIC -> authenticated
-- =========================================================

DROP POLICY IF EXISTS
  "Users can view their own withdrawals"
ON public.withdrawals;

DROP POLICY IF EXISTS
  "Users can insert their own withdrawals"
ON public.withdrawals;


CREATE POLICY
  "Users can view their own withdrawals"
ON public.withdrawals
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
);


CREATE POLICY
  "Users can insert their own withdrawals"
ON public.withdrawals
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
);