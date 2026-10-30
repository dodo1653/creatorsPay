// The page's door to the keeper: public state is cached a moment; signed actions pass straight through.
import { RELAY_BASE } from './_relay.js'
export const config = { runtime: 'edge' }
const GETS = { state: 5, campaign: 3, campaignmsg: 0, closemsg: 0, bind: 5 }       // seconds; 0 = never cached
const POSTS = new Set(['open', 'close', 'bind', 'clip'])
const J = { 'content-type': 'application/json' }
export default async function handler(req) {
  const u = new URL(req.url), path = u.searchParams.get('path')
  if (req.method === 'POST' && POSTS.has(path)) {
    const r = await fetch(`${RELAY_BASE}/v1/${path}`, { method: 'POST', headers: J, body: await req.text() }).catch(() => null)
    if (!r) return new Response('{"error":"the keeper is offline, try again in a minute"}', { status: 502, headers: J })
    return new Response(r.body, { status: r.status, headers: { ...J, 'cache-control': 'no-store' } })
  }
  if (req.method === 'GET' && path in GETS) {
    u.searchParams.delete('path')
    const r = await fetch(`${RELAY_BASE}/v1/${path}?${u.searchParams}`, { cache: 'no-store' }).catch(() => null)
    if (!r) return new Response('{"error":"keeper offline"}', { status: 502, headers: { ...J, 'cache-control': 'no-store' } })
    return new Response(r.body, { status: r.status, headers: { ...J, 'cache-control': r.ok && GETS[path] > 0 ? `public, s-maxage=${GETS[path]}, stale-while-revalidate=10` : 'no-store' } })
  }
  return new Response('{"error":"unknown"}', { status: 404, headers: J })
}
