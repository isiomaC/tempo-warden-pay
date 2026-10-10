import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePolicy } from '../src/policy.ts'

const policy = {
  id: 'engineering-agent',
  version: 1,
  allowedAgents: ['coding-agent'],
  allowedMerchants: ['sandbox.demo.wardenpay.dev'],
  deniedMerchants: ['blocked.example'],
  allowedPurposes: ['browser-automation', 'gpu-compute'],
  allowedAssets: ['pathUSD'],
  allowedProtocols: ['mpp'],
  maxPerTransaction: '40',
  budget: { period: 'day', amount: '50' },
  approval: { above: '20' },
}

function input(overrides = {}) {
  return {
    policy,
    agentStatus: 'active',
    intent: {
      agentId: 'coding-agent',
      merchant: { realm: 'sandbox.demo.wardenpay.dev', recipient: '0x0000000000000000000000000000000000000001' },
      amount: '3.20',
      asset: 'pathUSD',
      purpose: 'browser-automation',
      protocol: 'mpp',
      mpp: { expiresAt: '2026-10-08T13:00:00.000Z' },
    },
    budgetUsed: '0',
    now: '2026-10-08T12:00:00.000Z',
    ...overrides,
  }
}

test('allows an intent that satisfies the policy', async () => {
  assert.deepEqual(await evaluatePolicy(input()), { outcome: 'allow', reasonCodes: [] })
})

test('denial rules win over approval requirements', async () => {
  const result = await evaluatePolicy(input({
    intent: { ...input().intent, merchant: { ...input().intent.merchant, realm: 'blocked.example' }, amount: '45' },
    budgetUsed: '10',
  }))
  assert.equal(result.outcome, 'deny')
  assert.ok(result.reasonCodes.includes('MERCHANT_DENIED'))
  assert.ok(result.reasonCodes.includes('TRANSACTION_LIMIT_EXCEEDED'))
  assert.ok(result.reasonCodes.includes('DAILY_BUDGET_EXCEEDED'))
  assert.ok(!result.reasonCodes.includes('APPROVAL_REQUIRED'))
})

test('requires approval only above the threshold', async () => {
  assert.equal((await evaluatePolicy(input({ intent: { ...input().intent, amount: '20.01' } }))).outcome, 'approval_required')
  assert.equal((await evaluatePolicy(input({ intent: { ...input().intent, amount: '20.00' } }))).outcome, 'allow')
})

test('denies unknown merchants and disallowed purpose, asset, or protocol', async () => {
  const base = input()
  const cases = [
    [{ ...base.intent, merchant: { ...base.intent.merchant, realm: 'unknown.example' } }, 'MERCHANT_NOT_ALLOWED'],
    [{ ...base.intent, purpose: 'crypto-transfer' }, 'PURPOSE_NOT_ALLOWED'],
    [{ ...base.intent, asset: 'otherUSD' }, 'ASSET_NOT_ALLOWED'],
    [{ ...base.intent, protocol: 'other' }, 'PROTOCOL_NOT_ALLOWED'],
  ]
  for (const [intent, reason] of cases) {
    const result = await evaluatePolicy(input({ intent }))
    assert.ok(result.reasonCodes.includes(reason))
    assert.equal(result.outcome, 'deny')
  }
})

test('allows a payment that exactly reaches the daily budget', async () => {
  assert.equal((await evaluatePolicy(input({ budgetUsed: '46.8' }))).outcome, 'allow')
})

test('denies expired agents, policies, and challenges', async () => {
  const base = input()
  assert.ok((await evaluatePolicy(input({ agentStatus: 'revoked' }))).reasonCodes.includes('AGENT_REVOKED'))
  assert.ok((await evaluatePolicy(input({ policy: { ...policy, expiresAt: '2026-10-08T11:00:00.000Z' } }))).reasonCodes.includes('POLICY_EXPIRED'))
  assert.ok((await evaluatePolicy(input({ intent: { ...base.intent, mpp: { expiresAt: '2026-10-08T11:00:00.000Z' } } }))).reasonCodes.includes('CHALLENGE_EXPIRED'))
})

test('fails closed on malformed amount input', async () => {
  const result = await evaluatePolicy(input({ intent: { ...input().intent, amount: '3.2e1' } }))
  assert.deepEqual(result, { outcome: 'deny', reasonCodes: ['INVALID_AMOUNT'] })
})
