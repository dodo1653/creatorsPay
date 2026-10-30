// CreatorPay wallet glue: connect a Solana wallet, sign the keeper's plain-text messages, and send a campaign's
// deposit (one System transfer to its escrow) for the wallet to approve. Bundled to assets/app.js; exposes window.CPW.
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import bs58 from 'bs58'

const RPC = 'https://solana-rpc.publicnode.com'
let provider = null, address = null
const pick = () => window.phantom?.solana || window.solflare || window.backpack || (window.solana?.connect ? window.solana : null)

async function connect() {
  const p = pick(); if (!p) throw new Error('No Solana wallet found. Install Phantom, Solflare or Backpack.')
  const r = await p.connect(); provider = p
  address = (r?.publicKey || p.publicKey).toString()
  p.on?.('accountChanged', (pk) => { address = pk ? pk.toString() : null; window.dispatchEvent(new CustomEvent('cpw', { detail: address })) })
  window.dispatchEvent(new CustomEvent('cpw', { detail: address })); return address
}
async function need() { if (!provider || !address) await connect(); return address }

async function signText(msg) {
  await need()
  const r = await provider.signMessage(new TextEncoder().encode(msg), 'utf8')
  const sig = r?.signature || r; return bs58.encode(sig instanceof Uint8Array ? sig : new Uint8Array(sig))
}

// the deposit: a plain SOL transfer from the connected wallet to the campaign's escrow
async function deposit(escrow, sol) {
  const from = new PublicKey(await need()), lamports = Math.round(+sol * LAMPORTS_PER_SOL)
  if (!(lamports > 0)) throw new Error('enter a deposit in SOL')
  const conn = new Connection(RPC, 'confirmed')
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(escrow), lamports }))
  tx.feePayer = from; tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash
  if (provider.signAndSendTransaction) { const r = await provider.signAndSendTransaction(tx); return r?.signature || r }
  const signed = await provider.signTransaction(tx)
  return conn.sendRawTransaction(signed.serialize())
}

window.CPW = { connect, signText, deposit, get address() { return address } }
