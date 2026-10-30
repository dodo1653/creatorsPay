// Solana side of the keeper: one escrow address per campaign (its key kept on this machine, in .data/keys.json),
// balances, signed-message checks, and payouts. Every payout is one transaction from the campaign's escrow with a
// Memo naming the campaign, the clip and the views it pays for, so the whole ledger can be rebuilt from the chain.
import fs from "node:fs"
import path from "node:path"
import nacl from "tweetnacl"
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js"
import bs58 from "bs58"

export const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
export const RPC = process.env.RPC || "https://solana-rpc.publicnode.com"
export const conn = new Connection(RPC, "confirmed")
export const SOL = LAMPORTS_PER_SOL

export function createKeys(dir) {
  const file = path.join(dir, "keys.json")
  const keys = (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return {} } })()
  const save = () => { fs.writeFileSync(file + ".tmp", JSON.stringify(keys)); fs.renameSync(file + ".tmp", file) }
  return {
    make(label) { const k = Keypair.generate(); keys[k.publicKey.toBase58()] = { label, secret: bs58.encode(k.secretKey) }; save(); return k.publicKey.toBase58() },
    get(pub) { const k = keys[pub]; return k ? Keypair.fromSecretKey(bs58.decode(k.secret)) : null },
    ensure(label) { const hit = Object.entries(keys).find(([, v]) => v.label === label); return hit ? hit[0] : this.make(label) },
  }
}

export const isWallet = (s) => { try { return PublicKey.isOnCurve(new PublicKey(s).toBytes()) } catch { return false } }
export const verifyMsg = (msg, sigB58, pub) => { try { return nacl.sign.detached.verify(new TextEncoder().encode(msg), bs58.decode(sigB58), new PublicKey(pub).toBytes()) } catch { return false } }
export const balance = async (pub) => conn.getBalance(new PublicKey(pub), "confirmed")

// the wallet a deposit came from: the fee payer of the escrow's first incoming transfers (refunds go back there)
export async function depositors(pub) {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(pub), { limit: 50 })
  const out = []
  for (const s of sigs.reverse()) {
    if (s.err) continue
    const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }); if (!tx) continue
    for (const ix of tx.transaction.message.instructions) {
      const p = ix.parsed; if (ix.program === "system" && p?.type === "transfer" && p.info.destination === pub) out.push({ from: p.info.source, lamports: p.info.lamports, sig: s.signature, at: (s.blockTime || 0) * 1000 })
    }
  }
  return out
}

// pay a list of { to, lamports } from an escrow, with one memo. The escrow pays the network fee.
export async function pay(escrow, legs, memo, { simulate = false, onSigned } = {}) {
  const tx = new Transaction()
  for (const l of legs) if (l.lamports > 0) tx.add(SystemProgram.transfer({ fromPubkey: escrow.publicKey, toPubkey: new PublicKey(l.to), lamports: Math.floor(l.lamports) }))
  tx.add(new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(memo.slice(0, 500)) }))
  tx.feePayer = escrow.publicKey
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed")
  tx.recentBlockhash = blockhash
  tx.sign(escrow)
  if (simulate) return conn.simulateTransaction(tx)
  const sig = bs58.encode(tx.signature)
  if (onSigned) await onSigned(sig, lastValidBlockHeight)          // the caller records it before it can land
  await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 })
  // wait until it is confirmed, or provably never will be (its blockhash expired without it landing), so a payout is
  // never recorded twice or lost: anything else keeps polling
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]
    if (st?.err) throw new Error("payout failed on chain: " + JSON.stringify(st.err))
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig
    if (!st && (await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      const again = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]
      if (!again) throw new Error("payout expired without landing: " + sig)
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

// a payout recorded as signed but not yet known: "landed", "failed" or "unknown" (still inside its blockhash window)
export async function outcome(sig, lastValidBlockHeight) {
  const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]
  if (st?.err) return "failed"
  if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return "landed"
  return (await conn.getBlockHeight("confirmed")) > lastValidBlockHeight && !(await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0] ? "failed" : "unknown"
}
