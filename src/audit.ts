import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { AuditChain, createAuditEntry, verifyAuditChain, type AuditEntry, type AuditEvent } from '@stlw/warden'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyTypedData, type Hex } from 'viem'

const domain = { name: 'Warden Pay Audit Checkpoint', version: '1', chainId: 42431 } as const
const types = {
  AuditCheckpoint: [
    { name: 'intentId', type: 'string' },
    { name: 'entryCount', type: 'uint256' },
    { name: 'headHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
  ],
} as const

export type AuditBundle = {
  intentId: string
  entries: AuditEntry[]
  checkpoint: { intentId: string; entryCount: number; headHash: Hex; issuedAt: number; signer: Hex; signature: Hex } | null
}

export async function appendAuditInTransaction(client: PoolClient, intentId: string, event: Omit<AuditEvent, 'eventId' | 'correlationId' | 'resourceId'>, privateKey: Hex) {
  await client.query('SELECT id FROM payment_intents WHERE id = $1 FOR UPDATE', [intentId])
  const { rows } = await client.query('SELECT entry FROM audit_entries WHERE intent_id = $1 ORDER BY entry_index', [intentId])
  const entries = rows.map((row) => row.entry as AuditEntry)
  if (!verifyAuditChain(entries).valid) throw new Error('Cannot append to an invalid audit chain')
  const chain = new AuditChain()
  for (const entry of entries) chain.entries.push(entry)
  const entry = chain.append({ ...event, eventId: randomUUID(), correlationId: intentId, resourceId: intentId })
  const account = privateKeyToAccount(privateKey)
  const issuedAt = Math.floor(Date.now() / 1000)
  const headHash = `0x${entry.hash}` as Hex
  const signature = await account.signTypedData({
    domain, types, primaryType: 'AuditCheckpoint',
    message: { intentId, entryCount: BigInt(entries.length + 1), headHash, issuedAt: BigInt(issuedAt) },
  })
  await client.query('INSERT INTO audit_entries (intent_id, entry_index, entry) VALUES ($1,$2,$3)', [intentId, entries.length, entry])
  await client.query(
    `INSERT INTO audit_checkpoints (intent_id, entry_count, head_hash, signer_address, signature, issued_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [intentId, entries.length + 1, headHash, account.address, signature, issuedAt],
  )
  return { entry, checkpoint: { intentId, entryCount: entries.length + 1, headHash, signer: account.address, signature, issuedAt } }
}

export async function appendAuditEvent(pool: Pool, intentId: string, event: Omit<AuditEvent, 'eventId' | 'correlationId' | 'resourceId'>, privateKey: Hex) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await appendAuditInTransaction(client, intentId, event, privateKey)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function exportAuditBundle(pool: Pool, intentId: string): Promise<AuditBundle> {
  const { rows: entryRows } = await pool.query('SELECT entry FROM audit_entries WHERE intent_id = $1 ORDER BY entry_index', [intentId])
  const entries = entryRows.map((row) => row.entry as AuditEntry)
  const { rows: checkpointRows } = await pool.query(
    `SELECT entry_count, head_hash, signer_address, signature, issued_at
     FROM audit_checkpoints WHERE intent_id = $1 ORDER BY entry_count DESC LIMIT 1`, [intentId],
  )
  const checkpoint = checkpointRows[0]
  return {
    intentId,
    entries,
    checkpoint: checkpoint ? {
      intentId,
      entryCount: Number(checkpoint.entry_count),
      headHash: checkpoint.head_hash as Hex,
      issuedAt: Number(checkpoint.issued_at),
      signer: checkpoint.signer_address as Hex,
      signature: checkpoint.signature as Hex,
    } : null,
  }
}

export async function verifyAuditBundle(bundle: AuditBundle, trustedSigner: Hex) {
  const chain = verifyAuditChain(bundle.entries)
  if (!chain.valid) return { valid: false, reason: 'CHAIN_INVALID', chain }
  const checkpoint = bundle.checkpoint
  if (!checkpoint || checkpoint.intentId !== bundle.intentId || checkpoint.entryCount !== bundle.entries.length ||
      checkpoint.headHash !== `0x${bundle.entries.at(-1)?.hash ?? '0'.repeat(64)}` ||
      checkpoint.signer.toLowerCase() !== trustedSigner.toLowerCase()) {
    return { valid: false, reason: 'CHECKPOINT_MISMATCH', chain }
  }
  try {
    const signatureValid = await verifyTypedData({
      address: trustedSigner, domain, types, primaryType: 'AuditCheckpoint',
      message: {
        intentId: bundle.intentId,
        entryCount: BigInt(checkpoint.entryCount),
        headHash: checkpoint.headHash,
        issuedAt: BigInt(checkpoint.issuedAt),
      },
      signature: checkpoint.signature,
    })
    return { valid: signatureValid, reason: signatureValid ? undefined : 'CHECKPOINT_SIGNATURE_INVALID', chain }
  } catch {
    return { valid: false, reason: 'CHECKPOINT_SIGNATURE_INVALID', chain }
  }
}
