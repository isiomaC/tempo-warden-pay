import { createWarden, definePolicy, type AuthorizationRule } from '@stlw/warden'

export type PaymentIntent = {
  agentId: string
  merchant: { realm: string; recipient: `0x${string}` }
  amount: string
  asset: string
  purpose: string
  protocol: 'mpp'
  mpp: {
    challengeId: string
    realm: string
    method: string
    intent: string
    challengeDigest?: string
    expiresAt?: string
  }
}

export type PaymentPolicy = {
  id: string
  version: number
  allowedAgents?: string[]
  allowedMerchants?: string[]
  deniedMerchants?: string[]
  allowedPurposes?: string[]
  allowedAssets?: string[]
  allowedProtocols?: Array<'mpp'>
  maxPerTransaction?: string
  budget?: { period: 'day'; amount: string }
  approval?: { above: string }
  expiresAt?: string
}

type PolicyInput = {
  policy: PaymentPolicy
  agentStatus: 'active' | 'revoked'
  intent: PaymentIntent
  /** Settled spend plus active reservations for the policy's budget period. */
  budgetUsed: string
  additionalDenials?: string[]
  now: string
}

type PolicyDecision = {
  outcome: 'allow' | 'deny' | 'approval_required'
  reasonCodes: string[]
}

type Decimal = { units: bigint; scale: number }

function decimal(value: string): Decimal {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(value)
  if (!match || match[1].length > 30) throw new Error('Invalid amount')
  const fraction = match[2] ?? ''
  return { units: BigInt(match[1] + fraction), scale: fraction.length }
}

function compare(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale)
  const left = a.units * 10n ** BigInt(scale - a.scale)
  const right = b.units * 10n ** BigInt(scale - b.scale)
  return left < right ? -1 : left > right ? 1 : 0
}

function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale)
  return {
    units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale),
    scale,
  }
}

function expired(expiry: string | undefined, now: string): boolean {
  if (!expiry) return false
  const deadline = Date.parse(expiry)
  const current = Date.parse(now)
  return !Number.isFinite(deadline) || !Number.isFinite(current) || deadline <= current
}

export async function evaluatePolicy(input: PolicyInput): Promise<PolicyDecision> {
  const { policy, intent } = input
  let amount: Decimal
  let used: Decimal
  try {
    amount = decimal(intent.amount)
    used = decimal(input.budgetUsed)
    if (policy.maxPerTransaction !== undefined) decimal(policy.maxPerTransaction)
    if (policy.budget) decimal(policy.budget.amount)
    if (policy.approval) decimal(policy.approval.above)
  } catch {
    return { outcome: 'deny', reasonCodes: ['INVALID_AMOUNT'] }
  }

  const reasons = new Set<string>()
  if (input.agentStatus !== 'active') reasons.add('AGENT_REVOKED')
  for (const reason of input.additionalDenials ?? []) reasons.add(reason)
  if (expired(policy.expiresAt, input.now)) reasons.add('POLICY_EXPIRED')
  if (expired(intent.mpp.expiresAt, input.now)) reasons.add('CHALLENGE_EXPIRED')

  const merchant = intent.merchant.realm.toLowerCase()
  if (policy.deniedMerchants?.some((item) => item.toLowerCase() === merchant)) {
    reasons.add('MERCHANT_DENIED')
  }
  if (policy.allowedAgents && !policy.allowedAgents.includes(intent.agentId)) {
    reasons.add('AGENT_NOT_ALLOWED')
  }
  if (policy.allowedMerchants && !policy.allowedMerchants.some((item) => item.toLowerCase() === merchant)) {
    reasons.add('MERCHANT_NOT_ALLOWED')
  }
  if (policy.allowedPurposes && !policy.allowedPurposes.includes(intent.purpose)) {
    reasons.add('PURPOSE_NOT_ALLOWED')
  }
  if (policy.allowedAssets && !policy.allowedAssets.some((item) => item.toLowerCase() === intent.asset.toLowerCase())) {
    reasons.add('ASSET_NOT_ALLOWED')
  }
  if (policy.allowedProtocols && !policy.allowedProtocols.includes(intent.protocol)) {
    reasons.add('PROTOCOL_NOT_ALLOWED')
  }
  if (policy.maxPerTransaction && compare(amount, decimal(policy.maxPerTransaction)) > 0) {
    reasons.add('TRANSACTION_LIMIT_EXCEEDED')
  }
  // The caller must read and update settled spend plus active reservations transactionally.
  if (policy.budget && compare(add(used, amount), decimal(policy.budget.amount)) > 0) {
    reasons.add('DAILY_BUDGET_EXCEEDED')
  }

  const approvalRequired = reasons.size === 0 && policy.approval && compare(amount, decimal(policy.approval.above)) > 0
  const rules: AuthorizationRule[] = [...reasons].map((id) => ({
    id,
    effect: 'DENY' as const,
    conditions: [{ name: 'has-reason', value: id }],
  }))
  if (approvalRequired) rules.push({
    id: 'APPROVAL_REQUIRED',
    effect: 'PENDING_APPROVAL',
    conditions: [{ name: 'has-reason', value: 'APPROVAL_REQUIRED' }],
  })
  rules.push({ id: 'PAYMENT_ALLOWED', effect: 'ALLOW', conditions: [{ name: 'clear', value: true }] })
  const authorizationPolicy = definePolicy({ id: policy.id, version: policy.version, rules })
  const warden = createWarden({ extensions: [{
    name: 'payment',
    version: '1',
    conditions: [{
      name: 'has-reason',
      evaluate: (request, expected) => (request.context as { reasons: string[] }).reasons.includes(expected as string),
    }, {
      name: 'clear',
      evaluate: (request) => (request.context as { reasons: string[] }).reasons.length === 0,
    }],
  }] })
  const decision = await warden.evaluate(authorizationPolicy, {
    subject: { id: intent.agentId },
    action: { type: 'payment' },
    resource: { merchant: intent.merchant.realm },
    context: { reasons: [...reasons, ...(approvalRequired ? ['APPROVAL_REQUIRED'] : [])] },
  })
  const reasonCodes = decision.matchedRules.filter((id) => id !== 'PAYMENT_ALLOWED')
  return {
    outcome: decision.effect === 'DENY' ? 'deny' : decision.effect === 'PENDING_APPROVAL' ? 'approval_required' : 'allow',
    reasonCodes: reasonCodes.length ? reasonCodes : decision.effect === 'ALLOW' ? [] : decision.reasons.map((reason) => reason.code),
  }
}
