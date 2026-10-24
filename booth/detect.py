"""Find the transparent 'photo windows' in a frame PNG.

The largest fully transparent region that does not touch the image border
becomes one photo slot (returned as percentages of the image size). Works for
single frames and selects the largest complete opening as the camera window.
Admins can still fine-tune its position and size afterwards.
"""
from collections import deque

from PIL import Image

BLEED = 0.4  # percent; photo slightly overlaps the frame so there are no gaps


def detect_windows(fileobj, max_slots=1, fallback=True, detect_light=False):
    with Image.open(fileobj) as im:
        im = im.convert('RGBA')
        W, H = im.size
        k = 180 / max(W, H)
        gw, gh = max(1, round(W * k)), max(1, round(H * k))
        alpha = im.getchannel('A').resize((gw, gh), Image.BOX)
    data = list(alpha.getdata())
    hole = [a < 80 for a in data]
    seen = [False] * (gw * gh)
    comps = []
    for start in range(gw * gh):
        if not hole[start] or seen[start]:
            continue
        seen[start] = True
        q = deque([start])
        minx = maxx = start % gw
        miny = maxy = start // gw
        area = 0
        while q:
            p = q.popleft()
            x, y = p % gw, p // gw
            area += 1
            minx, maxx, miny, maxy = min(minx, x), max(maxx, x), min(miny, y), max(maxy, y)
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < gw and 0 <= ny < gh:
                    n = ny * gw + nx
                    if hole[n] and not seen[n]:
                        seen[n] = True
                        q.append(n)
        touches = minx == 0 or miny == 0 or maxx == gw - 1 or maxy == gh - 1
        comps.append({'area': area, 'touches': touches, 'box': (minx, miny, maxx + 1, maxy + 1)})

    min_area = 0.012 * gw * gh
    good = [c for c in comps if not c['touches'] and c['area'] >= min_area]
    if not good and fallback:
        good = sorted([c for c in comps if c['area'] >= min_area], key=lambda c: -c['area'])[:1]
    if not good:
        if detect_light:
            rgb = im.convert('RGB').resize((gw, gh), Image.BILINEAR)
            pixels = list(rgb.getdata())
            mask = [min(r, g, b) >= 225 and max(r, g, b) - min(r, g, b) <= 28 for r, g, b in pixels]
            light_seen = bytearray(gw * gh)
            light_boxes = []
            for start, is_light in enumerate(mask):
                if not is_light or light_seen[start]:
                    continue
                light_seen[start] = 1
                q = deque([start])
                minx = maxx = start % gw
                miny = maxy = start // gw
                area = 0
                while q:
                    p = q.popleft(); x, y = p % gw, p // gw; area += 1
                    minx, maxx = min(minx, x), max(maxx, x)
                    miny, maxy = min(miny, y), max(maxy, y)
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= nx < gw and 0 <= ny < gh:
                            n = ny * gw + nx
                            if mask[n] and not light_seen[n]:
                                light_seen[n] = 1; q.append(n)
                if area >= 0.012 * gw * gh and minx > 0 and miny > 0 and maxx < gw - 1 and maxy < gh - 1:
                    light_boxes.append((area, minx, miny, maxx + 1, maxy + 1))
            light_boxes.sort(reverse=True)
            if light_boxes:
                largest = light_boxes[0][0]
                light_boxes = [box for box in light_boxes if box[0] >= largest * .25][:max_slots]
                light_boxes.sort(key=lambda box: ((box[2] + box[4]) / 2, box[1] + box[3]))
                return [{'x': round(x0 / gw * 100, 2), 'y': round(y0 / gh * 100, 2),
                         'w': round((x1 - x0) / gw * 100, 2), 'h': round((y1 - y0) / gh * 100, 2)}
                        for _, x0, y0, x1, y1 in light_boxes]
        # Many PNG templates are exported with sample photos still baked into
        # clearly outlined windows. Detect repeated warm photo-frame borders
        # so those sample images can be replaced during capture too.
        rgb = im.convert('RGB').resize((gw, gh), Image.BILINEAR)
        pixels = list(rgb.getdata())
        mask = [r > 135 and r > g * 1.8 and r > b * 1.8 and g < 120 for r, g, b in pixels]
        row_runs = _runs([sum(mask[y * gw:(y + 1) * gw]) >= gw * .48 for y in range(gh)], 1)
        outlined = []
        row_i = 0
        while row_i + 1 < len(row_runs):
            top, top_end = row_runs[row_i]
            bottom, bottom_end = row_runs[row_i + 1]
            if not gh * .07 <= bottom - top <= gh * .48:
                row_i += 1
                continue
            column_counts = [sum(mask[y * gw + x] for y in range(top_end, bottom)) for x in range(gw)]
            verticals = [x for x, count in enumerate(column_counts) if count >= (bottom - top) * .5]
            if len(verticals) < 2:
                row_i += 1
                continue
            x0, x1 = min(verticals), max(verticals) + 1
            if not (x0 < gw / 2 < x1):
                row_i += 1
                continue
            if x1 - x0 < gw * .35 or x1 - x0 > gw * .96:
                row_i += 1
                continue
            # Inset past the colored outline: preserve its border on the final
            # composite and replace only the baked-in sample photo.
            inset_x = max(1, round((x1 - x0) * .018))
            inset_y = max(1, round((bottom_end - top) * .018))
            x0 += inset_x; x1 -= inset_x
            top += inset_y; bottom_end -= inset_y
            outlined.append((x0, top, x1, bottom_end))
            row_i += 2
            if len(outlined) >= max_slots:
                break
        if len(outlined) >= (1 if detect_light else 2):
            outlined.sort(key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)
            outlined = outlined[:max_slots]
            return [{'x': round(x0 / gw * 100, 2), 'y': round(y0 / gh * 100, 2),
                     'w': round((x1 - x0) / gw * 100, 2), 'h': round((y1 - y0) / gh * 100, 2)}
                    for x0, y0, x1, y1 in outlined]
        return [{'x': 10.0, 'y': 10.0, 'w': 80.0, 'h': 60.0}] if fallback else []

    good = sorted(good, key=lambda c: -c['area'])[:max_slots]
    biggest = good[0]['area']
    good = [c for c in good if c['area'] >= biggest * 0.25]

    # Keep the largest complete opening, ignoring smaller transparent details.
    good = good[:max_slots]

    # reading order: top to bottom, left to right within a row
    good.sort(key=lambda c: (c['box'][1] + c['box'][3]) / 2)
    rows, tol = [], 0.1 * gh
    for c in good:
        cy = (c['box'][1] + c['box'][3]) / 2
        if rows and cy - rows[-1][0] <= tol:
            rows[-1][1].append(c)
        else:
            rows.append([cy, [c]])
    ordered = [c for _, r in rows for c in sorted(r, key=lambda c: c['box'][0] + c['box'][2])]

    out = []
    for c in ordered:
        x0, y0, x1, y1 = c['box']
        x = max(0.0, x0 / gw * 100 - BLEED)
        y = max(0.0, y0 / gh * 100 - BLEED)
        w = min(100.0, x1 / gw * 100 + BLEED) - x
        h = min(100.0, y1 / gh * 100 + BLEED) - y
        out.append({'x': round(x, 2), 'y': round(y, 2), 'w': round(w, 2), 'h': round(h, 2)})
    return out


def _runs(flags, max_gap=1):
    """Return half-open spans of true values, joining a tiny anti-alias gap."""
    indexes = [i for i, flag in enumerate(flags) if flag]
    if not indexes:
        return []
    groups, start, previous = [], indexes[0], indexes[0]
    for i in indexes[1:]:
        if i - previous > max_gap + 1:
            groups.append((start, previous + 1))
            start = i
        previous = i
    groups.append((start, previous + 1))
    return groups
