import { Fetch, tempo } from 'mppx/client'
import { Receipt } from 'mppx'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { privateKeyToAccount } from 'viem/accounts'
import { normalizeMppChallenge, PATHUSD } from './challenge.js'
import { appendAuditEvent, exportAuditBundle, verifyAuditBundle } from './audit.js'
import { signPermit, verifyPermit } from './permit.js'
import type { PaymentPolicy } from './policy.js'
import { authorizeAndReserve, markExecuting, releaseReservation, settleReservation } from './storage.js'

const privateKey = process.env.AGENT_PRIVATE_KEY
const wardenPrivateKey = process.env.WARDEN_AUTH_PRIVATE_KEY
const merchantAddress = process.env.MERCHANT_ADDRESS
const databaseUrl = process.env.DATABASE_URL
const resources = {
  'browser-session': 'browser-automation',
  'gpu-minute': 'gpu-compute',
  'large-transfer': 'crypto-transfer',
} as const
const resource = process.argv[2] ?? 'browser-session'
if (!(resource in resources)) throw new Error(`Choose one of: ${Object.keys(resources).join(', ')}`)
const purpose = resources[resource as keyof typeof resources]
const url = `http://127.0.0.1:8787/${resource}`

if (!privateKey || !/^0x[\da-fA-F]{64}$/.test(privateKey)) {
  throw new Error('Set AGENT_PRIVATE_KEY to a funded Tempo Moderato testnet key')
}
if (!wardenPrivateKey || !/^0x[\da-fA-F]{64}$/.test(wardenPrivateKey)) {
  throw new Error('Set WARDEN_AUTH_PRIVATE_KEY to a separate Warden authorization key')
}
if (!merchantAddress || !/^0x[\da-fA-F]{40}$/.test(merchantAddress)) {
  throw new Error('Set MERCHANT_ADDRESS to the merchant wallet address')
}
if (!databaseUrl) throw new Error('Set DATABASE_URL and apply db/001_init.sql before paying')

const pool = new pg.Pool({ connectionString: databaseUrl })
let activeIntentId: string | undefined

const policy: PaymentPolicy = {
  id: 'engineering-agent',
  version: 1,
  allowedAgents: ['coding-agent'],
  allowedMerchants: ['127.0.0.1'],
  allowedPurposes: ['browser-automation', 'gpu-compute'],
  allowedAssets: [PATHUSD],
  allowedProtocols: ['mpp'],
  maxPerTransaction: '50',
  budget: { period: 'day', amount: '50' },
  approval: { above: '20' },
}

const agentAddress = privateKeyToAccount(privateKey as `0x${string}`).address
await pool.query(
  `INSERT INTO agents (id, principal_id, name, status, wallet_address)
   VALUES ('coding-agent','engineering-team','Coding Agent','active',$1) ON CONFLICT (id) DO NOTHING`,
  [agentAddress],
)
await pool.query(
  `INSERT INTO merchants (id, realm, recipient, status)
   VALUES ('demo-merchant','127.0.0.1',$1,'active')
   ON CONFLICT (realm) DO UPDATE SET recipient = EXCLUDED.recipient`,
  [merchantAddress],
)
await pool.query(
  `INSERT INTO policies (id, version, definition) VALUES ($1,$2,$3) ON CONFLICT (id, version) DO NOTHING`,
  [policy.id, policy.version, policy],
)

const fetch = Fetch.from({
  methods: [tempo.charge({
    account: privateKeyToAccount(privateKey as `0x${string}`),
    expectedChainId: 42431,
  })],
  onChallenge: async (challenge, { createCredential }) => {
    const now = new Date().toISOString()
    const intent = normalizeMppChallenge(challenge, {
      policy,
      agentId: 'coding-agent',
      purpose,
      merchantAddress,
      budgetUsed: '0',
      now,
    })
    if ('error' in intent) throw new Error(`Invalid payment challenge: ${intent.error}`)
    const reservation = await authorizeAndReserve(pool, {
      policy,
      intent,
      agentWalletAddress: agentAddress,
      idempotencyKey: `coding-agent:${challenge.id}`,
      budgetPeriod: now.slice(0, 10),
      now,
    })
    if (reservation.duplicate) throw new Error('Payment challenge was already authorized')
    activeIntentId = reservation.intentId
    let decision = reservation.decision
    if (decision.outcome === 'approval_required') {
      if (!reservation.approvalId) throw new Error('Approval request was not persisted')
      console.log(`Approval required. Open http://127.0.0.1:${process.env.API_PORT ?? 8788}`)
      const expires = Date.parse(intent.mpp.expiresAt ?? new Date(Date.parse(now) + 5 * 60_000).toISOString())
      while (Date.now() < expires) {
        const { rows: [status] } = await pool.query(
          `SELECT a.status, p.outcome, p.reason_codes FROM approvals a
           JOIN payment_intents p ON p.id = a.intent_id WHERE a.id = $1`, [reservation.approvalId],
        )
        if (status?.status !== 'PENDING') {
          decision = { outcome: status.outcome, reasonCodes: status.reason_codes }
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      if (decision.outcome === 'approval_required') throw new Error('Approval expired or was not resolved')
    }
    if (decision.outcome !== 'allow') {
      await appendAuditEvent(pool, reservation.intentId, {
        eventType: 'PAYMENT_DENIED', occurredAt: now,
        payload: { reasonCodes: decision.reasonCodes },
      }, wardenPrivateKey as `0x${string}`)
      throw new Error(`Payment ${decision.outcome}: ${decision.reasonCodes.join(', ')}`)
    }
    const signed = await signPermit({
      privateKey: wardenPrivateKey as `0x${string}`,
      principalId: 'engineering-team',
      intent,
      policy,
      decisionId: randomUUID(),
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    })
    const verified = await verifyPermit(signed, privateKeyToAccount(wardenPrivateKey as `0x${string}`).address, intent.mpp.challengeDigest as `0x${string}`)
    if (!verified) throw new Error('Warden permit verification failed')
    await appendAuditEvent(pool, reservation.intentId, {
      eventType: 'PAYMENT_AUTHORIZED', occurredAt: now,
      payload: { decision, permit: signed.permit, signature: signed.signature },
    }, wardenPrivateKey as `0x${string}`)
    if (!await markExecuting(pool, reservation.intentId)) throw new Error('Payment intent is no longer executable')
    return createCredential()
  },
})

try {
  const response = await fetch(url)
  const receipt = response.headers.get('Payment-Receipt')
  console.log('HTTP status:', response.status)
  console.log('Payment receipt:', receipt ?? '(missing)')
  console.log('Response:', await response.text())
  if (activeIntentId) {
    if (receipt) {
      let parsed: unknown
      let txHash: string | undefined
      try {
        parsed = Receipt.deserialize(receipt)
        const { method, reference } = parsed as { method?: unknown; reference?: unknown }
        if (method === 'tempo' && typeof reference === 'string' && /^0x[\da-fA-F]{64}$/.test(reference)) txHash = reference
      } catch {
        parsed = { raw: receipt }
      }
      await settleReservation(pool, activeIntentId, { txHash, receipt: parsed })
      await appendAuditEvent(pool, activeIntentId, {
        eventType: 'PAYMENT_SETTLED', occurredAt: new Date().toISOString(), payload: { receipt: parsed, transactionHash: txHash },
      }, wardenPrivateKey as `0x${string}`)
      const bundle = await exportAuditBundle(pool, activeIntentId)
      const audit = await verifyAuditBundle(bundle, privateKeyToAccount(wardenPrivateKey as `0x${string}`).address)
      console.log('Audit verified:', audit.valid)
      console.log('Retain this signed audit bundle outside Postgres:', JSON.stringify(bundle))
    } else if (!response.ok && response.status < 500) {
      await releaseReservation(pool, activeIntentId)
    } else {
      console.error('Payment outcome uncertain; budget reservation remains held for reconciliation')
      process.exitCode = 1
    }
  }
  if (!response.ok) process.exitCode = 1
} catch (error) {
  if (activeIntentId) {
    const { rows: [intent] } = await pool.query('SELECT status FROM payment_intents WHERE id = $1', [activeIntentId])
    if (intent?.status === 'authorized') await releaseReservation(pool, activeIntentId)
    else if (intent?.status === 'executing') console.error('Payment outcome uncertain; budget reservation remains held for reconciliation')
  }
  throw error
} finally {
  await pool.end()
}
