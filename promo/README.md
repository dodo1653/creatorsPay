# CreatorPay launch film (40 s, 1080p60)

Style after pump.fun's Creator Program film (word-by-word type, badge reveal, network, rain, leaderboard), in our own
theme: near-black with an electric-lime floor glow. Handles are masked (`@******`); the rate, deposit, view count and
leaderboard figures are labelled EXAMPLE on screen. The end card carries: "Independent. Not affiliated with, sponsored
or endorsed by pump.fun."

Shots: 0 Creators / pump.fun pays per trader · 4.2 one account only reaches so far · 7.3 introducing CreatorPay (coin
badge, orbiting icons) · 11.7 fund a campaign in SOL (card) · 16.5 clippers post on X (network) · 20.9 every view
verified (counter) · 25.0 paid every hour (coin rain, payout toasts) · 28.9 your views set your rank (leaderboard)
· 32.9 5 % buys back and burns $CREATORPAY · 36.2 get paid per view → end card.

Re-render:
```
node promo/serve.mjs 8833                                  # serves the CreatorPay folder (film loads ../assets/coin.glb)
cd promo && DUR=40 node music.mjs music.wav
bash render_film.sh http://127.0.0.1:8833/promo/film.html frames120 40 music.wav out/creatorpay-40s.mp4
```
Stills: `node D:/cooks/pitwall/render.mjs http://127.0.0.1:8833/promo/film.html <dir> 30 0 0 "2.6,8.2,14.2"`.
