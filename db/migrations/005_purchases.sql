-- "Pay first, then create your account": a paid plan waiting to be attached to a
-- workspace. Not tenant data yet (no workspace exists), so no RLS; it is only ever
-- reached through its server-side reference or the payer's secret claim token.
CREATE TABLE purchases (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan                       text NOT NULL CHECK (plan IN ('individual', 'organization')),
  email                      citext NOT NULL,
  amount                     int NOT NULL CHECK (amount > 0),
  currency                   text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reference                  text NOT NULL UNIQUE,
  claim_token_hash           text NOT NULL UNIQUE,
  status                     text NOT NULL DEFAULT 'initialized'
                             CHECK (status IN ('initialized', 'paid', 'failed', 'claimed')),
  paystack_customer_code     text,
  paystack_subscription_code text,
  paystack_email_token       text,
  next_payment_date          timestamptz,
  paid_at                    timestamptz,
  claimed_org_id             uuid REFERENCES organizations(id) ON DELETE SET NULL,
  claimed_at                 timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON purchases (paystack_customer_code);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safetab_app') THEN
    GRANT SELECT, INSERT, UPDATE ON purchases TO safetab_app;
  END IF;
END $$;
