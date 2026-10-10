import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createWardenPayMcpServer } from '../src/mcp-server.ts'

test('MCP exposes only the demo payment tools and delegates valid service requests', async (t) => {
  const pending = { runId: '9e54e8d2-cabf-4d5f-a4d0-c252e0c8f4ca', status: 'approval_required' }
  const requested = []
  const server = createWardenPayMcpServer({
    start: async (service) => { requested.push(service); return pending },
    get: (runId) => runId === pending.runId ? pending : undefined,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'warden-pay-test', version: '1.0.0' })
  t.after(async () => { await client.close(); await server.close() })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(({ name }) => name).sort(), [
    'get_payment_status', 'list_paid_services', 'request_paid_service',
  ])
  const services = await client.callTool({ name: 'list_paid_services', arguments: {} })
  assert.match(services.content[0].text, /gpu-minute.*32/s)
  const result = await client.callTool({ name: 'request_paid_service', arguments: { service: 'gpu-minute' } })
  assert.deepEqual(requested, ['gpu-minute'])
  assert.match(result.content[0].text, /approval_required/)

  const status = await client.callTool({ name: 'get_payment_status', arguments: { runId: pending.runId } })
  assert.match(status.content[0].text, new RegExp(pending.runId))

  const invalid = await client.callTool({ name: 'request_paid_service', arguments: { service: '../../.env' } })
  assert.equal(invalid.isError, true)
  assert.deepEqual(requested, ['gpu-minute'])
})
