import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import pg from 'pg'
import { privateKeyToAccount } from 'viem/accounts'
import { exportAuditBundle, verifyAuditBundle } from './audit.js'
import { resolveAndReserve } from './storage.js'
import type { PaymentIntent, PaymentPolicy } from './policy.js'

const databaseUrl = process.env.DATABASE_URL
const approvalToken = process.env.APPROVAL_TOKEN
const wardenKey = process.env.WARDEN_AUTH_PRIVATE_KEY as `0x${string}` | undefined
if (!databaseUrl || !approvalToken || !wardenKey) throw new Error('Set DATABASE_URL, APPROVAL_TOKEN, and WARDEN_AUTH_PRIVATE_KEY')

const pool = new pg.Pool({ connectionString: databaseUrl })
const app = new Hono()

app.get('/v1/approvals', async (c) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.request, p.id AS intent_id, p.outcome
     FROM approvals a JOIN payment_intents p ON p.id = a.intent_id
     WHERE a.status = 'PENDING' ORDER BY a.created_at`,
  )
  return c.json(rows)
})

app.get('/v1/activity', async (c) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.agent_id, p.merchant_realm, p.recipient, p.intent, p.outcome, p.status, p.reason_codes, p.created_at, s.tx_hash
     FROM payment_intents p LEFT JOIN settlements s ON s.intent_id = p.id ORDER BY p.created_at DESC LIMIT 50`,
  )
  return c.json(rows)
})

app.get('/v1/policy', async (c) => {
  const { rows } = await pool.query('SELECT id, version, definition FROM policies ORDER BY id, version DESC')
  return c.json(rows)
})

app.get('/v1/audit/:intentId', async (c) => c.json(await exportAuditBundle(pool, c.req.param('intentId'))))
app.get('/v1/audit/:intentId/verify', async (c) => {
  const bundle = await exportAuditBundle(pool, c.req.param('intentId'))
  const trustedSigner = privateKeyToAccount(wardenKey).address
  return c.json(await verifyAuditBundle(bundle, trustedSigner))
})

app.post('/v1/approvals/:id/resolve', async (c) => {
  if (c.req.header('authorization') !== `Bearer ${approvalToken}`) return c.json({ error: 'unauthorized' }, 401)
  let body: { approved?: boolean }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  if (typeof body.approved !== 'boolean') return c.json({ error: 'approved must be a boolean' }, 400)
  const { rows: [row] } = await pool.query(
    `SELECT a.intent_id, a.request, p.policy_id, p.policy_version, p.created_at
     FROM approvals a JOIN payment_intents p ON p.id = a.intent_id WHERE a.id = $1`, [c.req.param('id')],
  )
  if (!row) return c.json({ error: 'approval not found' }, 404)
  const { rows: [policyRow] } = await pool.query(
    'SELECT definition FROM policies WHERE id = $1 AND version = $2', [row.policy_id, row.policy_version],
  )
  const request = row.request
  const intent = request.resource as PaymentIntent
  const { rows: [agent] } = await pool.query('SELECT wallet_address FROM agents WHERE id = $1', [intent.agentId])
  if (!policyRow || !agent) return c.json({ error: 'policy or agent registry entry missing' }, 409)
  const now = new Date().toISOString()
  let result
  try {
    result = await resolveAndReserve(pool, {
      intentId: row.intent_id,
      policy: policyRow.definition as PaymentPolicy,
      intent,
      agentWalletAddress: agent.wallet_address,
      budgetPeriod: new Date(row.created_at).toISOString().slice(0, 10),
      approverId: 'local-operator',
      approved: body.approved,
      now,
      auditPrivateKey: wardenKey,
    })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'approval failed' }, 409)
  }
  return c.json(result)
})

app.get('/', (c) => c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#080d18"><title>Warden Pay · Control room</title>
<style>
:root{color-scheme:dark;--page:#080d18;--surface:#101827;--surface-raised:#162236;--line:#2a3a52;--text:#f1f5fc;--muted:#b4c1d3;--accent:#5edcf6;--accent-ink:#06121b;--success:#78e0f0;--pending:#ffc66d;--danger:#ff9498;--focus:#b4f1ff;--radius:14px}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--text);font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,a,summary{font:inherit}a{color:var(--accent);text-underline-offset:3px}a:hover{color:#a1f0ff}button{min-height:44px;border:1px solid transparent;border-radius:9px;padding:9px 15px;background:var(--accent);color:var(--accent-ink);font-weight:700;cursor:pointer;transition:background-color .16s ease,border-color .16s ease,color .16s ease}button:hover{background:#8ceafa}button:active{background:#42c4e0}button:disabled{opacity:.55;cursor:wait}button.secondary{background:transparent;border-color:var(--line);color:var(--text)}button.secondary:hover{background:var(--surface-raised);border-color:#52728c}button.deny{background:transparent;border-color:#7b4b46;color:var(--danger)}button.deny:hover{background:#352127;border-color:var(--danger)}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}main{width:min(1120px,100%);margin:auto;padding:36px 28px 64px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:24px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:13px}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border:1px solid #315265;border-radius:12px;background:#122432;color:var(--accent);font-weight:800;font-size:18px}.brand-name{margin:0;font-size:15px;letter-spacing:.02em}.brand-caption{margin:1px 0 0;color:var(--muted);font-size:13px}.topbar-right{display:flex;align-items:center;gap:12px}.network{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px;letter-spacing:.04em;text-transform:uppercase}.network::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 0 3px #5edcf622}.intro{padding:34px 0 26px}.eyebrow{margin:0 0 7px;color:var(--accent);font-size:12px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}.intro h1{margin:0;font-size:clamp(28px,4vw,38px);line-height:1.12;letter-spacing:-.035em}.intro-copy{max-width:640px;margin:10px 0 0;color:var(--muted)}.panel{margin-top:18px;padding:22px 24px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:14px}.section-head h2{margin:0;font-size:18px;letter-spacing:-.015em}.section-description{margin:4px 0 0;color:var(--muted);font-size:14px}.count{flex:none;padding:5px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px;font-weight:650}.count.has-items{border-color:#785f30;background:#332a1d;color:var(--pending)}.approval-list,.activity-list{display:grid;gap:10px}.approval-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px;border:1px solid var(--line);border-radius:11px;background:var(--surface-raised)}.approval-main{min-width:0}.amount-line{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px}.amount{font-size:21px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.025em}.asset{color:var(--muted);font-size:13px}.purpose{margin:4px 0 0;color:var(--text)}.meta{margin:3px 0 0;color:var(--muted);font-size:13px;overflow-wrap:anywhere}.approval-actions{display:flex;flex:none;gap:8px}.action-message{margin:8px 0 0;color:var(--danger);font-size:13px}.activity-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;padding:14px 2px;border-top:1px solid var(--line)}.activity-row:first-child{border-top:0}.activity-main{min-width:0}.activity-route{margin:2px 0 0;color:var(--muted);font-size:13px;overflow-wrap:anywhere}.activity-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin-top:7px;color:var(--muted);font-size:12px}.status{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--line);border-radius:999px;font-size:11px;font-weight:750;letter-spacing:.045em;text-transform:uppercase}.status::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.is-allowed,.is-settled{color:var(--success);border-color:#2c6975;background:#102a35}.is-pending{color:var(--pending);border-color:#785f30;background:#332a1d}.is-denied,.is-failed{color:var(--danger);border-color:#744451;background:#352127}.activity-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;font-size:13px}.state{padding:18px;border:1px dashed var(--line);border-radius:10px;color:var(--muted)}.state strong{display:block;color:var(--text);font-size:14px}.state p{margin:4px 0 0}.state-error{border-color:#744451;background:#2b1c25;color:#ffd0d2}.state-error strong{color:var(--danger)}.policy-panel{padding:0;overflow:hidden}.policy-panel details{padding:0}.policy-panel summary{display:flex;align-items:center;justify-content:space-between;min-height:64px;padding:17px 24px;cursor:pointer;list-style:none;font-weight:700}.policy-panel summary::-webkit-details-marker{display:none}.policy-panel summary::after{content:"+";color:var(--accent);font-size:22px;font-weight:400}.policy-panel details[open] summary::after{content:"−"}.policy-panel pre{margin:0;padding:0 24px 22px;color:#d8e3f1;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.footer-note{margin:18px 2px 0;color:var(--muted);font-size:12px}
@media(max-width:700px){main{width:100%;min-width:0;padding:22px 18px 42px}.topbar{align-items:flex-start;flex-wrap:wrap}.topbar-right{flex-basis:100%;width:100%;flex-direction:row;align-items:center;justify-content:space-between;gap:8px}.intro{padding:28px 0 18px}.intro-copy,.state p,.activity-route,.activity-meta>*{overflow-wrap:anywhere}.panel,.approval-list,.activity-list,.activity-row{min-width:0}.panel{padding:18px;margin-top:14px}.policy-panel{padding:0}.policy-panel summary{padding:16px 18px}.policy-panel pre{padding:0 18px 18px}.activity-row{grid-template-columns:1fr;gap:10px}.activity-meta span:first-child{flex:1 1 100%;min-width:0;overflow-wrap:anywhere}.activity-actions{justify-content:flex-start}.activity-actions a{display:inline-flex;align-items:center;min-height:44px;padding:4px}.approval-row{align-items:flex-start;flex-direction:column}.approval-actions{width:100%}.approval-actions button{flex:1}}
@media(max-width:380px){main{padding-right:14px;padding-left:14px}.topbar{flex-wrap:wrap}.topbar-right{flex-basis:100%;flex-direction:row;align-items:center;justify-content:space-between;width:100%}.brand-caption{max-width:180px}.topbar-right .network{font-size:10px}.section-head{align-items:flex-start;flex-direction:column;gap:8px}.approval-actions{flex-direction:column}.approval-actions button{width:100%}.activity-meta span:first-child{flex:1 1 100%;min-width:0;overflow-wrap:anywhere}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important}}
.intro{position:relative;margin:28px 0 8px;padding:20px 0 22px 18px;border-left:2px solid var(--accent);background:linear-gradient(90deg,#122538aa,transparent 72%)}.intro h1{font-size:clamp(30px,4vw,44px)}.intro-copy{font-size:16px}.console-grid{display:grid;grid-template-columns:minmax(340px,.75fr) minmax(0,1.25fr);align-items:start;gap:18px;margin-top:18px}.console-grid>.panel{margin:0}.approval-panel{border-color:#315265;background:linear-gradient(145deg,#122235,var(--surface) 70%);box-shadow:inset 0 1px #5edcf622,0 12px 30px #0003}.approval-row{border-left:3px solid var(--pending)}.activity-row{padding:16px;border:1px solid var(--line);border-inline-start:3px solid #36536f;border-radius:10px;background:linear-gradient(115deg,#132035,var(--surface) 74%)}.activity-row.is-settled-row,.activity-row.is-allowed-row{border-inline-start-color:var(--success)}.activity-row.is-denied-row,.activity-row.is-failed-row{border-inline-start-color:var(--danger)}.activity-row.is-pending-row{border-inline-start-color:var(--pending)}.activity-row:first-child{border-top:1px solid var(--line)}.activity-actions a{display:inline-flex;align-items:center;min-height:44px;padding:4px 9px;border:1px solid var(--line);border-radius:7px;text-decoration:none}.activity-actions a:hover{border-color:var(--accent);background:#5edcf60d}.activity-row{grid-template-columns:minmax(0,1fr)}.activity-actions{justify-content:flex-start}.policy-panel{box-shadow:none}@media(max-width:900px){.console-grid{grid-template-columns:minmax(0,1fr);gap:14px}}
</style></head><body><main>
<header class="topbar"><div class="brand"><div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 19 6v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg></div><div><p class="brand-name">Warden Pay</p><p class="brand-caption">Agent payment authorization</p></div></div><div class="topbar-right"><span class="network">Tempo · Moderato</span><button id="refresh" class="secondary" type="button">Refresh</button></div></header>
<section class="intro" aria-labelledby="page-title"><p class="eyebrow">Agent payment authorization</p><h1 id="page-title">Authorize agent payments</h1><p class="intro-copy">Review policy checks, approve agent spend, and inspect settlement evidence.</p></section>
<div class="console-grid"><section class="panel approval-panel" aria-labelledby="approvals-title"><div class="section-head"><div><h2 id="approvals-title">Pending approvals</h2><p class="section-description">Requests waiting for an operator decision.</p></div><span id="approval-count" class="count">Loading</span></div><div id="approvals" class="approval-list" aria-live="polite" aria-busy="true"><div class="state">Loading approval requests…</div></div></section>
<section class="panel" aria-labelledby="activity-title"><div class="section-head"><div><h2 id="activity-title">Recent activity</h2><p class="section-description">Decisions and payment receipts, newest first.</p></div></div><div id="activity" class="activity-list" aria-live="polite" aria-busy="true"><div class="state">Loading payment activity…</div></div></section>
</div><section class="panel policy-panel"><details><summary>Policy definition <span class="asset">Current rules</span></summary><pre id="policy" aria-live="polite">Loading policy…</pre></details></section>
<p class="footer-note">Approval actions are signed and added to the intent’s audit trail.</p>
<script>
const pathUsd='0x20c0000000000000000000000000000000000000';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const approvals=document.querySelector('#approvals');
const activity=document.querySelector('#activity');
const policy=document.querySelector('#policy');
const approvalCount=document.querySelector('#approval-count');
const refresh=document.querySelector('#refresh');
let loading=false;
const assetName=value=>String(value).toLowerCase()===pathUsd?'pathUSD':String(value);
const stateClass=value=>({allow:'is-allowed',settled:'is-settled',approval_required:'is-pending',pending:'is-pending',deny:'is-denied',denied:'is-denied',failed:'is-failed'})[String(value).toLowerCase()]||'';
function renderApprovals(rows){
 approvalCount.textContent=rows.length+' pending';
 approvalCount.classList.toggle('has-items',rows.length>0);
 if(!rows.length){approvals.innerHTML='<div class="state"><strong>All caught up</strong><p>No payment requests need approval right now.</p></div>';return}
 approvals.innerHTML=rows.map(x=>{const i=x.request.resource;return '<article class="approval-row" data-approval-row><div class="approval-main"><div class="amount-line"><strong class="amount">'+esc(i.amount)+'</strong><span class="asset">'+esc(assetName(i.asset))+'</span><span class="status is-pending">Approval required</span></div><p class="purpose">'+esc(i.purpose)+'</p><p class="meta">'+esc(i.merchant.realm)+' · intent '+esc(x.intent_id)+'</p><p class="action-message" role="status" hidden></p></div><div class="approval-actions"><button type="button" data-approval-id="'+esc(x.id)+'" data-approved="true">Approve</button><button type="button" class="deny" data-approval-id="'+esc(x.id)+'" data-approved="false">Deny</button></div></article>'}).join('');
}
function renderActivity(rows){
 if(!rows.length){activity.innerHTML='<div class="state"><strong>No payment activity yet</strong><p>Authorized, denied, and settled requests will appear here.</p></div>';return}
 activity.innerHTML=rows.map(x=>{const reason=(x.reason_codes||[]).join(', ');const tx=x.tx_hash?'<a href="https://explore.tempo.xyz/tx/'+encodeURIComponent(x.tx_hash)+'" target="_blank" rel="noopener noreferrer">Tempo transaction</a>':'';return '<article class="activity-row ' + stateClass(x.status) + '-row"><div class="activity-main"><div class="amount-line"><strong class="amount">'+esc(x.intent.amount)+'</strong><span class="asset">'+esc(assetName(x.intent.asset))+'</span><span class="status '+stateClass(x.status)+'">'+esc(x.status)+'</span></div><p class="activity-route">'+esc(x.agent_id)+' → '+esc(x.merchant_realm)+'</p><div class="activity-meta"><span>'+esc(reason||x.outcome)+'</span><time datetime="'+esc(x.created_at)+'">'+esc(new Date(x.created_at).toLocaleString())+'</time><span>Intent '+esc(x.id)+'</span></div></div><div class="activity-actions"><a href="/v1/audit/'+encodeURIComponent(x.id)+'" target="_blank" rel="noopener noreferrer">Audit bundle</a><a href="/v1/audit/'+encodeURIComponent(x.id)+'/verify" target="_blank" rel="noopener noreferrer">Verify audit</a>'+tx+'</div></article>'}).join('');
}
function showLoadError(){
 const message='<div class="state state-error" role="alert"><strong>Dashboard data could not be loaded</strong><p>Check that the API and database are running, then refresh.</p></div>';
 approvals.innerHTML=message;activity.innerHTML=message;approvalCount.textContent='Unavailable';approvalCount.classList.remove('has-items');policy.textContent='Policy unavailable. Refresh to try again.';
 approvals.setAttribute('aria-busy','false');activity.setAttribute('aria-busy','false');
}
async function load(){
 if(loading)return;
 loading=true;refresh.disabled=true;refresh.textContent='Refreshing…';
 try{
  const responses=await Promise.all(['/v1/approvals','/v1/activity','/v1/policy'].map(path=>fetch(path)));
  if(responses.some(response=>!response.ok))throw new Error('Dashboard request failed');
  const [a,p,rules]=await Promise.all(responses.map(response=>response.json()));
  renderApprovals(a);renderActivity(p);policy.textContent=JSON.stringify(rules.map(x=>({id:x.id,version:x.version,...x.definition})),null,2);
  approvals.setAttribute('aria-busy','false');activity.setAttribute('aria-busy','false');
 }catch{showLoadError()}
 finally{loading=false;refresh.disabled=false;refresh.textContent='Refresh'}
}
async function resolve(button){
 const row=button.closest('[data-approval-row]');const message=row.querySelector('.action-message');
 let token=sessionStorage.getItem('approval-token');
 if(!token){token=prompt('Local approval token from .env');if(!token)return;sessionStorage.setItem('approval-token',token)}
 row.querySelectorAll('button').forEach(control=>control.disabled=true);row.setAttribute('aria-busy','true');message.hidden=true;
 try{
  const response=await fetch('/v1/approvals/'+encodeURIComponent(button.dataset.approvalId)+'/resolve',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({approved:button.dataset.approved==='true'})});
  if(response.status===401)sessionStorage.removeItem('approval-token');
  if(!response.ok)throw new Error('Approval could not be saved. Check the request and try again.');
  await load();
 }catch(error){message.textContent=error instanceof Error?error.message:'Approval could not be saved.';message.hidden=false}
 finally{row.querySelectorAll('button').forEach(control=>control.disabled=false);row.removeAttribute('aria-busy')}
}
document.querySelector('#refresh').addEventListener('click',load);
approvals.addEventListener('click',event=>{const button=event.target.closest('button[data-approval-id]');if(button)resolve(button)});
load();setInterval(load,5000);
</script></main></body></html>`))

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.API_PORT ?? 8788) })
