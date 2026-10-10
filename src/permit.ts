import { randomBytes, randomUUID } from 'node:crypto'
import { keccak256, stringToHex, verifyTypedData, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { PaymentIntent, PaymentPolicy } from './policy.js'

export type AuthorizationPermit = {
  version: 1
  authorizationId: string
  principalId: string
  agentId: string
  chainId: number
  protocol: 'mpp'
  challengeDigest: Hex
  challengeId: string
  realm: string
  recipient: Hex
  asset: string
  amount: string
  purpose: string
  policyId: string
  policyVersion: number
  decisionId: string
  issuedAt: number
  expiresAt: number
  nonce: Hex
}

export type SignedPermit = { permit: AuthorizationPermit; signature: Hex; signer: Hex }

const domain = { name: 'Warden Pay', version: '1', chainId: 42431 } as const
const types = {
  WardenAuthorizationPermit: [
    { name: 'version', type: 'uint8' },
    { name: 'authorizationId', type: 'string' },
    { name: 'principalId', type: 'string' },
    { name: 'agentId', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'protocol', type: 'string' },
    { name: 'challengeDigest', type: 'bytes32' },
    { name: 'challengeId', type: 'string' },
    { name: 'realm', type: 'string' },
    { name: 'recipient', type: 'address' },
    { name: 'asset', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'purpose', type: 'string' },
    { name: 'policyId', type: 'string' },
    { name: 'policyVersion', type: 'uint256' },
    { name: 'decisionId', type: 'string' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('Challenge contains a non-JSON value')
  return `{${Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
}

function typedMessage(permit: AuthorizationPermit) {
  return {
    ...permit,
    chainId: BigInt(permit.chainId),
    policyVersion: BigInt(permit.policyVersion),
    issuedAt: BigInt(permit.issuedAt),
    expiresAt: BigInt(permit.expiresAt),
  }
}

export function hashMppChallenge(challenge: {
  id: string; realm: string; method: string; intent: string; request: Record<string, unknown>; expires?: string
}): Hex {
  return keccak256(stringToHex(canonical({
    id: challenge.id,
    realm: challenge.realm,
    method: challenge.method,
    intent: challenge.intent,
    request: challenge.request,
    expires: challenge.expires,
  })))
}

export async function signPermit(input: {
  privateKey: Hex
  principalId: string
  intent: PaymentIntent
  policy: PaymentPolicy
  decisionId: string
  expiresAt: number
  now?: number
}): Promise<SignedPermit> {
  const account = privateKeyToAccount(input.privateKey)
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const permit: AuthorizationPermit = {
    version: 1,
    authorizationId: randomUUID(),
    principalId: input.principalId,
    agentId: input.intent.agentId,
    chainId: 42431,
    protocol: 'mpp',
    challengeDigest: input.intent.mpp.challengeDigest as Hex,
    challengeId: input.intent.mpp.challengeId,
    realm: input.intent.merchant.realm,
    recipient: input.intent.merchant.recipient,
    asset: input.intent.asset,
    amount: input.intent.amount,
    purpose: input.intent.purpose,
    policyId: input.policy.id,
    policyVersion: input.policy.version,
    decisionId: input.decisionId,
    issuedAt: now,
    expiresAt: input.expiresAt,
    nonce: `0x${randomBytes(32).toString('hex')}`,
  }
  if (!permit.challengeDigest || !/^0x[0-9a-f]{64}$/i.test(permit.challengeDigest)) throw new Error('Missing MPP challenge digest')
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) throw new Error('Permit expiry must be in the future')
  const signature = await account.signTypedData({ domain, types, primaryType: 'WardenAuthorizationPermit', message: typedMessage(permit) })
  return { permit, signature, signer: account.address }
}

export async function verifyPermit(
  signed: SignedPermit,
  expectedSigner: Hex,
  expectedChallengeDigest: Hex,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { permit, signature, signer } = signed
  if (signer.toLowerCase() !== expectedSigner.toLowerCase() || permit.chainId !== 42431 ||
      permit.protocol !== 'mpp' || permit.challengeDigest !== expectedChallengeDigest ||
      permit.issuedAt > now || permit.expiresAt <= now) return false
  try {
    return await verifyTypedData({
      address: expectedSigner,
      domain,
      types,
      primaryType: 'WardenAuthorizationPermit',
      message: typedMessage(permit),
      signature,
    })
  } catch {
    return false
  }
}
