// CreatorPay keeper. Creators open a campaign and fund its own escrow address; clippers post short videos on X with the
// campaign's pump.fun link; this keeper reads each post's public view count and pays the clipper from the escrow, every
// hour, at the campaign's rate per 1,000 views (+5 % to the protocol wallet, which buys back and burns $CREATORPAY).
// Every payout and refund is a Solana transaction with a Memo; every view count comes from X's public data.
// node server.mjs   ->  http://127.0.0.1:8811/v1/state
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { tweetId, fetchTweet, isPumpLink, hasLink, normLink } from "./x.js"
import { createKeys, isWallet, verifyMsg, balance, pay, outcome, SOL } from "./chain.js"

const PORT = +(process.env.PORT || 8811)
const DIR = process.env.DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), ".data"); fs.mkdirSync(DIR, { recursive: true })
export const RULES = {
  fee: 0.05,                 // protocol share, on top of what clippers earn
  minRate: 0.001, maxRate: 1, // SOL per 1,000 views
  minLive: 0.05 * SOL,       // a campaign goes live once its escrow holds this much
  minDays: 1, maxDays: 30,
  minAgeDays: 30,            // X accounts younger than this can't earn
  minSecs: 10,               // the clip's video must be at least this long
  maxShare: 0.2,             // one X account can take at most this share of a campaign's funding
  maxClips: 10,              // clips per X account per campaign
  minEng: 0.002,             // likes + replies + reposts + quotes per view; below it (past 2,000 views) a clip is held
  minLeg: 0.002 * SOL,       // smallest single payout
  feeReserve: 0.002 * SOL,   // kept in the escrow for network fees until the final refund (and above rent)
  rentMin: 890_880,          // a Solana account holding less than this (but not 0) is refused by the chain
}
const CHECK_MS = +(process.env.CHECK_MS || 10 * 60_000), SETTLE_MS = +(process.env.SETTLE_MS || 60 * 60_000)

// ---------------------------------------------------------------- store
const file = path.join(DIR, "db.json")
const db = (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return { campaigns: {}, clips: {}, binds: {}, payouts: [] } } })()
db.pending ||= {}                                                 // payouts signed but not yet confirmed
let dirty = false; const save = () => { dirty = true }
setInterval(() => { if (!dirty) return; dirty = false; fs.writeFileSync(file + ".tmp", JSON.stringify(db)); fs.renameSync(file + ".tmp", file) }, 1000)
const keys = createKeys(DIR), PROTOCOL = keys.ensure("protocol")
const id6 = () => crypto.randomBytes(4).toString("hex")
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n)

// ---------------------------------------------------------------- messages the owner signs
export const campaignMsg = (c) => `CreatorPay\nOpen a campaign: ${c.title}\nLink: ${c.link}\nRate: ${c.rate} SOL per 1,000 views\nRuns: ${c.days} days\nOwner: ${c.owner}\nNonce: ${c.nonce}`
export const closeMsg = (id, owner) => `CreatorPay\nClose campaign ${id} now and refund what is left to ${owner}`

function openCampaign(b) {
  const c = { title: clean(b.title, 60), link: clean(b.link, 120), rate: +b.rate, days: Math.round(+b.days || 14), owner: String(b.owner || ""), nonce: +b.nonce || 0 }
  if (c.title.length < 3) throw new Error("give the campaign a title")
  if (!isPumpLink(c.link)) throw new Error("the link must be a pump.fun link: pump.fun/join/<code>, pump.fun/coin/<CA> or pump.fun/profile/<name>")
  if (!(c.rate >= RULES.minRate && c.rate <= RULES.maxRate)) throw new Error(`the rate must be ${RULES.minRate} to ${RULES.maxRate} SOL per 1,000 views`)
  if (!(c.days >= RULES.minDays && c.days <= RULES.maxDays)) throw new Error(`campaigns run ${RULES.minDays} to ${RULES.maxDays} days`)
  if (!isWallet(c.owner)) throw new Error("connect a Solana wallet")
  if (Math.abs(Date.now() - c.nonce) > 10 * 60_000) throw new Error("that signature is stale, sign again")
  if (!verifyMsg(campaignMsg(c), b.sig, c.owner)) throw new Error("the signature doesn't match the wallet")
  const id = id6(), escrow = keys.make("escrow:" + id), now = Date.now()
  db.campaigns[id] = { id, title: c.title, link: c.link, rate: c.rate, days: c.days, owner: c.owner, escrow, createdAt: now, endsAt: now + c.days * 86400_000,
    status: "funding", balance: 0, paid: 0, protocol: 0, netFees: 0, refunded: 0, lastSettle: 0 }
  save(); return pub(db.campaigns[id])
}
function closeCampaign(b) {
  const c = db.campaigns[b.id]; if (!c) throw new Error("no such campaign")
  if (!verifyMsg(closeMsg(c.id, c.owner), b.sig, c.owner)) throw new Error("only the campaign's owner can close it")
  c.endsAt = Math.min(c.endsAt, Date.now()); save(); return pub(c)
}

// ---------------------------------------------------------------- X account -> wallet, proven by a post
async function bindX(b) {
  const tid = tweetId(b.url), wallet = String(b.wallet || "")
  if (!tid) throw new Error("paste the link to your post on X")
  if (!isWallet(wallet)) throw new Error("connect the Solana wallet you want to be paid to")
  const tw = await fetchTweet(tid); if (tw.gone) throw new Error("that post isn't public")
  if (!tw.text.includes(wallet)) throw new Error("the post must contain your wallet address")
  const h = tw.handle.toLowerCase(), old = db.binds[h]
  if (old && old.postedAt > tw.postedAt) throw new Error("this account is already linked by a newer post")
  db.binds[h] = { handle: tw.handle, wallet, proof: tid, postedAt: tw.postedAt, at: Date.now(), joined: tw.joined }
  save(); return { handle: tw.handle, wallet }
}

// ---------------------------------------------------------------- clips
async function submitClip(b) {
  const c = db.campaigns[b.campaign]; if (!c) throw new Error("no such campaign")
  if (c.status !== "live") throw new Error(c.status === "funding" ? "this campaign isn't funded yet" : "this campaign has ended")
  const tid = tweetId(b.url); if (!tid) throw new Error("paste the link to your clip on X")
  if (db.clips[tid]) throw new Error("this clip is already in")
  const tw = await fetchTweet(tid); if (tw.gone) throw new Error("that post isn't public")
  const bind = db.binds[tw.handle.toLowerCase()]
  if (!bind) throw new Error(`@${tw.handle} isn't linked to a wallet yet: post your wallet address from it and link that post first`)
  if (tw.postedAt < c.createdAt) throw new Error("the clip was posted before this campaign opened")
  if (!hasLink(tw, c.link)) throw new Error(`the post must include the campaign's link: ${c.link}`)
  if (tw.videoSecs < RULES.minSecs) throw new Error(`the post needs a video of at least ${RULES.minSecs} seconds`)
  if (Date.now() - tw.joined < RULES.minAgeDays * 86400_000) throw new Error(`X accounts must be at least ${RULES.minAgeDays} days old to earn`)
  if (Object.values(db.clips).filter((x) => x.campaign === c.id && x.handle.toLowerCase() === tw.handle.toLowerCase()).length >= RULES.maxClips) throw new Error(`at most ${RULES.maxClips} clips per account per campaign`)
  db.clips[tid] = { id: tid, campaign: c.id, handle: tw.handle, name: tw.name, avatar: tw.avatar, wallet: bind.wallet, postedAt: tw.postedAt, submittedAt: Date.now(),
    views: tw.views || 0, likes: tw.likes, replies: tw.replies, reposts: tw.reposts, quotes: tw.quotes, secs: tw.videoSecs, thumb: tw.thumb, text: tw.text.slice(0, 200),
    status: "ok", reason: "", paidViews: 0, paid: 0, checkedAt: Date.now(), hist: [[Date.now(), tw.views || 0]] }
  save(); return clipPub(db.clips[tid])
}

// the oracle: re-read live clips' public numbers every CHECK_MS, a few per minute
async function oracle() {
  const now = Date.now()
  const due = Object.values(db.clips).filter((k) => ["ok", "held"].includes(k.status) && now - k.checkedAt > CHECK_MS && now < (db.campaigns[k.campaign]?.endsAt || 0)).sort((a, b) => a.checkedAt - b.checkedAt).slice(0, 8)
  for (const k of due) {
    try {
      const tw = await fetchTweet(k.id); k.checkedAt = Date.now()
      if (tw.gone) { k.status = "gone"; k.reason = "the post was deleted or made private: it stops earning"; save(); continue }
      const dv = (tw.views || 0) - k.views, de = tw.likes + tw.replies + tw.reposts + tw.quotes - (k.likes + k.replies + k.reposts + k.quotes)
      if (dv > 100_000 && de < dv * 0.0005) { k.status = "held"; k.reason = `+${dv.toLocaleString()} views in one check with almost no engagement` }
      Object.assign(k, { views: Math.max(k.views, tw.views || 0), likes: tw.likes, replies: tw.replies, reposts: tw.reposts, quotes: tw.quotes })
      k.hist.push([k.checkedAt, k.views]); if (k.hist.length > 300) k.hist.splice(1, 1)
      save()
    } catch (e) { console.log("oracle", k.id, e.message) }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

// ---------------------------------------------------------------- funding + settlement
async function watchFunding() {
  for (const c of Object.values(db.campaigns)) {
    if (c.status === "closed") continue
    try {
      c.balance = await balance(c.escrow)
      if (c.status === "funding" && c.balance >= RULES.minLive) { c.status = "live"; c.liveAt = Date.now() }
      save()
    } catch (e) { console.log("balance", c.id, e.message) }
  }
}
const funded = (c) => c.balance + c.paid + c.protocol + c.netFees + c.refunded

// what each clip is owed right now, within the campaign's rules and what its escrow holds
export function plan(c, clips, now = Date.now()) {
  const legs = [], byHandle = {}
  for (const k of clips) byHandle[k.handle.toLowerCase()] = (byHandle[k.handle.toLowerCase()] || 0) + k.paid
  let avail = c.balance - RULES.feeReserve - (c.feeOwed || 0)
  for (const k of clips.filter((x) => x.status === "ok").sort((a, b) => a.postedAt - b.postedAt)) {
    const eng = k.likes + k.replies + k.reposts + k.quotes
    if (k.views >= 2000 && eng / k.views < RULES.minEng) { k.status = "held"; k.reason = `engagement ${(eng / k.views * 100).toFixed(2)} % is under ${RULES.minEng * 100} %`; continue }
    const dueViews = k.views - k.paidViews; if (dueViews <= 0) continue
    let lam = Math.floor(dueViews * c.rate * SOL / 1000)
    const cap = Math.floor(RULES.maxShare * funded(c)) - byHandle[k.handle.toLowerCase()]
    lam = Math.min(lam, cap, Math.floor(avail / (1 + RULES.fee)))
    if (lam < RULES.minLeg) continue
    const views = lam === Math.floor(dueViews * c.rate * SOL / 1000) ? dueViews : Math.floor(lam * 1000 / (c.rate * SOL))
    legs.push({ clip: k.id, to: k.wallet, lamports: lam, views }); byHandle[k.handle.toLowerCase()] += lam; avail -= lam * (1 + RULES.fee)
  }
  return legs
}

// book a confirmed payout (once): clips, campaign totals and the public ledger
function apply(sig) {
  const p = db.pending[sig]; if (!p) return; delete db.pending[sig]
  const c = db.campaigns[p.campaign]
  for (const l of p.legs) { const k = db.clips[l.clip]; k.paidViews += l.views; k.paid += l.lamports }
  c.paid += p.legs.reduce((a, l) => a + l.lamports, 0); c.protocol += p.protocol; c.netFees += 5000
  db.payouts.unshift({ at: Date.now(), campaign: c.id, sig, legs: p.legs.map((l) => ({ ...l, handle: db.clips[l.clip].handle })), protocol: p.protocol })
  db.payouts.splice(500); save()
  console.log(`paid ${c.id}: ${p.legs.length} clips, ${(p.protocol / RULES.fee / SOL).toFixed(4)} SOL, ${sig}`)
}
// after a restart or a lost confirmation: settle each signed payout by what the chain says, before paying anything new
async function reconcile() {
  for (const [sig, p] of Object.entries(db.pending)) {
    const o = await outcome(sig, p.lastValid)
    if (o === "landed") apply(sig); else if (o === "failed") { delete db.pending[sig]; save() }
  }
  return Object.keys(db.pending).length === 0
}
const flush = () => { fs.writeFileSync(file + ".tmp", JSON.stringify(db)); fs.renameSync(file + ".tmp", file) }

let settling = false
async function settle(force = false) {
  if (settling) return; settling = true
  try {
    if (!(await reconcile())) return                                // a payout is still in flight: wait for it
    for (const c of Object.values(db.campaigns)) {
      if (c.status === "refunding") {                               // a refund signed before a restart: book it or retry it
        const o = await outcome(c.refundSig, 0)
        if (o === "landed") { c.refunded += c.refundPending || 0; c.netFees += 5000; c.status = "closed"; c.balance = 0; c.closedAt = Date.now(); save() }
        else if (o === "failed") { c.status = "live"; save() }
        continue
      }
      if (c.status !== "live") continue
      const ended = Date.now() >= c.endsAt
      if (!force && !ended && Date.now() - c.lastSettle < SETTLE_MS) continue
      c.balance = await balance(c.escrow)
      const clips = Object.values(db.clips).filter((k) => k.campaign === c.id), legs = plan(c, clips)
      const escrow = keys.get(c.escrow)
      for (let i = 0; i < legs.length; i += 7) {
        const part = legs.slice(i, i + 7)
        // the 5 % is carried until the protocol wallet can take it (a first transfer under the rent minimum is refused)
        c.feeOwed = (c.feeOwed || 0) + Math.floor(part.reduce((a, l) => a + l.lamports, 0) * RULES.fee)
        const fee = (await balance(PROTOCOL)) + c.feeOwed >= RULES.rentMin ? c.feeOwed : 0
        const memo = `CreatorPay ${c.id} | ` + part.map((l) => `${l.clip}:${l.views}`).join(" ")
        try {
          const rec = { campaign: c.id, legs: part.map((l) => ({ clip: l.clip, lamports: l.lamports, views: l.views })), protocol: fee }
          const sig = await pay(escrow, [...part, { to: PROTOCOL, lamports: fee }], memo, { onSigned: (s, h) => { db.pending[s] = { ...rec, lastValid: h, at: Date.now() }; flush() } })
          c.feeOwed -= fee; apply(sig)
                } catch (e) { c.feeOwed -= Math.floor(part.reduce((a, l) => a + l.lamports, 0) * RULES.fee); console.log("pay", c.id, e.message) }
      }
      c.lastSettle = Date.now()
      if (ended) await refund(c)
      save()
    }
  } finally { settling = false }
}
async function refund(c) {
  const bal = await balance(c.escrow), owed = c.feeOwed || 0
  const feeNow = owed && (await balance(PROTOCOL)) + owed >= RULES.rentMin ? owed : 0     // a fee too small to deliver is dropped
  const amount = bal - 5000 - feeNow
  if (amount > 0) {
    c.refundSig = await pay(keys.get(c.escrow), [{ to: c.owner, lamports: amount }, { to: PROTOCOL, lamports: feeNow }], `CreatorPay ${c.id} | refund`, { onSigned: (s) => { c.refundSig = s; c.refundPending = amount; c.status = "refunding"; flush() } })
    c.refunded += amount; c.netFees += 5000; c.protocol += feeNow; c.feeOwed = 0
    db.payouts.unshift({ at: Date.now(), campaign: c.id, sig: c.refundSig, refund: amount }); console.log(`refunded ${c.id}: ${amount / SOL} SOL, ${c.refundSig}`)
  }
  c.balance = 0; c.status = "closed"; c.closedAt = Date.now(); save()
}

// ---------------------------------------------------------------- public views
const clipPub = (k) => ({ id: k.id, campaign: k.campaign, handle: k.handle, name: k.name, avatar: k.avatar, postedAt: k.postedAt, views: k.views, likes: k.likes, replies: k.replies, reposts: k.reposts, quotes: k.quotes, secs: k.secs, thumb: k.thumb, text: k.text, status: k.status, reason: k.reason, paid: k.paid / SOL, paidViews: k.paidViews })
function pub(c) {
  const clips = Object.values(db.clips).filter((k) => k.campaign === c.id)
  return { id: c.id, title: c.title, link: c.link, rate: c.rate, days: c.days, owner: c.owner, escrow: c.escrow, createdAt: c.createdAt, endsAt: c.endsAt, status: c.status,
    balance: c.balance / SOL, funded: funded(c) / SOL, paid: c.paid / SOL, protocol: c.protocol / SOL, refunded: c.refunded / SOL, refundSig: c.refundSig || null,
    clips: clips.length, clippers: new Set(clips.map((k) => k.handle.toLowerCase())).size, views: clips.reduce((a, k) => a + k.views, 0) }
}
function state() {
  const cs = Object.values(db.campaigns).sort((a, b) => b.createdAt - a.createdAt), clips = Object.values(db.clips)
  return {
    now: Date.now(), rules: { ...RULES, minLive: RULES.minLive / SOL, minLeg: RULES.minLeg / SOL, feeReserve: RULES.feeReserve / SOL, checkMin: CHECK_MS / 60_000, settleMin: SETTLE_MS / 60_000 },
    protocol: PROTOCOL,
    totals: { campaigns: cs.filter((c) => c.status !== "funding").length, funded: cs.reduce((a, c) => a + funded(c), 0) / SOL, paid: cs.reduce((a, c) => a + c.paid, 0) / SOL,
      protocol: cs.reduce((a, c) => a + c.protocol, 0) / SOL, clips: clips.length, clippers: new Set(clips.map((k) => k.handle.toLowerCase())).size, views: clips.reduce((a, k) => a + k.views, 0) },
    campaigns: cs.slice(0, 60).map(pub),
    clips: clips.sort((a, b) => b.views - a.views).slice(0, 60).map(clipPub),
    payouts: db.payouts.slice(0, 40).map((p) => ({ ...p, legs: p.legs?.map((l) => ({ ...l, sol: l.lamports / SOL })), refund: p.refund ? p.refund / SOL : undefined, protocol: p.protocol ? p.protocol / SOL : undefined })),
  }
}

// ---------------------------------------------------------------- http
const json = (res, o, code = 200) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" }); res.end(JSON.stringify(o, (k, v) => (typeof v === "function" ? undefined : v))) }
const ADMIN = process.env.ADMIN_TOKEN || ""
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x")
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }); return res.end() }
    const body = async () => { const ch = []; let n = 0; for await (const x of req) { n += x.length; if (n > 20_000) throw new Error("too large"); ch.push(x) } return JSON.parse(Buffer.concat(ch).toString() || "{}") }
    if (u.pathname === "/v1/state") return json(res, state())
    if (u.pathname === "/v1/campaign") { const c = db.campaigns[u.searchParams.get("id")]; if (!c) return json(res, { error: "no such campaign" }, 404); return json(res, { ...pub(c), clipList: Object.values(db.clips).filter((k) => k.campaign === c.id).sort((a, b) => b.views - a.views).map(clipPub), payouts: db.payouts.filter((p) => p.campaign === c.id).slice(0, 60) }) }
    if (u.pathname === "/v1/campaignmsg") return json(res, { msg: campaignMsg({ title: clean(u.searchParams.get("title"), 60), link: clean(u.searchParams.get("link"), 120), rate: +u.searchParams.get("rate"), days: Math.round(+u.searchParams.get("days") || 14), owner: u.searchParams.get("owner"), nonce: +u.searchParams.get("nonce") }) })
    if (u.pathname === "/v1/closemsg") { const c = db.campaigns[u.searchParams.get("id")]; return c ? json(res, { msg: closeMsg(c.id, c.owner) }) : json(res, { error: "no such campaign" }, 404) }
    if (u.pathname === "/v1/bind" && req.method === "GET") { const b = db.binds[String(u.searchParams.get("handle") || "").toLowerCase().replace(/^@/, "")]; return json(res, b ? { handle: b.handle, wallet: b.wallet } : { error: "not linked" }) }
    if (u.pathname === "/v1/open" && req.method === "POST") return json(res, openCampaign(await body()))
    if (u.pathname === "/v1/close" && req.method === "POST") return json(res, closeCampaign(await body()))
    if (u.pathname === "/v1/bind" && req.method === "POST") return json(res, await bindX(await body()))
    if (u.pathname === "/v1/clip" && req.method === "POST") return json(res, await submitClip(await body()))
    if (u.pathname === "/v1/admin" && req.method === "POST") {
      const b = await body(); if (!ADMIN || b.token !== ADMIN) return json(res, { error: "no" }, 403)
      if (b.do === "release") { const k = db.clips[b.clip]; if (k) { k.status = "ok"; k.reason = "" } save(); return json(res, { ok: true }) }
      if (b.do === "reject") { const k = db.clips[b.clip]; if (k) { k.status = "rejected"; k.reason = String(b.reason || "") } save(); return json(res, { ok: true }) }
      if (b.do === "settle") { await settle(true); return json(res, { ok: true }) }
      return json(res, { error: "unknown" }, 400)
    }
    return json(res, { error: "not found" }, 404)
  } catch (e) { return json(res, { error: e.message }, 400) }
}).listen(PORT, () => console.log(`creatorpay keeper on ${PORT}, protocol wallet ${PROTOCOL}`))

setInterval(() => oracle().catch((e) => console.log("oracle", e.message)), 60_000)
setInterval(() => watchFunding().catch((e) => console.log("funding", e.message)), 30_000)
setInterval(() => settle().catch((e) => console.log("settle", e.message)), 5 * 60_000)
watchFunding().catch(() => {})
