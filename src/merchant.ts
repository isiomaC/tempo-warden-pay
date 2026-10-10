import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { Mppx } from 'mppx/hono'
import { tempo } from 'mppx/server'

const currency = '0x20c0000000000000000000000000000000000000'
const recipient = process.env.MERCHANT_ADDRESS
const secretKey = process.env.MPP_SECRET_KEY

if (!recipient || !/^0x[\da-fA-F]{40}$/.test(recipient)) {
  throw new Error('Set MERCHANT_ADDRESS to a Tempo address')
}
if (!secretKey) throw new Error('Set MPP_SECRET_KEY')

const mppx = Mppx.create({
  methods: [tempo.charge({ currency, recipient: recipient as `0x${string}`, testnet: true })],
  secretKey,
})
const app = new Hono()

for (const [path, amount, description] of [
  ['browser-session', '3.20', 'Browser session'],
  ['gpu-minute', '32', 'GPU compute minute'],
  ['large-transfer', '420', 'Disallowed large transfer'],
]) {
  app.get(`/${path}`, mppx.charge({ amount, description }), (c) =>
    c.json({ resource: path, sessionId: crypto.randomUUID(), expiresIn: 900 }),
  )
}

app.get('/health', (c) => c.json({ ok: true }))

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 8787) })
