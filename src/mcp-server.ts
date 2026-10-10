import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'

export const paidServices = {
  'browser-session': { amount: '3.20', purpose: 'browser-automation' },
  'gpu-minute': { amount: '32', purpose: 'gpu-compute' },
  'large-transfer': { amount: '420', purpose: 'crypto-transfer' },
} as const

export type PaidService = keyof typeof paidServices
export type PaymentRun = {
  runId: string
  service: PaidService
  status: 'starting' | 'approval_required' | 'settled' | 'denied' | 'failed'
  reason?: string
  transactionHash?: string
  auditVerified?: boolean
}

export type PaymentRunManager = {
  start: (service: PaidService) => Promise<PaymentRun>
  get: (runId: string) => PaymentRun | undefined
}

const response = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

export function createWardenPayMcpServer(runs: PaymentRunManager) {
  const server = new McpServer({ name: 'warden-pay', version: '0.1.0' })

  server.registerTool('list_paid_services', {
    description: 'List the local demo merchant services and their fixed prices. This does not make a payment.',
    inputSchema: {},
  }, async () => response({ asset: 'pathUSD', services: paidServices }))

  server.registerTool('request_paid_service', {
    description: 'Request one listed service through Warden Pay. This may settle a Tempo testnet payment; requests above policy threshold wait for human approval in the Warden dashboard.',
    inputSchema: { service: z.enum(['browser-session', 'gpu-minute', 'large-transfer']) },
  }, async ({ service }) => {
    try {
      const run = await runs.start(service)
      return response({ ...run, ...(run.status === 'approval_required' ? { dashboard: 'http://127.0.0.1:8788' } : {}) })
    } catch (error) {
      return { ...response({ error: error instanceof Error ? error.message : 'Payment request failed' }), isError: true }
    }
  })

  server.registerTool('get_payment_status', {
    description: 'Check whether a Warden Pay request is awaiting approval, settled, denied, or failed.',
    inputSchema: { runId: z.string().uuid() },
  }, async ({ runId }) => {
    const run = runs.get(runId)
    return run ? response(run) : { ...response({ error: 'Payment run not found in this MCP session' }), isError: true }
  })

  return server
}
