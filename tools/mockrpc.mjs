// A tiny stand-in for a Solana RPC node, for tests: it really checks every signature over the message, charges the
// 5,000-lamport fee per signature, applies System transfers, refuses overdrafts and accounts left under the rent
// minimum (like the real chain), and records Memo text. Enough for the keeper's whole flow, with no real money.
// node tools/mockrpc.mjs [port]  (GET /fund?addr=&lamports=  and  GET /tx/<sig> are test helpers)
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const nacl = require('../relay/node_modules/tweetnacl'), bs58 = require('../relay/node_modules/bs58').default
const SYSTEM = '11111111111111111111111111111111', MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', RENT = 890_880
export function startMock(port = 8898) {
  const bal = new Map(), txs = new Map(); let height = 1000
  const get = (k) => bal.get(k) || 0
  function exec(raw) {
    let o = 0; const cu = () => { let v = 0, s = 0, b; do { b = raw[o++]; v |= (b & 0x7f) << s; s += 7 } while (b & 0x80); return v }
    const nSig = cu(), sigs = []; for (let i = 0; i < nSig; i++) { sigs.push(raw.subarray(o, o + 64)); o += 64 }
    const msg = raw.subarray(o); if (msg[0] & 0x80) throw new Error('only legacy transactions in this mock')
    const nReq = raw[o]; o += 3; const nKeys = cu(), keys = []
    for (let i = 0; i < nKeys; i++) { keys.push(bs58.encode(raw.subarray(o, o + 32))); o += 32 }
    o += 32; const nIx = cu(), ixs = []
    for (let i = 0; i < nIx; i++) { const p = raw[o++], na = cu(), acc = [...raw.subarray(o, o + na)]; o += na; const dl = cu(); ixs.push({ program: keys[p], acc: acc.map((a) => keys[a]), data: raw.subarray(o, o + dl) }); o += dl }
    for (let i = 0; i < nReq; i++) if (!nacl.sign.detached.verify(msg, sigs[i], bs58.decode(keys[i]))) throw new Error('signature verification failed')
    const sig = bs58.encode(sigs[0]); if (txs.has(sig)) throw new Error('already processed')
    const next = new Map(bal), g = (k) => next.get(k) || 0, signers = new Set(keys.slice(0, nReq)), memos = []
    if (g(keys[0]) < 5000 * nSig) throw new Error('insufficient funds for fee')
    next.set(keys[0], g(keys[0]) - 5000 * nSig)
    for (const ix of ixs) {
      if (ix.program === SYSTEM) {
        const d = Buffer.from(ix.data); if (d.readUInt32LE(0) !== 2) throw new Error('only transfers in this mock')
        const lam = Number(d.readBigUInt64LE(4)), [from, to] = ix.acc
        if (!signers.has(from)) throw new Error('missing signature for ' + from)
        if (g(from) < lam) throw new Error('custom program error: 0x1 (insufficient lamports)')
        next.set(from, g(from) - lam); next.set(to, g(to) + lam)
      } else if (ix.program === MEMO) memos.push(Buffer.from(ix.data).toString('utf8'))
      else throw new Error('unknown program ' + ix.program)
    }
    for (const [k, v] of next) if (v > 0 && v < RENT && v !== (bal.get(k) || 0)) throw new Error(`InsufficientFundsForRent { account_index } (${k} would hold ${v})`)
    for (const [k, v] of next) bal.set(k, v)
    txs.set(sig, { slot: ++height, memos, keys, ixs: ixs.length }); return sig
  }
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/fund') { bal.set(u.searchParams.get('addr'), get(u.searchParams.get('addr')) + +u.searchParams.get('lamports')); res.end('ok'); return }
    if (u.pathname.startsWith('/tx/')) { res.end(JSON.stringify(txs.get(u.pathname.slice(4)) || null)); return }
    const ch = []; for await (const x of req) ch.push(x); const body = JSON.parse(Buffer.concat(ch).toString() || '{}')
    const one = (r) => {
      const ok = (result) => ({ jsonrpc: '2.0', id: r.id, result }), ctx = { slot: height, apiVersion: 'mock' }
      try {
        switch (r.method) {
          case 'getBalance': return ok({ context: ctx, value: get(r.params[0]) })
          case 'getLatestBlockhash': return ok({ context: ctx, value: { blockhash: bs58.encode(nacl.randomBytes(32)), lastValidBlockHeight: height + 150 } })
          case 'getBlockHeight': return ok(height)
          case 'sendTransaction': return ok(exec(Buffer.from(r.params[0], r.params[1]?.encoding === 'base64' ? 'base64' : undefined)))
          case 'getSignatureStatuses': return ok({ context: ctx, value: r.params[0].map((s) => (txs.has(s) ? { slot: txs.get(s).slot, confirmations: null, err: null, confirmationStatus: 'confirmed' } : null)) })
          default: return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'mock: no ' + r.method } }
        }
      } catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32002, message: 'Transaction simulation failed: ' + e.message } } }
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)))
  }).listen(port)
  return { server, bal, txs }
}
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) { startMock(+(process.argv[2] || 8898)); console.log('mock rpc on', process.argv[2] || 8898) }
