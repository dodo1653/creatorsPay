# CreatorPay's coin image, part 2: the rendered coin on a near-black field with a fine grid, a soft lime glow behind
# the coin and its shadow. Also the flat mark (a near-black coin with a lime play triangle on a lime field).
# python art/compose.py art/out/coin_raw.png <out.png> [size] [coin_scale]        (rendered)
# python art/compose.py flat <out.png> [size]                                       (flat mark)
import sys, math
from PIL import Image, ImageDraw, ImageFilter, ImageChops

src, out = sys.argv[1], sys.argv[2]
S = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
K = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
SS = S * 2
def hexc(h): h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
LIME, INK = hexc('#d4ff3a'), hexc('#07080a')

def tri(cx, cy, R, r, n=24):
    pts = []
    for k in range(3):
        a = math.radians(k * 120); c = (cx + (R - 2 * r) * math.cos(a), cy - (R - 2 * r) * math.sin(a))
        for i in range(n + 1):
            t = a - math.radians(60) + math.radians(120) * i / n; pts.append((c[0] + r * math.cos(t), c[1] - r * math.sin(t)))
    return pts

if src == 'flat':
    im = Image.new('RGB', (SS, SS), LIME); d = ImageDraw.Draw(im)
    R = SS * 0.40; d.ellipse((SS / 2 - R, SS / 2 - R, SS / 2 + R, SS / 2 + R), fill=INK)
    d.polygon(tri(SS / 2 - R * 0.065, SS / 2, R * 0.6, R * 0.09), fill=LIME)
    im.resize((S, S), Image.LANCZOS).save(out); print('wrote', out); sys.exit()

# field: near-black with a faint lime lift in the middle
bg = Image.new('RGB', (SS, SS)); px = bg.load()
c0, c1 = hexc('#1a2108'), hexc('#060708')
for y in range(SS):
    for x in range(SS):
        t = min(1, math.hypot(x - SS / 2, y - SS * 0.48) / (SS * 0.72)) ** 1.1
        px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
# fine grid, fading toward the coin and the edges
grid = Image.new('L', (SS, SS), 0); g = ImageDraw.Draw(grid); step = SS // 20
for i in range(0, SS + 1, step): g.line((i, 0, i, SS), fill=70, width=2); g.line((0, i, SS, i), fill=70, width=2)
mask = Image.new('L', (SS // 4, SS // 4), 0); mp = mask.load(); m4 = SS // 4
for y in range(m4):
    for x in range(m4):
        dd = math.hypot(x - m4 / 2, y - m4 * 0.48) / (m4 * 0.5)
        mp[x, y] = int(255 * max(0, min(1, (dd - 0.55) / 0.3)) * max(0, min(1, (1.4 - dd) / 0.5)) * 0.5)
grid = ImageChops.multiply(grid, mask.resize((SS, SS), Image.BILINEAR))
bg = Image.composite(Image.new('RGB', (SS, SS), LIME), bg, grid)
# glow behind the coin
glow = Image.new('L', (SS, SS), 0); ImageDraw.Draw(glow).ellipse((SS * 0.22, SS * 0.2, SS * 0.78, SS * 0.76), fill=110)
bg = Image.composite(Image.new('RGB', (SS, SS), hexc('#b8f020')), bg, glow.filter(ImageFilter.GaussianBlur(SS * 0.09)))
# coin + shadow
coin = Image.open(src).convert('RGBA'); cs = int(SS * 0.96 * K); coin = coin.resize((cs, cs), Image.LANCZOS)
ox, oy = (SS - cs) // 2, (SS - cs) // 2 + int(SS * 0.01)
sh = Image.new('L', (SS, SS), 0); ImageDraw.Draw(sh).ellipse((SS / 2 - cs * 0.24, oy + cs * 0.86, SS / 2 + cs * 0.24, oy + cs * 0.93), fill=170)
bg = Image.composite(Image.new('RGB', (SS, SS), (0, 0, 0)), bg, sh.filter(ImageFilter.GaussianBlur(SS * 0.025)))
bg = bg.convert('RGBA'); bg.alpha_composite(coin, (ox, oy))
bg.convert('RGB').resize((S, S), Image.LANCZOS).save(out, quality=95); print('wrote', out)
