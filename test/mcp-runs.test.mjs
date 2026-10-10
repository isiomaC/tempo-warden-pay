import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createPaymentRuns } from '../src/mcp-runs.ts'

function childProcess() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
}

test('payment run returns pending promptly and reports settlement after approval', async () => {
  const child = childProcess()
  const runs = createPaymentRuns((service) => {
    assert.equal(service, 'gpu-minute')
    return child
  })
  const pendingRequest = runs.start('gpu-minute')
  child.stdout.write('Approval required. Open http://127.0.0.1:8788\n')
  const pending = await pendingRequest
  assert.equal(pending.status, 'approval_required')

  child.stdout.write('Audit verified: true\nRetain this signed audit bundle outside Postgres: {"entries":[{"event":{"payload":{"transactionHash":"0x' + '12'.repeat(32) + '"}}}]}\n')
  child.emit('close', 0)
  assert.deepEqual(runs.get(pending.runId), {
    runId: pending.runId,
    service: 'gpu-minute',
    status: 'settled',
    transactionHash: '0x' + '12'.repeat(32),
    auditVerified: true,
  })
})

test('payment run reports a human or policy denial without a transaction', async () => {
  const child = childProcess()
  const runs = createPaymentRuns(() => child)
  const request = runs.start('large-transfer')
  child.stderr.write('Error: Payment deny: PURPOSE_NOT_ALLOWED\n')
  child.emit('close', 1)
  const denied = await request
  assert.equal(denied.status, 'denied')
  assert.equal(denied.reason, 'PURPOSE_NOT_ALLOWED')
  assert.equal(denied.transactionHash, undefined)
})
