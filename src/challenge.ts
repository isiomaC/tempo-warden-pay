import { formatUnits } from 'viem'
import { evaluatePolicy, type PaymentIntent, type PaymentPolicy } from './policy.js'
import { hashMppChallenge } from './permit.js'

export const PATHUSD = '0x20c0000000000000000000000000000000000000'
const MODERATO_CHAIN_ID = 42431

type MppChallenge = {
  id: string
  method: string
  intent: string
  realm: string
  expires?: string
  digest?: string
  request: Record<string, unknown>
}

type ChallengePolicyInput = {
  policy: PaymentPolicy
  agentId: string
  purpose: string
  merchantAddress: string
  budgetUsed: string
  now: string
}

export function normalizeMppChallenge(challenge: MppChallenge, input: ChallengePolicyInput): PaymentIntent | { error: string } {
  if (challenge.method !== 'tempo' || challenge.intent !== 'charge') {
    return { error: 'PROTOCOL_NOT_ALLOWED' }
  }

  const { amount, currency, recipient, methodDetails } = challenge.request
  if (
    typeof amount !== 'string' || !/^\d+$/.test(amount) ||
    typeof recipient !== 'string' || !/^0x[\da-fA-F]{40}$/.test(recipient) ||
    recipient.toLowerCase() !== input.merchantAddress.toLowerCase() ||
    typeof methodDetails !== 'object' || methodDetails === null ||
    (methodDetails as { chainId?: unknown }).chainId !== MODERATO_CHAIN_ID
  ) {
    return { error: 'CHALLENGE_CHANGED' }
  }
  if (typeof currency !== 'string' || currency.toLowerCase() !== PATHUSD) {
    return { error: 'ASSET_NOT_ALLOWED' }
  }

  return {
    agentId: input.agentId,
    merchant: { realm: challenge.realm, recipient: recipient as `0x${string}` },
    amount: formatUnits(BigInt(amount), 6),
    asset: PATHUSD,
    purpose: input.purpose,
    protocol: 'mpp',
    mpp: {
      challengeId: challenge.id,
      realm: challenge.realm,
      method: challenge.method,
      intent: challenge.intent,
      challengeDigest: hashMppChallenge(challenge),
      expiresAt: challenge.expires,
    },
  }
}

export async function evaluateMppChallenge(challenge: MppChallenge, input: ChallengePolicyInput) {
  const intent = normalizeMppChallenge(challenge, input)
  if ('error' in intent) return { outcome: 'deny', reasonCodes: [intent.error] } as const
  return evaluatePolicy({
    policy: input.policy,
    agentStatus: 'active',
    budgetUsed: input.budgetUsed,
    now: input.now,
    intent,
  })
}
