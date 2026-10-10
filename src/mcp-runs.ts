import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PaidService, PaymentRun, PaymentRunManager } from './mcp-server.js'

const sourcePaymentEntry = fileURLToPath(new URL('./pay.ts', import.meta.url))
const sourceMode = existsSync(sourcePaymentEntry)
const paymentEntry = sourceMode ? sourcePaymentEntry : fileURLToPath(new URL('./pay.js', import.meta.url))

export function createPaymentRuns(spawnPayment: (service: PaidService) => ChildProcess = (service) => spawn(process.execPath, [
  '--env-file=.env', ...(sourceMode ? ['--import', 'tsx'] : []), paymentEntry, service,
], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })) : PaymentRunManager {
  const runs = new Map<string, PaymentRun>()

  return {
    start(service) {
      const run: PaymentRun = { runId: randomUUID(), service, status: 'starting' }
      runs.set(run.runId, run)

      return new Promise((resolve) => {
        const child = spawnPayment(service)
        let output = ''
        let errors = ''
        let initialResolved = false
        const resolveInitial = () => {
          if (initialResolved) return
          initialResolved = true
          resolve({ ...run })
        }
        const append = (current: string, chunk: Buffer) => (current + chunk.toString()).slice(-100_000)

        child.stdout?.on('data', (chunk: Buffer) => {
          output = append(output, chunk)
          if (output.includes('Approval required. Open ')) {
            run.status = 'approval_required'
            resolveInitial()
          }
        })
        child.stderr?.on('data', (chunk: Buffer) => { errors = append(errors, chunk) })
        child.once('error', (error) => {
          run.status = 'failed'
          run.reason = error.message
          resolveInitial()
        })
        child.once('close', (code) => {
          const reason = (output + errors).match(/Payment deny: ([^\r\n]+)/)?.[1]
          if (reason) run.reason = reason
          run.transactionHash = output.match(/"transactionHash":"(0x[\da-fA-F]{64})"/)?.[1]
          const audit = output.match(/Audit verified: (true|false)/)?.[1]
          if (audit) run.auditVerified = audit === 'true'
          run.status = reason ? 'denied' : code === 0 && run.transactionHash && run.auditVerified ? 'settled' : 'failed'
          if (!initialResolved) resolveInitial()
        })

        setTimeout(() => {
          if (!initialResolved) resolveInitial()
        }, 30_000).unref()
      })
    },
    get(runId) {
      const run = runs.get(runId)
      return run ? { ...run } : undefined
    },
  }
}
