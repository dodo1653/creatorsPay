// End to end against tools/mockrpc.mjs (a local Solana stand-in that checks signatures and applies transfers; no real
// money, devnet's faucet is closed): open a campaign with a signed message, fund its escrow,
// link an X account by a post, submit a clip, let the oracle see its views grow, settle, check the clipper and the
// protocol wallet were paid with a memo, catch a held clip, close the campaign and check the refund.
// X posts come from a mock file here (the real oracle reads api.fxtwitter.com). node tools/e2e.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { startMock } from './mockrpc.mjs'
const require = createRequire(import.meta.url)
const { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL: SOL } = require('../relay/node_modules/@solana/web3.js')
const nacl = require('../relay/node_modules/tweetnacl'), bs58 = require('../relay/node_modules/bs58').default
const mockChain = startMock(8898), RPC = 'http://127.0.0.1:8898', conn = new Connection(RPC, 'confirmed'), PORT = 8899, B = `http://127.0.0.1:${PORT}`
let ok = 0, bad = 0; const check = (c, m) => { c ? ok++ : bad++; console.log(c ? 'pass' : 'FAIL', m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-')), mockFile = path.join(dir, 'x.json')
const owner = Keypair.generate(), clipper = Keypair.generate(), now = Date.now()
const LINK = 'https://pump.fun/join/creatorpaytest'
const mock = {
  '1000000001': { handle: 'clipperone', text: `my CreatorPay wallet ${clipper.publicKey.toBase58()}`, joined: now - 400 * 86400_000, postedAt: now + 1000 },
  '2000000002': { handle: 'clipperone', text: `how to get on pump.fun in 60s ${LINK}`, links: [LINK], videoSecs: 24, joined: now - 400 * 86400_000, postedAt: now + 2000, views: 1000, likes: 30 },
  '3000000003': { handle: 'clipperone', text: `no link here`, videoSecs: 30, joined: now - 400 * 86400_000, postedAt: now + 3000, views: 10 },
  '4000000004': { handle: 'clipperone', text: `botted ${LINK}`, links: [LINK], videoSecs: 15, joined: now - 400 * 86400_000, postedAt: now + 4000, views: 50000, likes: 1 },
}
fs.writeFileSync(mockFile, JSON.stringify(mock))
const srv = spawn(process.execPath, ['server.mjs'], { cwd: path.resolve('../relay'), env: { ...process.env, RPC, DATA: dir, PORT: String(PORT), X_MOCK: mockFile, CHECK_MS: '500', SETTLE_MS: '1000', ADMIN_TOKEN: 't' }, stdio: ['ignore', 'pipe', 'pipe'] })
srv.stdout.on('data', (d) => process.stdout.write('  [keeper] ' + d)); srv.stderr.on('data', (d) => process.stdout.write('  [keeper!] ' + d))
const get = async (p) => (await fetch(B + p)).json(), post = async (p, b) => (await fetch(B + p, { method: 'POST', body: JSON.stringify(b) })).json()
try {
  await sleep(1500)
  await fetch(`${RPC}/fund?addr=${owner.publicKey.toBase58()}&lamports=${1 * SOL}`)                     // the owner starts with 1 SOL
  // open with a signature
  const c0 = { title: 'Get your friends on pump.fun', link: LINK, rate: 0.01, days: 7, owner: owner.publicKey.toBase58(), nonce: Date.now() }
  const { msg } = await get(`/v1/campaignmsg?${new URLSearchParams(c0)}`)
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), owner.secretKey))
  check((await post('/v1/open', { ...c0, sig: bs58.encode(new Uint8Array(64)) })).error, 'a bad signature is refused')
  const c = await post('/v1/open', { ...c0, sig }); check(c.id && c.escrow && c.status === 'funding', `campaign ${c.id} opened, escrow ${c.escrow}`)
  check((await post('/v1/open', { ...c0, link: 'https://evil.com/x', sig })).error, 'a non pump.fun link is refused')
  // fund 0.3 SOL
  const ftx = new Transaction().add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: new (require('../relay/node_modules/@solana/web3.js').PublicKey)(c.escrow), lamports: 0.3 * SOL }))
  await conn.sendTransaction(ftx, [owner])
  let live = null; for (let i = 0; i < 20 && live?.status !== 'live'; i++) { await sleep(2000); live = await get('/v1/campaign?id=' + c.id) }
  check(live.status === 'live' && Math.abs(live.balance - 0.3) < 1e-6, 'escrow funding seen, campaign live')
  // clips
  { const r0 = await post('/v1/clip', { campaign: c.id, url: 'https://x.com/clipperone/status/2000000002' }); console.log('  unlinked:', JSON.stringify(r0)); check(/linked/.test(r0.error || ''), 'a clip from an unlinked account is refused') }
  const bnd = await post('/v1/bind', { url: 'https://x.com/clipperone/status/1000000001', wallet: clipper.publicKey.toBase58() }); console.log('  bind:', JSON.stringify(bnd)); check(bnd.wallet === clipper.publicKey.toBase58(), 'X account linked by a post with the wallet')
  check(/link/.test((await post('/v1/clip', { campaign: c.id, url: 'https://x.com/clipperone/status/3000000003' })).error || ''), 'a clip without the campaign link is refused')
  const k = await post('/v1/clip', { campaign: c.id, url: 'https://x.com/clipperone/status/2000000002' }); check(k.status === 'ok', 'clip accepted')
  check((await post('/v1/clip', { campaign: c.id, url: 'https://x.com/clipperone/status/2000000002' })).error, 'the same clip twice is refused')
  await post('/v1/clip', { campaign: c.id, url: 'https://x.com/clipperone/status/4000000004' })
  // views grow; oracle picks it up
  mock['2000000002'].views = 6000; mock['2000000002'].likes = 90; fs.writeFileSync(mockFile, JSON.stringify(mock))
  let st; for (let i = 0; i < 40; i++) { await sleep(2000); st = await get('/v1/campaign?id=' + c.id); if (st.clipList.find((x) => x.id === '2000000002')?.views === 6000) break }
  check(st.clipList.find((x) => x.id === '2000000002').views === 6000, 'oracle read the new view count')
  await post('/v1/admin', { token: 't', do: 'settle' })
  st = await get('/v1/campaign?id=' + c.id)
  const paidClip = st.clipList.find((x) => x.id === '2000000002'), held = st.clipList.find((x) => x.id === '4000000004')
  check(Math.abs(paidClip.paid - 0.06) < 1e-9 && paidClip.paidViews === 6000, `clip paid ${paidClip.paid} SOL for 6,000 views at 0.01 / 1K`)
  check(held.status === 'held' && held.paid === 0, `50,000 views with 1 like is held: ${held.reason}`)
  const bal = await conn.getBalance(clipper.publicKey, 'confirmed'); check(bal === 0.06 * SOL, `clipper wallet received ${bal / SOL} SOL on chain`)
  const pay = st.payouts[0], memo = mockChain.txs.get(pay.sig)?.memos[0]
  check(/CreatorPay .* 2000000002:6000/.test(memo || ''), `payout memo on chain: "${memo}"`)
  const state = await get('/v1/state'); check(Math.abs(state.totals.protocol - 0.003) < 1e-9 && (await conn.getBalance(new (require('../relay/node_modules/@solana/web3.js').PublicKey)(state.protocol))) === 0.003 * SOL, 'protocol wallet got 5 % (0.003 SOL)')
  // settle again: nothing new owed
  await post('/v1/admin', { token: 't', do: 'settle' }); st = await get('/v1/campaign?id=' + c.id)
  check(st.clipList.find((x) => x.id === '2000000002').paid === 0.06, 'no double payment on the next settlement')
  // close and refund
  const { msg: cm } = await get('/v1/closemsg?id=' + c.id)
  await post('/v1/close', { id: c.id, sig: bs58.encode(nacl.sign.detached(new TextEncoder().encode(cm), owner.secretKey)) })
  await post('/v1/admin', { token: 't', do: 'settle' }); st = await get('/v1/campaign?id=' + c.id)
  const ownerBal = await conn.getBalance(owner.publicKey, 'confirmed')
  check(st.status === 'closed' && (await conn.getBalance(new (require('../relay/node_modules/@solana/web3.js').PublicKey)(c.escrow))) === 0, `closed, escrow emptied, refund ${st.refunded.toFixed(6)} SOL to the owner (owner now ${(ownerBal / SOL).toFixed(4)})`)
  check(Math.abs(st.funded - 0.3) < 1e-6, `books balance: paid ${st.paid} + protocol ${st.protocol} + refund ${st.refunded.toFixed(6)} + network fees = funded ${st.funded}`)
} catch (e) { bad++; console.log('FAIL', e.message) }
srv.kill(); mockChain.server.close(); console.log(`${ok} pass, ${bad} fail`); process.exit(bad ? 1 : 0)
