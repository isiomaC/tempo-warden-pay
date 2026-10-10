import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateMppChallenge, PATHUSD } from '../src/challenge.ts'

const recipient = '0x0000000000000000000000000000000000000001'
const config = {
  agentId: 'coding-agent',
  purpose: 'browser-automation',
  merchantAddress: recipient,
  budgetUsed: '0',
  now: '2026-10-08T12:00:00.000Z',
  policy: {
    id: 'demo',
    version: 1,
    allowedAgents: ['coding-agent'],
    allowedMerchants: ['127.0.0.1'],
    allowedPurposes: ['browser-automation'],
    allowedAssets: [PATHUSD],
    allowedProtocols: ['mpp'],
    maxPerTransaction: '50',
    budget: { period: 'day', amount: '50' },
    approval: { above: '20' },
  },
}

function challenge(overrides = {}) {
  return {
    id: 'challenge-1',
    method: 'tempo',
    intent: 'charge',
    realm: '127.0.0.1',
    expires: '2026-10-08T13:00:00.000Z',
    request: {
      amount: '3200000',
      currency: PATHUSD,
      recipient,
      methodDetails: { chainId: 42431 },
    },
    ...overrides,
  }
}

test('normalizes and allows the exact pathUSD MPP challenge', async () => {
  assert.deepEqual(await evaluateMppChallenge(challenge(), config), { outcome: 'allow', reasonCodes: [] })
})

test('does not authorize a challenge sent to a different recipient', async () => {
  assert.deepEqual(await evaluateMppChallenge(challenge({ request: { ...challenge().request, recipient: '0x0000000000000000000000000000000000000002' } }), config), {
    outcome: 'deny', reasonCodes: ['CHALLENGE_CHANGED'],
  })
})

test('returns approval required above the policy threshold', async () => {
  assert.equal((await evaluateMppChallenge(challenge({ request: { ...challenge().request, amount: '21000000' } }), config)).outcome, 'approval_required')
})
