// A payout exactly as the keeper builds it (transfers + Memo, escrow pays the fee), simulated on mainnet from a funded
// address (signature checks off, nothing is sent). node tools/sim_payout.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), W = require('../relay/node_modules/@solana/web3.js')
const c = new W.Connection('https://api.mainnet-beta.solana.com', 'confirmed')
const from = new W.PublicKey('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'), to = [W.Keypair.generate(), W.Keypair.generate()].map((k) => k.publicKey)
const tx = new W.Transaction().add(W.SystemProgram.transfer({ fromPubkey: from, toPubkey: to[0], lamports: 0.06e9 }), W.SystemProgram.transfer({ fromPubkey: from, toPubkey: to[1], lamports: 0.003e9 }),
  new W.TransactionInstruction({ programId: new W.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from('CreatorPay 12c46268 | 2000000002:6000') }))
tx.feePayer = from; tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash
const m = new W.VersionedTransaction(tx.compileMessage())
const sim = await c.simulateTransaction(m, { sigVerify: false, replaceRecentBlockhash: true })
console.log('err', JSON.stringify(sim.value.err), '| logs:', (sim.value.logs || []).filter((l) => /Memo|success|failed/i.test(l)).join(' / '))
