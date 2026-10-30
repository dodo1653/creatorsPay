// CreatorPay page. Every number comes from the keeper (/api/r), which reads X's public data and Solana.
(() => {
  const $ = (id) => document.getElementById(id)
  const api = (path, q = '', body) => fetch(`/api/r?path=${path}${q}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
    .then((r) => r.json()).catch(() => ({ error: 'the keeper is offline, try again in a minute' }))
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const sol = (v, d) => { v = +v || 0; return v === 0 ? '0' : v.toLocaleString('en-US', { maximumFractionDigits: d ?? (v >= 100 ? 1 : v >= 1 ? 3 : 4) }) }
  const views = (v) => { v = +v || 0; return v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'K' : v.toLocaleString('en-US') }
  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? Math.floor(s) + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago' }
  const left = (t) => { const s = (t - Date.now()) / 1000; return s <= 0 ? 'ended' : s < 3600 ? Math.ceil(s / 60) + 'm left' : s < 86400 ? Math.floor(s / 3600) + 'h left' : Math.floor(s / 86400) + 'd left' }
  const short = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '')
  const scan = (kind, v) => `https://solscan.io/${kind}/${v}`
  const xUrl = (k) => `https://x.com/${k.handle}/status/${k.id}`
  const toast = (t) => { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 3400) }
  const out = (id, t, cls = '') => { const el = $(id); el.className = 'out ' + cls; el.innerHTML = t }
  let S = null

  // ---------------------------------------------------------------- hero: the latest real payouts (or accepted clips)
  function hero() {
    const rows = []
    for (const p of S?.payouts || []) for (const l of p.legs || []) if (rows.length < 5) {
      const k = S.clips.find((x) => x.id === l.clip)
      rows.push(`<a class="fi" href="${scan('tx', p.sig)}" target="_blank" rel="noopener">${k?.avatar ? `<img src="${esc(k.avatar)}" alt="" loading="lazy">` : '<span class="av"></span>'}<span class="w">@${esc(l.handle)}<small>${views(l.views)} views · ${ago(p.at)}</small></span><span class="amt">+${sol(l.sol)} SOL</span></a>`)
    }
    if (!rows.length) for (const k of (S?.clips || []).filter((x) => x.status === 'ok').slice(0, 5))
      rows.push(`<a class="fi" href="${xUrl(k)}" target="_blank" rel="noopener"><img src="${esc(k.avatar)}" alt="" loading="lazy"><span class="w">@${esc(k.handle)}<small>${views(k.views)} views, earning</small></span><span class="amt">${sol(k.paid)} SOL</span></a>`)
    $('feed').innerHTML = rows.length ? rows.join('') : `<div class="none">First payouts show up here, each with its Solana transaction.</div>`
    $('feedNote').textContent = `every ${S?.rules.settleMin ?? 60} min`
  }

  // ---------------------------------------------------------------- totals, rules
  function totals() {
    const t = S.totals, R = S.rules
    $('tPaid').textContent = sol(t.paid); $('tFunded').textContent = sol(t.funded); $('tViews').textContent = views(t.views); $('tClips').textContent = t.clips; $('tClippers').textContent = t.clippers
    document.querySelectorAll('[data-r="checkMin"]').forEach((e) => (e.textContent = R.checkMin)); document.querySelectorAll('[data-r="settleMin"]').forEach((e) => (e.textContent = R.settleMin))
    document.querySelectorAll('[data-r="feePct"]').forEach((e) => (e.textContent = Math.round(R.fee * 100) + '%'))
    $('rules').innerHTML = `<b>The rules.</b> X accounts must be ${R.minAgeDays}+ days old. A clip needs a video of ${R.minSecs}+ seconds and the campaign's link in the post. One account takes at most ${Math.round(R.maxShare * 100)}% of a campaign, with up to ${R.maxClips} clips. Clips past 2,000 views with under ${(R.minEng * 100).toFixed(1)}% engagement are held. ${Math.round(R.fee * 100)}% on top of every payout buys back and burns $CREATORPAY. Unspent SOL returns to the creator automatically.`
    $('faqRules').textContent = `X accounts must be ${R.minAgeDays}+ days old, a clip needs a video of ${R.minSecs}+ seconds and the campaign link, one account can take at most ${Math.round(R.maxShare * 100)}% of a campaign, and clips whose views come with almost no likes, replies or reposts are held instead of paid.`
    $('tkWallet').innerHTML = `<a href="${scan('account', S.protocol)}" target="_blank" rel="noopener">${short(S.protocol)}</a>`
    $('tkFees').textContent = sol(t.protocol) + ' SOL'
  }

  // ---------------------------------------------------------------- campaigns
  function campaigns() {
    const live = S.campaigns.filter((c) => c.status === 'live'), sel = $('clipCamp'), cur = sel.value
    sel.innerHTML = live.length ? live.map((c) => `<option value="${c.id}">${esc(c.title)} · ${sol(c.rate)} SOL / 1K</option>`).join('') : '<option value="">no live campaign yet</option>'
    if (cur && live.some((c) => c.id === cur)) sel.value = cur
    const cs = S.campaigns.filter((c) => c.status !== 'funding' || c.balance > 0 || (CPW.address && c.owner === CPW.address))
    if (!cs.length) { $('campList').innerHTML = `<div class="empty-card"><b>No campaign yet.</b>The first one opens below, under For creators. Its escrow and every payout will show here.</div>`; return }
    $('campList').innerHTML = cs.map((c) => {
      const spent = c.funded > 0 ? Math.min(100, ((c.paid + c.protocol) / c.funded) * 100) : 0, mine = CPW.address && c.owner === CPW.address
      const chip = c.status === 'live' ? `<span class="chip live">live</span>` : `<span class="chip">${esc(c.status)}</span>`
      return `<article class="camp"><header><div><h3>${esc(c.title)}</h3><a class="lk" href="https://${esc(c.link.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">${esc(c.link.replace(/^https?:\/\//, ''))}</a></div>${chip}</header>
        <div class="rate">${sol(c.rate)} SOL<span>per 1,000 views</span></div>
        <div class="meter" title="${spent.toFixed(1)}% paid out"><i style="width:${spent}%"></i></div>
        <div class="kv"><div><small>Funded</small><b>${sol(c.funded)}</b></div><div><small>Left</small><b>${sol(c.balance)}</b></div><div><small>Clips</small><b>${c.clips}</b></div><div><small>${c.status === 'closed' ? 'Ended' : 'Ends'}</small><b>${c.status === 'closed' ? ago(c.endsAt) : left(c.endsAt)}</b></div></div>
        <footer>${c.status === 'live' ? `<button class="btn green sm" data-submit="${c.id}">Submit a clip</button>` : ''}
          <a class="btn sm" href="${scan('account', c.escrow)}" target="_blank" rel="noopener">Escrow ${short(c.escrow)}</a>
          ${mine && c.status === 'funding' ? `<button class="btn sm" data-fund="${c.id}">Deposit</button>` : ''}
          ${mine && ['live', 'funding'].includes(c.status) ? `<button class="btn sm" data-close="${c.id}">Close and refund</button>` : ''}</footer></article>`
    }).join('')
  }

  // ---------------------------------------------------------------- clips + payouts
  function clips() {
    const ks = S.clips
    $('clipTable').innerHTML = `<div class="tr h"><span>#</span><span>Clip</span><span>Views</span><span>Paid</span><span>Status</span></div>` + (ks.length ? ks.slice(0, 25).map((k, i) => {
      const chip = k.status === 'ok' ? '<span class="chip live">earning</span>' : `<span class="chip ${esc(k.status)}">${esc(k.status)}</span>`
      return `<div class="tr"><span class="num dim">${i + 1}</span><a class="who" href="${xUrl(k)}" target="_blank" rel="noopener"><img src="${esc(k.avatar)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><div><b>@${esc(k.handle)}</b><small>${esc(k.text)}</small></div></a>
        <span class="num">${views(k.views)}</span><span class="num acc">${sol(k.paid)} SOL</span><span>${chip}${k.reason ? `<span class="rs">${esc(k.reason)}</span>` : ''}</span></div>`
    }).join('') : `<div class="none">No clips yet. The first accepted clip shows here with its live view count.</div>`)
    const ps = S.payouts
    $('payTable').innerHTML = `<div class="tr h"><span>When</span><span>Paid to</span><span>Amount</span><span>Transaction</span></div>` + (ps.length ? ps.map((p) => {
      const who = p.refund ? `Refund of what was left to the creator` : (p.legs || []).map((l) => `@${esc(l.handle)} <span class="dim">${views(l.views)} views</span>`).join(', ')
      const amt = p.refund ? p.refund : (p.legs || []).reduce((a, l) => a + l.sol, 0)
      return `<div class="tr"><span class="dim">${ago(p.at)}</span><span>${who}</span><span class="num acc">${sol(amt)} SOL</span><a class="tx" href="${scan('tx', p.sig)}" target="_blank" rel="noopener">${short(p.sig)}</a></div>`
    }).join('') : `<div class="none">No payouts yet. The first hourly settlement after a clip earns lands here, with its transaction.</div>`)
  }

  async function load() {
    const s = await api('state'); if (s.error) { if (!S) out('cOut', ''); return }
    S = s; hero(); totals(); campaigns(); clips()
  }

  // ---------------------------------------------------------------- wallet
  const walletBtn = $('wallet')
  function walletUi(a) {
    walletBtn.textContent = a ? short(a) : 'Connect wallet'
    document.querySelectorAll('[data-connect]').forEach((b) => (b.textContent = a ? 'Connected ' + short(a) : 'Connect wallet'))
    $('intent').href = 'https://x.com/intent/post?text=' + encodeURIComponent(`Linking my wallet to @CreatorPayPump: ${a || '<connect your wallet first>'}`)
    if (S) campaigns()
  }
  window.addEventListener('cpw', (e) => walletUi(e.detail))
  const connect = async () => { try { await CPW.connect() } catch (e) { toast(e.message) } }
  walletBtn.onclick = connect
  document.querySelectorAll('[data-connect]').forEach((b) => (b.onclick = connect))
  $('intent').addEventListener('click', (e) => { if (!CPW.address) { e.preventDefault(); toast('Connect your wallet first, so the post carries its address') } })
  walletUi(null)

  // ---------------------------------------------------------------- clippers: link X, submit clips
  $('bindGo').onclick = async () => {
    if (!CPW.address) return out('bindOut', 'Connect your wallet first.', 'err')
    out('bindOut', 'Reading your post on X…')
    const r = await api('bind', '', { url: $('bindUrl').value.trim(), wallet: CPW.address })
    r.error ? out('bindOut', esc(r.error), 'err') : out('bindOut', `@${esc(r.handle)} is linked to ${short(r.wallet)}. Clips from this account pay this wallet.`, 'ok')
  }
  $('clipGo').onclick = async () => {
    const campaign = $('clipCamp').value; if (!campaign) return out('clipOut', 'There is no live campaign to submit to yet.', 'err')
    out('clipOut', 'Checking the clip on X…')
    const r = await api('clip', '', { campaign, url: $('clipUrl').value.trim() })
    if (r.error) return out('clipOut', esc(r.error), 'err')
    out('clipOut', `Accepted: @${esc(r.handle)}, ${views(r.views)} views so far. It earns from here, paid every hour.`, 'ok'); $('clipUrl').value = ''; load()
  }
  document.addEventListener('click', async (e) => {
    const sub = e.target.closest('[data-submit]'), fund = e.target.closest('[data-fund]'), close = e.target.closest('[data-close]')
    if (sub) { $('clipCamp').value = sub.dataset.submit; document.getElementById('clippers').scrollIntoView({ behavior: 'smooth' }) }
    if (fund) { const c = S.campaigns.find((x) => x.id === fund.dataset.fund); const amt = prompt('Deposit how much SOL into this campaign\'s escrow?', '1'); if (amt) depositTo(c, amt) }
    if (close) {
      if (!confirm('Close this campaign now? Clips are paid for the views they have, then what is left returns to your wallet.')) return
      try {
        const { msg, error } = await api('closemsg', '&id=' + close.dataset.close); if (error) throw new Error(error)
        const r = await api('close', '', { id: close.dataset.close, sig: await CPW.signText(msg) }); if (r.error) throw new Error(r.error)
        toast('Closed. The final payout and your refund go out at the next settlement.'); load()
      } catch (err) { toast(err.message) }
    }
  })

  // ---------------------------------------------------------------- creators: open + fund
  const math = () => { const r = +$('cRate').value || 0, d = +$('cDep').value || 0; $('cMath').textContent = r > 0 && d > 0 ? `SOL into the campaign's escrow: about ${views(Math.floor((d / (r * (1 + (S?.rules.fee ?? 0.05)))) * 1000))} views at this rate` : "SOL into the campaign's escrow" }
  ;['cRate', 'cDep'].forEach((id) => $(id).addEventListener('input', math)); math()
  async function depositTo(c, amt) {
    out('cOut', `Approve the deposit of ${esc(amt)} SOL to the escrow ${short(c.escrow)} in your wallet…`)
    try {
      const sig = await CPW.deposit(c.escrow, amt)
      out('cOut', `Deposit sent: <a href="${scan('tx', sig)}" target="_blank" rel="noopener">${short(sig)}</a>. The campaign goes live as soon as the escrow holds ${S?.rules.minLive ?? 0.05} SOL.`, 'ok')
      setTimeout(load, 4000)
    } catch (e) { out('cOut', `${esc(e.message)}. You can deposit later with the Deposit button on your campaign, or send SOL to ${esc(c.escrow)}.`, 'err') }
  }
  $('cGo').onclick = async () => {
    const go = $('cGo'); go.disabled = true
    try {
      const owner = CPW.address || (await CPW.connect())
      const f = { title: $('cTitle').value.trim(), link: $('cLink').value.trim().replace(/^https?:\/\//, ''), rate: +$('cRate').value, days: Math.round(+$('cDays').value), owner, nonce: Date.now() }
      const dep = +$('cDep').value
      if (!(dep >= (S?.rules.minLive ?? 0.05))) throw new Error(`deposit at least ${S?.rules.minLive ?? 0.05} SOL`)
      const q = '&' + new URLSearchParams(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])))
      const { msg, error } = await api('campaignmsg', q); if (error) throw new Error(error)
      out('cOut', 'Sign the campaign in your wallet (a message, no fee)…')
      const c = await api('open', '', { ...f, sig: await CPW.signText(msg) }); if (c.error) throw new Error(c.error)
      out('cOut', `Campaign opened. Escrow: <a href="${scan('account', c.escrow)}" target="_blank" rel="noopener">${short(c.escrow)}</a>.`, 'ok')
      await load(); await depositTo(c, dep)
    } catch (e) { out('cOut', esc(e.message), 'err') } finally { go.disabled = false }
  }

  load(); setInterval(load, 15000)
})()
