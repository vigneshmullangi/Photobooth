"""Turn a *fake* transparent background (a checkerboard drawn into the pixels) into real transparency.

Only connected areas that really look like a two-tone checkerboard (white + light grey) are
removed, so solid white frames and white artwork are left alone. Existing alpha transparency is
preserved, including when a PNG mixes real transparency with checkerboard pixels.
"""
import io
from collections import deque

from PIL import Image, ImageChops, ImageFilter


def _mask(rgb, min_light, max_spread):
    r, g, b = rgb.split()
    mn = ImageChops.darker(ImageChops.darker(r, g), b)
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    light = mn.point(lambda v: 255 if v >= min_light else 0)
    grey = ImageChops.subtract(mx, mn).point(lambda v: 255 if v <= max_spread else 0)
    return ImageChops.multiply(light, grey), mn


def remove_checkerboard(fileobj):
    """Return PNG bytes with the checkerboard made transparent, or None if nothing to do."""
    with Image.open(fileobj) as src:
        im = src.convert('RGBA')
    W, H = im.size
    alpha = im.getchannel('A')

    rgb = im.convert('RGB')
    strict, mn = _mask(rgb, 175, 14)
    loose, _ = _mask(rgb, 140, 40)

    f = max(3, max(W, H) // 300)
    gw, gh = max(1, W // f), max(1, H // f)
    # Connect both checkerboard tones before finding regions. Looking for only
    # the white squares splits the pattern into tiny islands and misses patches.
    small = loose.resize((gw, gh), Image.BOX).point(lambda v: 255 if v >= 128 else 0)
    px = list(small.getdata())
    seen = [False] * (gw * gh)
    comps = []
    for s in range(gw * gh):
        if px[s] != 255 or seen[s]:
            continue
        seen[s] = True
        q, cells = deque([s]), []
        while q:
            p = q.popleft()
            cells.append(p)
            x, y = p % gw, p // gw
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < gw and 0 <= ny < gh:
                    n = ny * gw + nx
                    if px[n] == 255 and not seen[n]:
                        seen[n] = True
                        q.append(n)
        if len(cells) >= 0.0008 * gw * gh:
            comps.append(cells)

    remove = Image.new('L', (W, H), 0)
    for cells in comps:
        m = bytearray(gw * gh)
        for c in cells:
            m[c] = 255
        up = Image.frombytes('L', (gw, gh), bytes(m)).resize((W, H), Image.NEAREST)
        up = up.filter(ImageFilter.MaxFilter(2 * f + 1 if f < 12 else 25))
        # must contain BOTH tones of a checkerboard (white and light grey), not just flat white
        hist = mn.histogram(mask=ImageChops.multiply(up, strict))
        total = sum(hist)
        if not total or sum(hist[245:]) / total < .12 or sum(hist[170:240]) / total < .12:
            continue
        remove = ImageChops.lighter(remove, ImageChops.multiply(up, strict))

    if not remove.getbbox():
        return None
    soft = remove.filter(ImageFilter.GaussianBlur(.8))
    im.putalpha(ImageChops.subtract(alpha, soft))
    out = io.BytesIO()
    im.save(out, 'PNG', optimize=True)
    return out.getvalue()
