CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  principal_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-fA-F]{40}$')
);

CREATE TABLE IF NOT EXISTS merchants (
  id text PRIMARY KEY,
  realm text NOT NULL UNIQUE,
  recipient text NOT NULL CHECK (recipient ~ '^0x[0-9a-fA-F]{40}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'denied'))
);

CREATE TABLE IF NOT EXISTS policies (
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  challenge_id text NOT NULL UNIQUE,
  challenge_digest text,
  agent_id text NOT NULL,
  merchant_realm text NOT NULL,
  recipient text NOT NULL,
  intent jsonb NOT NULL,
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('allow', 'deny', 'approval_required')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('denied', 'approval_required', 'authorized', 'executing', 'settled', 'failed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  intent_id text NOT NULL UNIQUE REFERENCES payment_intents(id),
  request jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approver_id text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budget_periods (
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  period_start date NOT NULL,
  settled numeric(38, 18) NOT NULL DEFAULT 0 CHECK (settled >= 0),
  reserved numeric(38, 18) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  PRIMARY KEY (policy_id, policy_version, period_start)
);

CREATE TABLE IF NOT EXISTS budget_reservations (
  intent_id text PRIMARY KEY REFERENCES payment_intents(id),
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  period_start date NOT NULL,
  amount numeric(38, 18) NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  intent_id text PRIMARY KEY REFERENCES payment_intents(id),
  tx_hash text UNIQUE CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  receipt jsonb NOT NULL DEFAULT '{}',
  settled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entries (
  intent_id text NOT NULL REFERENCES payment_intents(id),
  entry_index integer NOT NULL CHECK (entry_index >= 0),
  entry jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intent_id, entry_index)
);

CREATE TABLE IF NOT EXISTS audit_checkpoints (
  intent_id text NOT NULL REFERENCES payment_intents(id),
  entry_count integer NOT NULL CHECK (entry_count >= 0),
  head_hash text NOT NULL,
  signer_address text NOT NULL CHECK (signer_address ~ '^0x[0-9a-fA-F]{40}$'),
  signature text NOT NULL,
  issued_at bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intent_id, entry_count)
);
