import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { createApprovalRequest, resolveApproval, type ApprovalRequest } from '@stlw/warden'
import type { Hex } from 'viem'
import { appendAuditInTransaction } from './audit.js'
import { evaluatePolicy, type PaymentPolicy, type PaymentIntent } from './policy.js'

type Input = {
  policy: PaymentPolicy
  intent: PaymentIntent
  agentWalletAddress: `0x${string}`
  idempotencyKey: string
  budgetPeriod: string
  now: string
}

async function existing(client: PoolClient, key: string) {
  const { rows } = await client.query(
    'SELECT id, outcome, reason_codes FROM payment_intents WHERE idempotency_key = $1', [key],
  )
  return rows[0] as { id: string; outcome: 'allow' | 'deny' | 'approval_required'; reason_codes: string[] } | undefined
}

export async function authorizeAndReserve(pool: Pool, input: Input) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO budget_periods (policy_id, policy_version, period_start)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [input.policy.id, input.policy.version, input.budgetPeriod],
    )
    const { rows: [period] } = await client.query(
      `SELECT trim_scale(settled + reserved)::text AS used FROM budget_periods
       WHERE policy_id = $1 AND policy_version = $2 AND period_start = $3 FOR UPDATE`,
      [input.policy.id, input.policy.version, input.budgetPeriod],
    )
    const duplicate = await existing(client, input.idempotencyKey)
    if (duplicate) {
      await client.query('COMMIT')
      return {
        intentId: duplicate.id,
        duplicate: true,
        decision: { outcome: duplicate.outcome, reasonCodes: duplicate.reason_codes },
      }
    }

    const { rows: [agent] } = await client.query('SELECT status, wallet_address FROM agents WHERE id = $1', [input.intent.agentId])
    const { rows: [merchant] } = await client.query(
      'SELECT status, recipient FROM merchants WHERE realm = $1', [input.intent.merchant.realm],
    )

    const additionalDenials = []
    if (!agent) additionalDenials.push('AGENT_NOT_REGISTERED')
    else if (agent.status === 'active' && agent.wallet_address.toLowerCase() !== input.agentWalletAddress.toLowerCase()) {
      additionalDenials.push('AGENT_IDENTITY_MISMATCH')
    }
    if (!merchant || merchant.status !== 'active' || merchant.recipient.toLowerCase() !== input.intent.merchant.recipient.toLowerCase()) {
      additionalDenials.push('MERCHANT_NOT_ALLOWED')
    }
    const decision = await evaluatePolicy({
      policy: input.policy,
      agentStatus: agent?.status === 'revoked' ? 'revoked' : 'active',
      intent: input.intent,
      budgetUsed: period.used,
      now: input.now,
      additionalDenials,
    })
    const intentId = randomUUID()
    const status = decision.outcome === 'allow' ? 'authorized' : decision.outcome === 'deny' ? 'denied' : 'approval_required'
    await client.query(
      `INSERT INTO payment_intents
       (id, idempotency_key, challenge_id, challenge_digest, agent_id, merchant_realm, recipient,
        intent, policy_id, policy_version, outcome, reason_codes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [intentId, input.idempotencyKey, input.intent.mpp.challengeId, input.intent.mpp.challengeDigest ?? null,
        input.intent.agentId, input.intent.merchant.realm, input.intent.merchant.recipient, input.intent,
        input.policy.id, input.policy.version, decision.outcome, decision.reasonCodes, status],
    )
    let approvalId: string | undefined
    if (decision.outcome === 'approval_required') {
      const expiresAt = input.intent.mpp.expiresAt ?? new Date(Date.parse(input.now) + 5 * 60_000).toISOString()
      const request = createApprovalRequest({
        requestId: randomUUID(),
        requesterId: input.intent.agentId,
        action: { type: 'payment' },
        resource: input.intent,
        requestedAt: input.now,
        expiresAt,
      })
      approvalId = request.requestId
      await client.query(
        'INSERT INTO approvals (id, intent_id, request, status) VALUES ($1,$2,$3,$4)',
        [approvalId, intentId, request, request.status],
      )
    }
    if (decision.outcome === 'allow') {
      await client.query(
        `INSERT INTO budget_reservations (intent_id, policy_id, policy_version, period_start, amount, status)
         VALUES ($1,$2,$3,$4,$5,'reserved')`,
        [intentId, input.policy.id, input.policy.version, input.budgetPeriod, input.intent.amount],
      )
      await client.query(
        `UPDATE budget_periods SET reserved = reserved + $4
         WHERE policy_id = $1 AND policy_version = $2 AND period_start = $3`,
        [input.policy.id, input.policy.version, input.budgetPeriod, input.intent.amount],
      )
    }
    await client.query('COMMIT')
    return { intentId, duplicate: false, decision, approvalId }
  } catch (error) {
    await client.query('ROLLBACK')
    if ((error as { code?: string }).code === '23505') {
      await client.query('BEGIN')
      const duplicate = await existing(client, input.idempotencyKey)
      await client.query('COMMIT')
      if (duplicate) return {
        intentId: duplicate.id,
        duplicate: true,
        decision: { outcome: duplicate.outcome, reasonCodes: duplicate.reason_codes },
      }
      return { intentId: '', duplicate: false, decision: { outcome: 'deny' as const, reasonCodes: ['CHALLENGE_REPLAYED'] } }
    }
    throw error
  } finally {
    client.release()
  }
}

export async function resolveAndReserve(pool: Pool, input: {
  intentId: string
  policy: PaymentPolicy
  intent: PaymentIntent
  agentWalletAddress: `0x${string}`
  budgetPeriod: string
  approverId: string
  approved: boolean
  now: string
  auditPrivateKey?: Hex
}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [period] } = await client.query(
      `SELECT trim_scale(settled + reserved)::text AS used FROM budget_periods
       WHERE policy_id = $1 AND policy_version = $2 AND period_start = $3 FOR UPDATE`,
      [input.policy.id, input.policy.version, input.budgetPeriod],
    )
    const { rows: [intentRow] } = await client.query(
      `SELECT status, challenge_digest, policy_id, policy_version FROM payment_intents WHERE id = $1 FOR UPDATE`, [input.intentId],
    )
    const { rows: [approvalRow] } = await client.query(
      'SELECT request FROM approvals WHERE intent_id = $1 FOR UPDATE', [input.intentId],
    )
    if (!intentRow || intentRow.status !== 'approval_required' || !approvalRow) throw new Error('No pending approval for payment intent')
    if (intentRow.challenge_digest !== (input.intent.mpp.challengeDigest ?? null) || intentRow.policy_id !== input.policy.id ||
        intentRow.policy_version !== input.policy.version) throw new Error('Approved payment intent changed')
    const request = approvalRow.request as ApprovalRequest
    const approval = resolveApproval(request, {
      decision: input.approved ? 'APPROVED' : 'REJECTED',
      approverId: input.approverId,
      resolvedAt: input.now,
    })
    let decision: { outcome: 'allow' | 'deny' | 'approval_required'; reasonCodes: string[] }
    if (!input.approved) {
      decision = { outcome: 'deny', reasonCodes: ['HUMAN_REJECTED'] }
    } else {
      const { rows: [agent] } = await client.query('SELECT status, wallet_address FROM agents WHERE id = $1', [input.intent.agentId])
      const { rows: [merchant] } = await client.query(
        'SELECT status, recipient FROM merchants WHERE realm = $1', [input.intent.merchant.realm],
      )
      const additionalDenials = []
      if (!agent) additionalDenials.push('AGENT_NOT_REGISTERED')
      else if (agent.status === 'active' && agent.wallet_address.toLowerCase() !== input.agentWalletAddress.toLowerCase()) additionalDenials.push('AGENT_IDENTITY_MISMATCH')
      if (!merchant || merchant.status !== 'active' || merchant.recipient.toLowerCase() !== input.intent.merchant.recipient.toLowerCase()) additionalDenials.push('MERCHANT_NOT_ALLOWED')
      decision = await evaluatePolicy({
        policy: { ...input.policy, approval: undefined },
        agentStatus: agent?.status === 'revoked' ? 'revoked' : 'active',
        intent: input.intent,
        budgetUsed: period.used,
        now: input.now,
        additionalDenials,
      })
    }
    await client.query(
      'UPDATE approvals SET request = $2, status = $3, approver_id = $4, resolved_at = $5 WHERE intent_id = $1',
      [input.intentId, approval, approval.status, input.approverId, input.now],
    )
    if (decision.outcome === 'allow') {
      await client.query(
        `INSERT INTO budget_reservations (intent_id, policy_id, policy_version, period_start, amount, status)
         VALUES ($1,$2,$3,$4,$5,'reserved')`,
        [input.intentId, input.policy.id, input.policy.version, input.budgetPeriod, input.intent.amount],
      )
      await client.query(
        `UPDATE budget_periods SET reserved = reserved + $4
         WHERE policy_id = $1 AND policy_version = $2 AND period_start = $3`,
        [input.policy.id, input.policy.version, input.budgetPeriod, input.intent.amount],
      )
    }
    await client.query(
      'UPDATE payment_intents SET outcome = $2, reason_codes = $3, status = $4 WHERE id = $1',
      [input.intentId, decision.outcome, decision.reasonCodes, decision.outcome === 'allow' ? 'authorized' : 'denied'],
    )
    if (input.auditPrivateKey) await appendAuditInTransaction(client, input.intentId, {
      eventType: approval.status === 'APPROVED' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED',
      occurredAt: input.now,
      actor: input.approverId,
      payload: { approvalId: approval.requestId, status: approval.status },
    }, input.auditPrivateKey)
    await client.query('COMMIT')
    return { decision, approval }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function releaseReservation(pool: Pool, intentId: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE budget_reservations SET status = 'released'
       WHERE intent_id = $1 AND status = 'reserved'
       RETURNING policy_id, policy_version, period_start, amount`,
      [intentId],
    )
    const reservation = rows[0]
    if (!reservation) {
      await client.query('COMMIT')
      return false
    }
    await client.query(
      `UPDATE budget_periods SET reserved = reserved - $4
       WHERE policy_id = $1 AND policy_version = $2 AND period_start = $3`,
      [reservation.policy_id, reservation.policy_version, reservation.period_start, reservation.amount],
    )
    await client.query(
      'UPDATE payment_intents SET status = $2 WHERE id = $1',
      [intentId, 'failed'],
    )
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function markExecuting(pool: Pool, intentId: string) {
  const { rowCount } = await pool.query(
    "UPDATE payment_intents SET status = 'executing' WHERE id = $1 AND status = 'authorized'", [intentId],
  )
  return rowCount === 1
}

export async function settleReservation(pool: Pool, intentId: string, settlement: { txHash?: string; receipt?: unknown } = {}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE budget_reservations SET status = 'settled'
       WHERE intent_id = $1 AND status = 'reserved' RETURNING policy_id, policy_version, period_start, amount`, [intentId],
    )
    const reservation = rows[0]
    if (!reservation) {
      await client.query('COMMIT')
      return false
    }
    await client.query(
      `UPDATE budget_periods SET reserved = reserved - $4, settled = settled + $4
       WHERE policy_id = $1 AND policy_version = $2 AND period_start = $3`,
      [reservation.policy_id, reservation.policy_version, reservation.period_start, reservation.amount],
    )
    await client.query('UPDATE payment_intents SET status = $2 WHERE id = $1', [intentId, 'settled'])
    await client.query(
      'INSERT INTO settlements (intent_id, tx_hash, receipt) VALUES ($1,$2,$3)',
      [intentId, settlement.txHash ?? null, settlement.receipt ?? {}],
    )
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
