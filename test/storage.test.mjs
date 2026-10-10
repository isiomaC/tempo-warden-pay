import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { authorizeAndReserve, releaseReservation, resolveAndReserve, settleReservation } from '../src/storage.ts'
import { appendAuditEvent, exportAuditBundle, verifyAuditBundle } from '../src/audit.ts'
import { privateKeyToAccount } from 'viem/accounts'

const databaseUrl = process.env.DATABASE_URL

test('budget reservations are atomic and idempotent', { skip: !databaseUrl }, async (t) => {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const id = randomUUID()
  const txHash = `0x${id.replaceAll('-', '').padEnd(64, '0')}`
  const testAgentId = 'test-agent-' + id
  const testMerchantRealm = 'merchant-' + id + '.test'
  const policy = {
    id,
    version: 1,
    allowedAgents: [testAgentId],
    allowedMerchants: [testMerchantRealm],
    allowedPurposes: ['browser-automation'],
    allowedAssets: ['pathUSD'],
    allowedProtocols: ['mpp'],
    maxPerTransaction: '5',
    budget: { period: 'day', amount: '5' },
  }
  const makeInput = (key) => ({
    policy,
    intent: {
      agentId: testAgentId,
      merchant: { realm: testMerchantRealm, recipient: '0x0000000000000000000000000000000000000001' },
      amount: '3.20',
      asset: 'pathUSD',
      purpose: 'browser-automation',
      protocol: 'mpp',
      mpp: { challengeId: `challenge-${key}`, realm: testMerchantRealm, method: 'tempo', intent: 'charge' },
    },
    agentWalletAddress: '0x0000000000000000000000000000000000000001',
    idempotencyKey: key,
    budgetPeriod: '2026-10-08',
    now: '2026-10-08T12:00:00.000Z',
  })

  t.after(() => pool.end())
  await pool.query(
    'INSERT INTO agents (id, principal_id, name, status, wallet_address) VALUES ($1,$2,$3,$4,$5)',
    [testAgentId, 'test-principal', 'Test Agent', 'active', '0x0000000000000000000000000000000000000001'],
  )
  await pool.query(
    'INSERT INTO merchants (id, realm, recipient) VALUES ($1,$2,$3)',
    ['merchant-' + id, testMerchantRealm, '0x0000000000000000000000000000000000000001'],
  )
  const [first, second] = await Promise.all([
    authorizeAndReserve(pool, makeInput(`${id}-first`)),
    authorizeAndReserve(pool, makeInput(`${id}-second`)),
  ])
  assert.deepEqual([first.decision.outcome, second.decision.outcome].sort(), ['allow', 'deny'])

  const allowed = first.decision.outcome === 'allow' ? first : second
  const denied = first.decision.outcome === 'deny' ? first : second
  const allowedKey = first.decision.outcome === 'allow' ? `${id}-first` : `${id}-second`
  const duplicate = await authorizeAndReserve(pool, makeInput(allowedKey))
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.intentId, allowed.intentId)

  assert.equal(await releaseReservation(pool, allowed.intentId), true)
  assert.equal(await releaseReservation(pool, allowed.intentId), false)
  const retry = await authorizeAndReserve(pool, makeInput(`${id}-retry`))
  assert.equal(retry.decision.outcome, 'allow')
  assert.equal(await settleReservation(pool, retry.intentId, { txHash, receipt: { status: 'success' } }), true)
  assert.equal(await settleReservation(pool, retry.intentId), false)
  const { rows: [settlement] } = await pool.query('SELECT tx_hash, receipt FROM settlements WHERE intent_id = $1', [retry.intentId])
  assert.equal(settlement.tx_hash, txHash)
  assert.equal(denied.decision.reasonCodes.includes('DAILY_BUDGET_EXCEEDED'), true)

  const approvalPolicy = { ...policy, id: `${id}-approval`, budget: { period: 'day', amount: '10' }, approval: { above: '2' } }
  const approvalInput = { ...makeInput(`${id}-approval`), policy: approvalPolicy }
  const pending = await authorizeAndReserve(pool, approvalInput)
  assert.equal(pending.decision.outcome, 'approval_required')
  assert.ok(pending.approvalId)
  const approved = await resolveAndReserve(pool, {
    intentId: pending.intentId,
    policy: approvalPolicy,
    intent: approvalInput.intent,
    agentWalletAddress: '0x0000000000000000000000000000000000000001',
    budgetPeriod: '2026-10-08',
    approverId: 'test-operator',
    approved: true,
    now: '2026-10-08T12:01:00.000Z',
  })
  assert.equal(approved.decision.outcome, 'allow')
  assert.equal(approved.approval.status, 'APPROVED')
  assert.equal(await releaseReservation(pool, pending.intentId), true)

  const auditKey = `0x${'02'.padStart(64, '0')}`
  const signer = privateKeyToAccount(auditKey).address
  await appendAuditEvent(pool, retry.intentId, {
    eventType: 'PAYMENT_SETTLED',
    occurredAt: '2026-10-08T12:00:00.000Z',
    payload: { amount: '3.20', transactionHash: txHash },
  }, auditKey)
  const bundle = await exportAuditBundle(pool, retry.intentId)
  assert.equal((await verifyAuditBundle(bundle, signer)).valid, true)
  const edited = structuredClone(bundle)
  edited.entries[0].event.payload.amount = '4.20'
  assert.equal((await verifyAuditBundle(edited, signer)).valid, false)
  const truncated = { ...bundle, entries: [] }
  assert.equal((await verifyAuditBundle(truncated, signer)).valid, false)
})
