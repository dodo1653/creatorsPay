// X (Twitter) posts read from public data (api.fxtwitter.com): the post's text with its links expanded, its views,
// likes, replies, reposts and quotes, its video length, and the author's handle and account age. Nothing here needs
// an X login or API key, so anyone can check the same numbers.
const UA = { "user-agent": "creatorpay-oracle/1.0 (+https://creatorpay.fun)" }

export function tweetId(url) {
  const m = String(url || "").trim().match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status\/(\d{5,25})/)
  return m ? m[1] : null
}

export async function fetchTweet(id) {
  if (process.env.X_MOCK) {                                  // tests only: posts from a local JSON file instead of X
    const { readFileSync } = await import("node:fs"); const m = JSON.parse(readFileSync(process.env.X_MOCK, "utf8"))[id]
    return m ? { links: [], text: "", views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, videoSecs: 0, joined: 0, ...m, id } : { gone: true }
  }
  const r = await fetch(`https://api.fxtwitter.com/i/status/${id}`, { headers: UA, signal: AbortSignal.timeout(12000) })
  if (r.status === 404) return { gone: true }
  if (!r.ok) throw new Error(`X data unavailable (${r.status})`)
  const j = await r.json(), t = j.tweet
  if (!t) return { gone: true }
  const links = (t.raw_text?.facets || []).filter((f) => f.type === "url").map((f) => f.replacement || f.original)
  const video = (t.media?.all || t.media?.videos || []).filter((m) => m.type === "video" || m.type === "gif")
  return {
    id: String(t.id), handle: t.author?.screen_name || "", name: t.author?.name || "", avatar: t.author?.avatar_url || "",
    joined: t.author?.joined ? Date.parse(t.author.joined) : 0, followers: t.author?.followers || 0,
    text: t.text || "", links, postedAt: (t.created_timestamp || 0) * 1000,
    views: t.views ?? null, likes: t.likes || 0, replies: t.replies || 0, reposts: t.reposts || t.retweets || 0, quotes: t.quotes || 0,
    videoSecs: video.reduce((a, m) => Math.max(a, m.duration || 0), 0), thumb: video[0]?.thumbnail_url || "",
  }
}

// a pump.fun link, normalised for comparison: host + path, lower case, no trailing slash or query
export function normLink(u) {
  try {
    const x = new URL(/^https?:\/\//.test(u) ? u : "https://" + u)
    return (x.host.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase()
  } catch { return "" }
}
export const isPumpLink = (u) => /^(pump\.fun\/(join|coin|profile)\/[a-z0-9_-]{2,64}|join\.pump\.fun\/[a-z0-9_-]{2,64})$/i.test(normLink(u))
export const hasLink = (tw, link) => { const want = normLink(link); return [...tw.links, ...String(tw.text).split(/\s+/)].some((l) => normLink(l) === want) }
