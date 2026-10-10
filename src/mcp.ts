#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createWardenPayMcpServer } from './mcp-server.js'
import { createPaymentRuns } from './mcp-runs.js'

const server = createWardenPayMcpServer(createPaymentRuns())
await server.connect(new StdioServerTransport())
