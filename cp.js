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

  // ---------------------------------------------------------------- hero: escrow in the middle, the top clips around it
  function clipCard(k) {
    if (!k) return `<div class="clip empty"><div class="av"></div><div><b>your clip here</b><small>post on X with the link</small></div><div class="v"><b>0</b><small>views</small></div></div>`
    return `<a class="clip" href="${xUrl(k)}" target="_blank" rel="noopener"><div class="av" style="background-image:url('${esc(k.avatar)}')"></div>
      <div><b>@${esc(k.handle)}</b><small>${k.paid > 0 ? sol(k.paid) + ' SOL paid' : k.status === 'ok' ? 'earning' : esc(k.status)}</small></div>
      <div class="v"><b>${views(k.views)}</b><small>views</small></div></a>`
  }
  function hero() {
    const top = (S?.clips || []).filter((k) => k.status === 'ok' || k.paid > 0).slice(0, 6)
    const slot = (i) => clipCard(top[i])
    $('slotsL').innerHTML = [0, 2, 4].map(slot).join(''); $('slotsR').innerHTML = [1, 3, 5].map(slot).join('')
    $('hFunded').textContent = sol(S?.totals.funded || 0) + ' SOL'
    wires(top.length)
  }
  // a curve from the coin to each card; lit + flowing for real clips (SOL runs out from the escrow to the clipper)
  function wires(live) {
    const svg = $('wires'), st = $('stage'), box = st.getBoundingClientRect(), coin = st.querySelector('.coin').getBoundingClientRect()
    if (getComputedStyle(svg).display === 'none') return
    const cx = coin.left + coin.width / 2 - box.left, cy = coin.top + coin.height / 2 - box.top, r = coin.width / 2 + 8
    const cards = [...$('slotsL').children, ...$('slotsR').children]
    let html = ''
    cards.forEach((el, i) => {
      const b = el.getBoundingClientRect(), isL = i < 3, x = (isL ? b.right : b.left) - box.left, y = b.top + b.height / 2 - box.top
      const sx = cx + (isL ? -r : r), sy = cy + (y - cy) * 0.18, mx = (sx + x) / 2
      const d = `M${sx.toFixed(1)},${sy.toFixed(1)} C${mx.toFixed(1)},${sy.toFixed(1)} ${mx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`
      const on = !el.classList.contains('empty')
      html += `<path d="${d}" class="${on ? 'on' : ''}" id="w${i}"/>`
      if (on) html += `<path d="${d}" class="flow"/><circle r="3"><animateMotion dur="${(2.2 + (i % 3) * 0.5).toFixed(1)}s" repeatCount="indefinite"><mpath href="#w${i}"/></animateMotion></circle>`
      else html += `<circle r="2.4" opacity=".35"><animateMotion dur="${(5 + i * 0.4).toFixed(1)}s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear"><mpath href="#w${i}"/></animateMotion></circle>`
    })
    svg.innerHTML = html
  }
  window.addEventListener('resize', () => { clearTimeout(wires.t); wires.t = setTimeout(() => hero(), 120) })

  // ---------------------------------------------------------------- totals, rules
  function totals() {
    const t = S.totals, set = (k, v) => { const el = document.querySelector(`#totals [data-k="${k}"]`); if (el) el.textContent = v }
    set('funded', sol(t.funded)); set('paid', sol(t.paid)); set('views', views(t.views)); set('clips', t.clips); set('clippers', t.clippers)
    const R = S.rules
    document.querySelectorAll('[data-r="checkMin"]').forEach((e) => (e.textContent = R.checkMin)); document.querySelectorAll('[data-r="settleMin"]').forEach((e) => (e.textContent = R.settleMin))
    document.querySelectorAll('[data-r="feePct"]').forEach((e) => (e.textContent = Math.round(R.fee * 100) + ' %'))
    const rule = (k, b, s) => `<div><small>${k}</small><b>${b}</b><span>${s}</span></div>`
    $('rules').innerHTML = [
      rule('Payout', `every ${R.settleMin} min`, `new views since the last payout, at the campaign's rate`),
      rule('Account age', `${R.minAgeDays}+ days`, 'younger X accounts can\'t earn'),
      rule('Video', `${R.minSecs}+ seconds`, 'the post must carry a video and the campaign link'),
      rule('Per account', `${Math.round(R.maxShare * 100)} % max`, 'of a campaign\'s funding, so no one account drains it'),
      rule('Engagement', `${(R.minEng * 100).toFixed(1)} %+`, 'likes, replies, reposts per view; below it a clip is held'),
      rule('Clips', `${R.maxClips} per account`, 'per campaign'),
      rule('Protocol', `${Math.round(R.fee * 100)} % on top`, 'buys back and burns $CREATORPAY'),
      rule('Refund', 'automatic', 'unspent budget returns to the creator when the campaign ends'),
    ].join('')
    $('tkWallet').innerHTML = `<a href="${scan('account', S.protocol)}" target="_blank" rel="noopener">${short(S.protocol)}</a>`
    $('tkFees').textContent = sol(t.protocol) + ' SOL'
  }

  // ---------------------------------------------------------------- campaigns
  function campaigns() {
    const live = S.campaigns.filter((c) => c.status === 'live'), sel = $('clipCamp'), cur = sel.value
    sel.innerHTML = live.length ? live.map((c) => `<option value="${c.id}">${esc(c.title)} · ${sol(c.rate)} SOL / 1K</option>`).join('') : '<option value="">no live campaign yet</option>'
    if (cur && live.some((c) => c.id === cur)) sel.value = cur
    const cs = S.campaigns.filter((c) => c.status !== 'funding' || c.balance > 0 || (CPW.address && c.owner === CPW.address))
    if (!cs.length) { $('campList').innerHTML = `<div class="empty-card"><b>No campaign yet.</b>The first one opens below, in "For creators". Its escrow and every payout will show here.</div>`; return }
    $('campList').innerHTML = cs.map((c) => {
      const spent = c.funded > 0 ? Math.min(100, ((c.paid + c.protocol) / c.funded) * 100) : 0, mine = CPW.address && c.owner === CPW.address
      const chip = c.status === 'live' ? `<span class="chip live">live</span>` : `<span class="chip">${esc(c.status)}</span>`
      return `<article class="camp"><header><div><h3>${esc(c.title)}</h3><a class="lk" href="https://${esc(c.link.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">${esc(c.link.replace(/^https?:\/\//, ''))}</a></div>${chip}</header>
        <div class="rate">${sol(c.rate)} SOL<span>per 1,000 views</span></div>
        <div class="bar" title="${spent.toFixed(1)} % paid out"><i style="width:${spent}%"></i></div>
        <div class="kv"><div><small>Funded</small><b>${sol(c.funded)}</b></div><div><small>Left</small><b>${sol(c.balance)}</b></div><div><small>Clips</small><b>${c.clips}</b></div><div><small>${c.status === 'closed' ? 'Ended' : 'Ends'}</small><b>${c.status === 'closed' ? ago(c.endsAt) : left(c.endsAt)}</b></div></div>
        <footer>${c.status === 'live' ? `<button class="btn sm" data-submit="${c.id}">Submit a clip</button>` : ''}
          <a class="btn ghost sm" href="${scan('account', c.escrow)}" target="_blank" rel="noopener">Escrow ${short(c.escrow)}</a>
          ${mine && c.status === 'funding' ? `<button class="btn ghost sm" data-fund="${c.id}">Deposit</button>` : ''}
          ${mine && ['live', 'funding'].includes(c.status) ? `<button class="btn ghost sm" data-close="${c.id}">Close and refund</button>` : ''}</footer></article>`
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
    $('intent').href = 'https://x.com/intent/post?text=' + encodeURIComponent(`Linking my wallet to CreatorPay: ${a || '<connect your wallet first>'}`)
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
