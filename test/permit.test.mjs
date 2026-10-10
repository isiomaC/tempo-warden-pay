import assert from 'node:assert/strict'
import test from 'node:test'
import { privateKeyToAccount } from 'viem/accounts'
import { hashMppChallenge, signPermit, verifyPermit } from '../src/permit.ts'

const key = `0x${'01'.padStart(64, '0')}`
const challenge = {
  id: 'challenge-1', realm: 'merchant.test', method: 'tempo', intent: 'charge',
  request: { amount: '3200000', currency: '0x20c0000000000000000000000000000000000000', recipient: '0x0000000000000000000000000000000000000001', methodDetails: { chainId: 42431 } },
}
const intent = {
  agentId: 'coding-agent',
  merchant: { realm: challenge.realm, recipient: challenge.request.recipient },
  amount: '3.2', asset: challenge.request.currency, purpose: 'browser-automation', protocol: 'mpp',
  mpp: { challengeId: challenge.id, realm: challenge.realm, method: challenge.method, intent: challenge.intent, challengeDigest: hashMppChallenge(challenge) },
}
const policy = { id: 'engineering-agent', version: 1 }

test('signs and verifies an EIP-712 permit bound to the current challenge', async () => {
  const now = 1_800_000_000
  const signed = await signPermit({ privateKey: key, principalId: 'engineering-team', intent, policy, decisionId: 'decision-1', expiresAt: now + 60, now })
  const signer = privateKeyToAccount(key).address
  assert.equal(await verifyPermit(signed, signer, intent.mpp.challengeDigest, now), true)
  assert.equal(await verifyPermit(signed, signer, hashMppChallenge({ ...challenge, request: { ...challenge.request, amount: '3200001' } }), now), false)
  assert.equal(await verifyPermit({ ...signed, permit: { ...signed.permit, amount: '4' } }, signer, intent.mpp.challengeDigest, now), false)
  assert.equal(await verifyPermit(signed, signer, intent.mpp.challengeDigest, now + 60), false)
})
