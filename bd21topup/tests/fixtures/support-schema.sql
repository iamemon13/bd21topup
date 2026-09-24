-- Minimal local-only schema matching the columns and grants used by this feature.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.profiles(id uuid PRIMARY KEY, wallet_balance numeric DEFAULT 1000, updated_at timestamptz);
CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users,
  status text DEFAULT 'pending', admin_note text, amount numeric DEFAULT 100,
  payment_method text DEFAULT 'bkash', cancelled_at timestamp);
CREATE TABLE public.add_money_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users,
  status text DEFAULT 'pending', admin_note text, amount numeric DEFAULT 100, reviewed_at timestamptz);
CREATE TABLE public.withdrawals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users,
  status text DEFAULT 'pending', admin_note text, amount numeric DEFAULT 100, balance_after numeric);
CREATE TABLE public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
  type text, direction text, amount numeric, balance_after numeric, reference_id uuid, description text);
CREATE TABLE public.admin_roles(user_id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL, permissions text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.admin_audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid NOT NULL,
  action_type text NOT NULL, target_id text NOT NULL, details text, ip_address text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users,
  title text NOT NULL, message text NOT NULL, type text DEFAULT 'general', is_read boolean DEFAULT false, created_at timestamptz DEFAULT now());
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.withdrawals TO authenticated;
CREATE POLICY own_withdrawals ON public.withdrawals TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
INSERT INTO public.profiles(id) SELECT id FROM auth.users;
INSERT INTO public.admin_roles(user_id, role, permissions)
VALUES ('11111111-1111-4111-8111-111111111111', 'editor', ARRAY['manage_orders', 'manage_add_money', 'manage_withdrawals']);
-- Three historical operations, plus an anonymous order that must not get a case.
INSERT INTO public.orders(user_id,status,admin_note) VALUES ('11111111-1111-4111-8111-111111111111','cancelled','পুরোনো কারণ'),(null,'cancelled',null);
INSERT INTO public.add_money_requests(user_id,status) VALUES ('11111111-1111-4111-8111-111111111111','rejected');
INSERT INTO public.withdrawals(user_id,status) VALUES ('22222222-2222-4222-8222-222222222222','rejected');
