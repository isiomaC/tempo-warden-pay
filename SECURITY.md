# Security model

Payments fail closed when policy evaluation or authorization fails. An allowed decision reserves budget transactionally before execution; retries with the same idempotency key return the original intent.

Each payment intent has its own Warden audit chain. Entries use `@stlw/warden`'s versioned canonical format and SHA-256 links. The verifier reads an exported JSON bundle and never queries Postgres. A signed checkpoint records the chain head and entry count; verification checks the chain, checkpoint signature, and count. Retain the signed checkpoint outside the database to detect a database administrator deleting both trailing entries and their checkpoint. This is tamper-evident against edits and truncation relative to a retained checkpoint, not against compromise of the Warden signing key. Independent on-chain anchoring is a later option.

Audit payloads use ISO timestamp strings and decimal amount strings. Do not put `Date`, `Map`, or `bigint` values in audit entries; the library canonicalizer does not preserve them safely.
