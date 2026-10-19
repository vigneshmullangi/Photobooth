'use strict';
/* =====================================================================
   Photobooth - simple flow
   Home -> Choose (Instant Frames 1-4 | Strip) -> Capture -> Result -> Studio
   ===================================================================== */

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const campaignConfig = JSON.parse($('campaignConfig').textContent);
const adminStudioConfig = JSON.parse($('adminStudioConfig')?.textContent || 'null');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
};
const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
};
const pad2 = n => String(n).padStart(2, '0');
const SAVED_TEMPLATES_KEY = 'photobooth.saved-templates.v1';
let editingSavedTemplateKey = null;
const fmtDate = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).replace(/,/g, '');
};
const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
};
let toastTimer;
function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}
const hexRgb = h => {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
const lumOf = hex => {
    const [r, g, b] = hexRgb(hex);
    return (.299 * r + .587 * g + .114 * b) / 255;
};

/* ---------- design data ---------- */
const DARK_INK = '#1c1b19';
const fontOption = (n, key, family, k, weight = 400, italic = false) => ({
    n, key, family, k, weight, italic,
    css: (px, bold = false, slant = italic) => `${slant ? 'italic' : 'normal'} ${bold ? 700 : weight} ${px}px ${family}`
});
const FONTS = [
    fontOption('Modern', 'modern', 'system-ui,-apple-system,"Segoe UI",sans-serif', .095, 700),
    fontOption('Elegant', 'serif', 'Georgia,"Times New Roman",serif', .1, 600, true),
    fontOption('Typewriter', 'mono', '"Courier New",Courier,monospace', .085, 700),
    fontOption('Script', 'script', '"Segoe Script","Brush Script MT",cursive', .14),
    fontOption('Bold', 'impact', 'Impact,"Arial Narrow",sans-serif', .11),
    fontOption('Bold sans', 'bold', 'Arial,Helvetica,sans-serif', .1, 700),
    fontOption('Display', 'display', 'Impact,"Arial Narrow",sans-serif', .11),
    fontOption('Rounded', 'rounded', '"Trebuchet MS",Arial,sans-serif', .1, 500),
    fontOption('Arial', 'arial', 'Arial,Helvetica,sans-serif', .1),
    fontOption('Verdana', 'verdana', 'Verdana,Geneva,sans-serif', .1),
    fontOption('Trebuchet MS', 'trebuchet', '"Trebuchet MS",Arial,sans-serif', .1),
    fontOption('Georgia', 'georgia', 'Georgia,serif', .1),
    fontOption('Times New Roman', 'times', '"Times New Roman",Times,serif', .1),
    fontOption('Courier New', 'courier', '"Courier New",Courier,monospace', .085),
    fontOption('Sans serif', 'inter', 'system-ui,-apple-system,"Segoe UI",sans-serif', .1, 500),
    fontOption('Classic serif', 'fraunces', 'Georgia,"Times New Roman",serif', .1, 600),
    fontOption('Bold serif', 'playfair', 'Georgia,"Times New Roman",serif', .1, 700),
    fontOption('Strong sans', 'montserrat', 'Arial,Helvetica,sans-serif', .1, 700),
    fontOption('Condensed', 'bebas', 'Impact,"Arial Narrow",sans-serif', .11),
    fontOption('Clean sans', 'dm-sans', 'Arial,Helvetica,sans-serif', .1, 500),
    fontOption('Rounded sans', 'poppins', '"Trebuchet MS",Arial,sans-serif', .1, 500),
    fontOption('Soft serif', 'lora', 'Georgia,"Times New Roman",serif', .1, 500),
    fontOption('Heavy serif', 'merriweather', 'Georgia,"Times New Roman",serif', .09, 700),
    fontOption('Narrow sans', 'oswald', '"Arial Narrow",Impact,sans-serif', .11, 500),
    fontOption('Handwriting', 'dancing-script', '"Segoe Script","Brush Script MT",cursive', .13, 600),
    fontOption('Rounded display', 'lobster', '"Trebuchet MS",Arial,sans-serif', .12, 700),
    fontOption('Friendly sans', 'nunito', '"Trebuchet MS",Arial,sans-serif', .1, 600),
    fontOption('Light sans', 'raleway', 'Arial,Helvetica,sans-serif', .1, 600),
    fontOption('Slab serif', 'roboto-slab', 'Rockwell,Georgia,serif', .1, 500),
    fontOption('Formal serif', 'cinzel', 'Georgia,"Times New Roman",serif', .1, 600),
    fontOption('Casual script', 'pacifico', '"Segoe Script","Brush Script MT",cursive', .12),
    fontOption('Alex Brush', 'alex-brush', '"Alex Brush",cursive', .15)
];
const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72, 96, 120];
const FONT_SIZE_BASE = 24;
const BG_COLORS = ['#ffffff', '#fff6fb', '#f6f2ea', '#ffe3f1', '#ffd9e4', '#ffe9c7', '#fff3c4', '#d9f6d0', '#d8f3e6', '#d6ecff', '#e5ddff', '#cfcfcf',
    '#111111', '#1d2433', '#15131c', '#e4492b', '#e0457b', '#f5c46b', '#3b82f6', '#2f9e6e'];
const BG_GRADS = [['#ffd9e4', '#ffb3cb'], ['#ff9966', '#ff5e62'], ['#a18cd1', '#fbc2eb'], ['#84fab0', '#8fd3f4'], ['#f6d365', '#fda085'], ['#15131c', '#2b2140'],
    ['#0f2027', '#2c5364'], ['#fdfbfb', '#ebedee'], ['#667eea', '#764ba2'], ['#fbc2eb', '#a6c1ee'], ['#e0c3fc', '#8ec5fc'], ['#ffecd2', '#fcb69f']];
const INK_COLORS = ['#1c1b19', '#ffffff', '#e4492b', '#e0457b', '#f5c46b', '#3b82f6', '#2f9e6e'];
const PEN_COLORS = ['#e4492b', '#1c1b19', '#ffffff', '#f5c46b', '#e0457b', '#3b82f6', '#2f9e6e', '#a78bfa'];
const PATTERNS = [
    ['none', 'None'], ['dots', 'Dots'], ['stripes', 'Stripes'], ['grid', 'Grid'], ['checker', 'Checker'],
    ['hearts', 'Hearts'], ['stars', 'Stars'], ['zigzag', 'Zigzag'], ['film', 'Film'], ['confetti', 'Confetti']
];
const STICKERS = {
    Love: ['\u{2764}\u{FE0F}', '\u{1F496}', '\u{1F495}', '\u{1F498}', '\u{1F49D}', '\u{1F49F}', '\u{1F60D}', '\u{1F970}', '\u{1F48B}', '\u{1F48C}', '\u{1F339}', '\u{1F48D}'],
    Party: ['\u{1F389}', '\u{1F388}', '\u{1F38A}', '\u{1F973}', '\u{1F382}', '\u{1F381}', '\u{1F37E}', '\u{1F942}', '\u{1F3A4}', '\u{1F3B6}', '\u{1F3B5}', '\u{1FAE9}'],
    Faces: ['\u{1F600}', '\u{1F60E}', '\u{1F929}', '\u{1F61C}', '\u{1F979}', '\u{1F607}', '\u{1F92A}', '\u{1F618}', '\u{1F648}', '\u{1F602}', '\u{1F60F}', '\u{1F917}'],
    Animals: ['\u{1F436}', '\u{1F431}', '\u{1F43C}', '\u{1F984}', '\u{1F400}', '\u{1F43B}', '\u{1F98A}', '\u{1F42E}', '\u{1F98B}', '\u{1F41D}', '\u{1F438}', '\u{1F427}'],
    Food: ['\u{1F355}', '\u{1F354}', '\u{1F35F}', '\u{1F369}', '\u{1F366}', '\u{1F353}', '\u{1F349}', '\u{2615}', '\u{1F96B}', '\u{1F36D}', '\u{1F36A}', '\u{1F352}'],
    Nature: ['\u{1F338}', '\u{1F33C}', '\u{1F33B}', '\u{1F308}', '\u{2600}\u{FE0F}', '\u{1F319}', '\u{1F334}', '\u{1F340}', '\u{1F525}', '\u{2744}\u{FE0F}', '\u{1F30A}', '\u{1F341}'],
    Style: ['\u{2728}', '\u{2B50}', '\u{1F31F}', '\u{1F4AB}', '\u{26A1}', '\u{1F48E}', '\u{1F451}', '\u{1F380}', '\u{1F5BC}\u{FE0F}', '\u{1F4F8}', '\u{1F3A7}', '\u{1F3C6}']
};
const FILTERS = {
    Normal: {},
    'B&W': {gr: 1, co: 1.15},
    Sepia: {se: .85, co: 1.05},
    Vivid: {sa: 1.5, co: 1.12, br: 1.03},
    Warm: {wa: 22, sa: 1.1, br: 1.04},
    Cool: {wa: -22, sa: 1.05},
    Vintage: {se: .35, co: .92, sa: .8, li: 18, wa: 10},
    Dreamy: {br: 1.08, co: .88, sa: 1.1, li: 22},
    Noir: {gr: 1, co: 1.4, br: .92},
    Fade: {co: .85, sa: .7, li: 25}
};
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/* Ready-made strips. */
const STRIPS = [
    {id: 'classic', name: 'Gallery white', n: 3, bg: {mode: 'color', c1: '#faf9f6'}},
    {id: 'noir', name: 'Noir', n: 3, bg: {mode: 'color', c1: '#17191d'}, pattern: {id: 'film', color: '#ffffff', alpha: .12}, filter: 'Noir'},
    {id: 'midnight', name: 'Midnight blue', n: 3, bg: {mode: 'gradient', c1: '#17263c', c2: '#263d58'}, pattern: {id: 'dots', color: '#ffffff', alpha: .045}},
    {id: 'blush', name: 'Soft blush', n: 3, bg: {mode: 'gradient', c1: '#f6e6e2', c2: '#f1d4d0'}},
    {id: 'confetti', name: 'Celebration', n: 3, bg: {mode: 'color', c1: '#fffaf0'}, pattern: {id: 'confetti', color: '#b9875a', alpha: .16}},
    {id: 'sunset', name: 'Warm sand', n: 3, bg: {mode: 'gradient', c1: '#f5e5d0', c2: '#edc7ad'}, filter: 'Warm'},
    {id: 'mint', name: 'Sage', n: 3, bg: {mode: 'gradient', c1: '#edf1e9', c2: '#d8e3d4'}, pattern: {id: 'grid', color: '#4b6655', alpha: .045}},
    {id: 'retro', name: 'Terracotta', n: 3, bg: {mode: 'gradient', c1: '#f2e4d6', c2: '#e9cfb6'}, filter: 'Vintage'}
];

/* ---------- layouts (document units = px) ---------- */
function makeLayout(kind, n) {
    const pad = 50, gap = 30;
    if (kind === 'single') {
        return {kind, n: 1, W: 800, H: 1000, slots: [{x: 50, y: 50, w: 700, h: 700}], foot: {y: 775, h: 200}};
    }
    if (kind === 'grid') {
        const s = 400, slots = [];
        for (let i = 0; i < 4; i++) slots.push({x: pad + (i % 2) * (s + gap), y: pad + Math.floor(i / 2) * (s + gap), w: s, h: s});
        return {kind, n: 4, W: 930, H: 1080, slots, foot: {y: 890, h: 175}};
    }
    const w = 500, h = 375, slots = [];
    for (let i = 0; i < n; i++) slots.push({x: pad, y: pad + i * (h + gap), w, h});
    const fy = pad + n * h + (n - 1) * gap + 12;
    return {kind: 'stack', n, W: 600, H: fy + 180 + 10, slots, foot: {y: fy, h: 175}};
}
function makeStripLayout(n) {
    const W = 600, pad = 34, gap = 18, slotW = W - pad * 2, slotH = 396;
    const slots = Array.from({length: n}, (_, i) => ({x: pad, y: pad + i * (slotH + gap), w: slotW, h: slotH}));
    const H = pad * 2 + n * slotH + (n - 1) * gap;
    return {kind: 'strip', n, W, H, slots, foot: {y: H - pad, h: pad}};
}
const layoutFor = (mode, n) => mode === 'strip' ? makeStripLayout(n) : (n === 1 ? makeLayout('single', 1) : n === 4 ? makeLayout('grid', 4) : makeLayout('stack', n));

/* ---------- document ---------- */
function newDoc(layout, p = {}) {
    const bg = p.bg || {mode: 'color', c1: '#ffffff'};
    const pt = p.pattern || {};
    return {
        layout,
        overlayOnly: !!p.overlayOnly,
        bg: {mode: bg.mode, c1: bg.c1, c2: bg.c2 || bg.c1, imgId: null, preset: bg.preset || ''},
        pattern: {id: pt.id || 'none', color: pt.color || null, alpha: pt.alpha ?? .14, size: pt.size ?? 1},
        text: {caption: p.caption || '', items: p.caption ? [{id: 1, value: p.caption}] : [], nextItemId: 2, font: p.font ?? 0, color: p.ink || null, size: 1, bold: false, italic: false, showDate: false, date: '', location: ''},
        filter: p.filter || 'Normal',
        stickers: [],
        strokes: [],
        nid: 1
    };
}

/* images used as background (kept outside the JSON history) */
const IMGS = {};
let imgSeq = 1;

function bgLum(d) {
    const b = d.bg;
    if (b.mode === 'transparent') return 1;
    if (b.mode === 'color') return lumOf(b.c1);
    if (b.mode === 'gradient') return (lumOf(b.c1) + lumOf(b.c2)) / 2;
    return IMGS[b.imgId] ? IMGS[b.imgId].lum : .5;
}
const inkOf = d => d.text.color || (bgLum(d) < .5 ? '#ffffff' : DARK_INK);

/* ---------- photo filters (pixel based, works in every browser) ---------- */
function applyFilter(src, name) {
    const f = FILTERS[name];
    if (!f || name === 'Normal') return src;
    const c = mk(src.width, src.height), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    const img = x.getImageData(0, 0, c.width, c.height), a = img.data;
    const {br = 1, co = 1, sa = 1, gr = 0, se = 0, wa = 0, li = 0} = f;
    for (let i = 0; i < a.length; i += 4) {
        let r = (a[i] * br - 128) * co + 128, g = (a[i + 1] * br - 128) * co + 128, b = (a[i + 2] * br - 128) * co + 128;
        const l = .299 * r + .587 * g + .114 * b;
        if (sa !== 1) { r = l + (r - l) * sa; g = l + (g - l) * sa; b = l + (b - l) * sa; }
        if (gr) { r += (l - r) * gr; g += (l - g) * gr; b += (l - b) * gr; }
        if (se) {
            const sr = .393 * r + .769 * g + .189 * b, sg = .349 * r + .686 * g + .168 * b, sb = .272 * r + .534 * g + .131 * b;
            r += (sr - r) * se; g += (sg - g) * se; b += (sb - b) * se;
        }
        if (wa) { r += wa; b -= wa; }
        if (li) { const k = 1 - li / 255; r = r * k + li; g = g * k + li; b = b * k + li; }
        a[i] = r; a[i + 1] = g; a[i + 2] = b;
    }
    x.putImageData(img, 0, 0);
    return c;
}

/* ---------- rendering ---------- */
function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function heart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * .9);
    ctx.bezierCurveTo(x - s * 1.3, y + s * .1, x - s * .8, y - s * .9, x, y - s * .3);
    ctx.bezierCurveTo(x + s * .8, y - s * .9, x + s * 1.3, y + s * .1, x, y + s * .9);
    ctx.closePath();
}
function star(ctx, x, y, R) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * .45 : R;
        ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
}
function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* size + clamped offset of a zoomed/panned background image */
function bgBox(b, L, iw, ih) {
    const z = clamp(b.zoom || 1, .5, 4), k = Math.max(L.W / iw, L.H / ih) * z, w = iw * k, h = ih * k;
    const mx = Math.max(0, (w - L.W) / 2), my = Math.max(0, (h - L.H) / 2);
    return {w, h, mx, my, ox: clamp(b.ox || 0, -mx, mx), oy: clamp(b.oy || 0, -my, my)};
}
function bgImgBox(d) {
    const r = IMGS[d.bg.imgId];
    if (!r) return null;
    return bgBox(d.bg, d.layout, r.img.naturalWidth || r.img.width, r.img.naturalHeight || r.img.height);
}

function drawBg(ctx, d, L) {
    const b = d.bg;
    if (b.mode === 'transparent') return;
    if (b.mode === 'image' && IMGS[b.imgId]) {
        const im = IMGS[b.imgId].img, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
        const bx = bgBox(b, L, iw, ih);
        ctx.fillStyle = b.c1 || '#ffffff'; ctx.fillRect(0, 0, L.W, L.H);
        ctx.drawImage(im, (L.W - bx.w) / 2 + bx.ox, (L.H - bx.h) / 2 + bx.oy, bx.w, bx.h);
        return;
    }
    if (b.mode === 'gradient') {
        const g = ctx.createLinearGradient(0, 0, L.W * .55, L.H);
        g.addColorStop(0, b.c1);
        g.addColorStop(1, b.c2);
        ctx.fillStyle = g;
    } else ctx.fillStyle = b.c1;
    ctx.fillRect(0, 0, L.W, L.H);
}

function drawPattern(ctx, d, W, H) {
    const p = d.pattern;
    if (!p || p.id === 'none') return;
    const col = p.color || (bgLum(d) < .5 ? '#ffffff' : '#000000');
    const u = 40 * p.size;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    switch (p.id) {
        case 'dots':
            for (let y = u / 2, r = 0; y < H + u; y += u, r++)
                for (let x = r % 2 ? u : u / 2; x < W + u; x += u) { ctx.beginPath(); ctx.arc(x, y, u * .14, 0, 7); ctx.fill(); }
            break;
        case 'stripes':
            ctx.lineWidth = u * .22;
            for (let x = -H; x < W; x += u * .9) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke(); }
            break;
        case 'grid':
            ctx.lineWidth = Math.max(1.5, 2 * p.size);
            for (let x = 0; x <= W; x += u) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
            for (let y = 0; y <= H; y += u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
            break;
        case 'checker':
            for (let j = 0; j * u < H; j++) for (let i = 0; i * u < W; i++) if ((i + j) % 2 === 0) ctx.fillRect(i * u, j * u, u, u);
            break;
        case 'hearts': {
            const s = u * 1.3;
            for (let y = s / 2, r = 0; y < H + s; y += s, r++)
                for (let x = r % 2 ? s : s / 2; x < W + s; x += s) heart(ctx, x, y, u * .3), ctx.fill();
            break;
        }
        case 'stars': {
            const s = u * 1.4;
            for (let y = s / 2, r = 0; y < H + s; y += s, r++)
                for (let x = r % 2 ? s : s / 2; x < W + s; x += s) star(ctx, x, y, u * .3), ctx.fill();
            break;
        }
        case 'zigzag':
            ctx.lineWidth = 3 * p.size; ctx.lineJoin = 'round';
            for (let y = u * .6; y < H + u; y += u) {
                ctx.beginPath();
                for (let x = 0, k = 0; x <= W + u; x += u * .4, k++) ctx[k ? 'lineTo' : 'moveTo'](x, y + (k % 2 ? -1 : 1) * u * .16);
                ctx.stroke();
            }
            break;
        case 'film': {
            const sp = 52 * p.size, hw = 22, hh = 30;
            for (let y = sp / 2 - hh / 2; y < H; y += sp) {
                rr(ctx, 14, y, hw, hh, 5); ctx.fill();
                rr(ctx, W - 14 - hw, y, hw, hh, 5); ctx.fill();
            }
            break;
        }
        case 'confetti': {
            const rnd = seeded(7), cols = ['#ff5c8a', '#ffc53d', '#3ddc97', '#4cc9f0', '#a78bfa'];
            const n = Math.round(W * H / 7000 / p.size);
            for (let i = 0; i < n; i++) {
                ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
                const x = rnd() * W, y = rnd() * H, s = (7 + rnd() * 10) * p.size;
                ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * 6.28);
                if (rnd() < .35) { ctx.beginPath(); ctx.arc(0, 0, s * .45, 0, 7); ctx.fill(); } else ctx.fillRect(-s / 2, -s / 4, s, s / 2);
                ctx.restore();
            }
            break;
        }
    }
    ctx.restore();
}

const PHOTO_SHAPES = [
    {id:'square', label:'Square'}, {id:'circle', label:'Circle'},
    {id:'diamond', label:'Diamond'}, {id:'heart', label:'Heart'}
];
function heartShapePoints() {
    const segments = [
        [[50,96],[32,84],[5,63],[5,39]],
        [[5,39],[5,13],[31,8],[50,30]],
        [[50,30],[69,8],[95,13],[95,39]],
        [[95,39],[95,63],[68,84],[50,96]]
    ];
    const points = [];
    segments.forEach(([p0,p1,p2,p3]) => {
        for (let i=0; i<12; i++) {
            const t=i/12, u=1-t;
            points.push([u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]]);
        }
    });
    return points;
}
function photoShapePath(ctx, s, corner = 0) {
    const shape = s.shape || 'square', cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    ctx.beginPath();
    if (shape === 'circle') { const r = Math.min(s.w, s.h) / 2; ctx.arc(cx, cy, r, 0, Math.PI * 2); }
    else if (shape === 'diamond') { ctx.moveTo(cx, s.y); ctx.lineTo(s.x+s.w, cy); ctx.lineTo(cx, s.y+s.h); ctx.lineTo(s.x, cy); ctx.closePath(); }
    else if (shape === 'heart') {
        ctx.moveTo(s.x+s.w*.5,s.y+s.h*.96);
        ctx.bezierCurveTo(s.x+s.w*.32,s.y+s.h*.84,s.x+s.w*.05,s.y+s.h*.63,s.x+s.w*.05,s.y+s.h*.39);
        ctx.bezierCurveTo(s.x+s.w*.05,s.y+s.h*.13,s.x+s.w*.31,s.y+s.h*.08,s.x+s.w*.5,s.y+s.h*.3);
        ctx.bezierCurveTo(s.x+s.w*.69,s.y+s.h*.08,s.x+s.w*.95,s.y+s.h*.13,s.x+s.w*.95,s.y+s.h*.39);
        ctx.bezierCurveTo(s.x+s.w*.95,s.y+s.h*.63,s.x+s.w*.68,s.y+s.h*.84,s.x+s.w*.5,s.y+s.h*.96);
        ctx.closePath();
    } else if (corner) rr(ctx,s.x,s.y,s.w,s.h,corner);
    else ctx.rect(s.x,s.y,s.w,s.h);
}
function photoShapeClipCSS(shape) {
    if (shape === 'circle') return 'circle(closest-side at 50% 50%)';
    if (shape === 'diamond') return 'polygon(50% 0,100% 50%,50% 100%,0 50%)';
    if (shape === 'heart') return `polygon(${heartShapePoints().map(([x,y])=>`${x}% ${y}%`).join(',')})`;
    return 'none';
}
function drawSlot(ctx, s, photo, sc, corner = 8, slotIndex = 0, showPlaceholder = false) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.22)';
    ctx.shadowBlur = 14 * sc;
    ctx.shadowOffsetY = 4 * sc;
    ctx.fillStyle = '#fff';
    photoShapePath(ctx, s, !s.shape || s.shape === 'square' ? corner : 0);
    ctx.fill();
    ctx.restore();
    ctx.save();
    photoShapePath(ctx, s, !s.shape || s.shape === 'square' ? corner : 0);
    ctx.clip();
    if (photo) {
        const scale = Math.max(s.w / photo.width, s.h / photo.height);
        const cropW = s.w / scale, cropH = s.h / scale;
        ctx.drawImage(photo, (photo.width - cropW) / 2, (photo.height - cropH) / 2, cropW, cropH, s.x, s.y, s.w, s.h);
    }
    else if (showPlaceholder) {
        ctx.drawImage(placeholder(s.w, s.h, slotIndex), s.x, s.y, s.w, s.h);
    } else { ctx.fillStyle = '#e4dfd3'; ctx.fillRect(s.x, s.y, s.w, s.h); }
    ctx.restore();
}

function drawFooter(ctx, d, L, sc) {
    const t = d.text, f = L.foot, W = L.W;
    const sub = t.showDate && t.date ? fmtDate(t.date) : '';
    const location = String(t.location || '').trim();
    const items = t.items || (t.caption ? [{id: 1, value: t.caption}] : []);
    const captions = items.filter(item => String(item.value || '').trim());
    if (!captions.length && !sub && !location) return;
    ctx.save();
    ctx.textBaseline = 'middle';
    if (d.bg.mode === 'image') { ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 8 * sc; }
    const maxW = W - 48;
    captions.forEach((item, index) => {
        const fo = FONTS[item.font ?? t.font] || FONTS[0];
        const pxScale = item.size || t.size || 1;
        let px = Math.round(fo.k * W * pxScale);
        const bold = item.bold ?? t.bold;
        const italic = item.italic ?? t.italic;
        ctx.font = fo.css(px, bold, italic);
        const value = String(item.value).trim(), lines = value.split(/\r?\n/);
        const maxLineWidth = () => Math.max(...lines.map(line => ctx.measureText(line || ' ').width));
        const width = maxLineWidth();
        if (width > maxW) { px = Math.floor(px * maxW / width); ctx.font = fo.css(px, bold, italic); }
        const x = Number.isFinite(item.x) ? item.x : W / 2;
        const y = Number.isFinite(item.y) ? item.y : L.H / 2 + (index - (captions.length - 1) / 2) * L.H * .07;
        ctx.save(); ctx.translate(x, y); ctx.rotate(item.rotation || 0);
        ctx.fillStyle = item.color || inkOf(d);
        const align = item.align || t.align || 'center';
        ctx.textAlign = align;
        const lineHeight = px * 1.12;
        const lineY = lineIndex => (lineIndex - (lines.length - 1) / 2) * lineHeight;
        lines.forEach((line, lineIndex) => ctx.fillText(line, 0, lineY(lineIndex), maxW));
        ctx.restore();
        if (item.underline ?? t.underline) {
            ctx.save(); ctx.translate(x,y); ctx.rotate(item.rotation || 0); ctx.strokeStyle = item.color || inkOf(d); ctx.lineWidth = Math.max(1, px * .055);
            lines.forEach((line, lineIndex) => {
                const textWidth = Math.min(ctx.measureText(line).width, maxW);
                const localX = align === 'left' ? 0 : align === 'right' ? -textWidth : -textWidth/2;
                ctx.beginPath(); ctx.moveTo(localX, lineY(lineIndex) + px*.42); ctx.lineTo(localX+textWidth, lineY(lineIndex) + px*.42); ctx.stroke();
            });
            ctx.restore();
        }
    });
    if (sub) {
        let px = Math.round(W * .042 * (t.size || 1));
        const fo = FONTS[d.text.font] || FONTS[0];
        ctx.font = fo.css(px, t.bold, t.italic);
        const w = ctx.measureText(sub).width;
        if (w > maxW) { px = Math.floor(px * maxW / w); ctx.font = fo.css(px, t.bold, t.italic); }
        const dateY = Number.isFinite(t.dateY) ? t.dateY : L.H / 2;
        ctx.save(); ctx.translate(Number.isFinite(t.dateX) ? t.dateX : W / 2, dateY); ctx.rotate(t.dateRotation || 0);
        ctx.fillStyle = inkOf(d);
        const dateAlign = t.dateAlign || 'center'; ctx.textAlign = dateAlign;
        ctx.globalAlpha = .78;
        ctx.fillText(sub, 0, 0, maxW);
        if (t.dateUnderline ?? t.underline) { const tw = Math.min(ctx.measureText(sub).width,maxW), left = dateAlign === 'left' ? 0 : dateAlign === 'right' ? -tw : -tw/2; ctx.globalAlpha = .78; ctx.beginPath(); ctx.moveTo(left,px*.42); ctx.lineTo(left+tw,px*.42); ctx.lineWidth=Math.max(1,px*.055); ctx.strokeStyle=inkOf(d); ctx.stroke(); }
        ctx.restore();
    }
    if (location) {
        let px = Math.round(W * .038 * (t.size || 1));
        const fo = FONTS[t.font] || FONTS[0];
        ctx.font = fo.css(px, t.bold, t.italic);
        const w = ctx.measureText(location).width;
        if (w > maxW) { px = Math.floor(px * maxW / w); ctx.font = fo.css(px, t.bold, t.italic); }
        const locationY = Number.isFinite(t.locationY) ? t.locationY : L.H * .57;
        ctx.save(); ctx.translate(Number.isFinite(t.locationX) ? t.locationX : W / 2, locationY); ctx.rotate(t.locationRotation || 0);
        const locationAlign = t.locationAlign || 'center'; ctx.fillStyle = inkOf(d); ctx.textAlign = locationAlign; ctx.globalAlpha = .88;
        ctx.fillText(location, 0, 0, maxW);
        if (t.locationUnderline ?? t.underline) { const tw = Math.min(ctx.measureText(location).width,maxW), left = locationAlign === 'left' ? 0 : locationAlign === 'right' ? -tw : -tw/2; ctx.beginPath(); ctx.moveTo(left,px*.42); ctx.lineTo(left+tw,px*.42); ctx.lineWidth=Math.max(1,px*.055); ctx.strokeStyle=inkOf(d); ctx.stroke(); }
        ctx.restore();
    }
    ctx.restore();
}

function drawSticker(ctx, s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.r);
    if (s.src) {
        let image = logoImages.get(s.src);
        if (!image) { image = new Image(); image.onload = () => { if (!cv.hidden) draw(); }; image.src = s.src; logoImages.set(s.src, image); }
        if (image.complete && image.naturalWidth) {
            const box = stickerBox(s, image);
            ctx.drawImage(image, -box.w / 2, -box.h / 2, box.w, box.h);
        }
        ctx.restore();
        return;
    }
    ctx.font = `${Math.round(s.s)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(s.e, 0, 0);
    ctx.restore();
}

function stickerBox(s, image = s.src && logoImages.get(s.src)) {
    if (!s.src || !image || !image.naturalWidth || !image.naturalHeight) return {w: s.s, h: s.s};
    const ratio = Math.min(s.s / image.naturalWidth, s.s / image.naturalHeight);
    return {w: image.naturalWidth * ratio, h: image.naturalHeight * ratio};
}

function drawSelection(ctx, s, k) {
    const box = stickerBox(s), hx = box.w / 2, hy = box.h / 2;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.r);
    ctx.strokeStyle = '#e4492b';
    ctx.lineWidth = 2 * k;
    ctx.setLineDash([6 * k, 5 * k]);
    ctx.strokeRect(-hx, -hy, box.w, box.h);
    ctx.setLineDash([]);
    const R = 13 * k;
    // delete handle (top-left)
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-hx, -hy, R, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.lineWidth = 2.2 * k;
    const q = R * .42;
    ctx.moveTo(-hx - q, -hy - q); ctx.lineTo(-hx + q, -hy + q); ctx.moveTo(-hx + q, -hy - q); ctx.lineTo(-hx - q, -hy + q); ctx.stroke();
    // scale/rotate handle (bottom-right)
    ctx.fillStyle = '#e4492b';
    ctx.beginPath(); ctx.arc(hx, hy, R, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * k; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(hx, hy, R * .5, Math.PI * .15, Math.PI * 1.35); ctx.stroke();
    ctx.restore();
}

/* drawing layer (pen + eraser strokes) */
function strokePath(x, s) {
    x.save();
    x.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
    x.strokeStyle = s.c;
    x.lineWidth = s.w;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.beginPath();
    const p = s.p;
    x.moveTo(p[0][0], p[0][1]);
    if (p.length === 1) x.lineTo(p[0][0] + .01, p[0][1]);
    for (let i = 1; i < p.length; i++) x.lineTo(p[i][0], p[i][1]);
    x.stroke();
    x.restore();
}
function buildLayer(d, sc) {
    const L = d.layout, c = mk(L.W * sc, L.H * sc), x = c.getContext('2d');
    x.scale(sc, sc);
    d.strokes.forEach(s => strokePath(x, s));
    return c;
}
const live = {c: null, sc: 1, dirty: true};
function liveLayer(sc) {
    if (live.dirty || !live.c || live.sc !== sc || live.c.width !== Math.round(doc.layout.W * sc)) {
        live.c = buildLayer(doc, sc);
        live.sc = sc;
        live.dirty = false;
    }
    return live.c;
}

function render(ctx, d, o) {
    const L = d.layout, sc = o.sc || 1;
    ctx.save();
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    drawBg(ctx, d, L);
    drawPattern(ctx, d, L.W, L.H);
    L.slots.forEach((s, i) => {
        const photo = o.photos && o.photos[i];
        if (photo || !d.overlayOnly) {
            const corner = L.kind === 'server' && !activeServerTransparentSlots[i] ? Math.min(s.w, s.h) * .08 : 0;
            drawSlot(ctx, s, photo, sc, corner, i, !!o.placeholderSlots);
        }
    });
    if (activeServerFrame && L.kind === 'server') { ctx.drawImage(activeServerFrame, 0, 0, L.W, L.H); drawFrameTexts(ctx, L); }
    drawFooter(ctx, d, L, sc);
    d.stickers.forEach(s => drawSticker(ctx, s));
    if (o.layer) ctx.drawImage(o.layer, 0, 0, L.W, L.H);
    if (o.sel) { const s = d.stickers.find(z => z.id === o.sel); if (s) drawSelection(ctx, s, o.k || 1); }
    ctx.restore();
}

/* Portrait camera-window previews; these are never included in an export. */
const PH_COLORS = [['#cbdaf4', '#a9bee8'], ['#cce8c9', '#a9d6a7'], ['#f4dfac', '#e9c66f'], ['#f1c9bd', '#e9a99a']];
const PH_PALETTES = [
    {sky: ['#cbdaf4', '#a9bee8']},
    {sky: ['#cce8c9', '#a9d6a7']},
    {sky: ['#f4dfac', '#e9c66f']},
    {sky: ['#f1c9bd', '#e9a99a']}
];
const phCache = {};
function placeholder(w, h, i = 0) {
    const variant = ((i % PH_PALETTES.length) + PH_PALETTES.length) % PH_PALETTES.length;
    const key = `${w}x${h}-${variant}`;
    if (phCache[key]) return phCache[key];
    const k = 260 / Math.max(w, h), c = mk(w * k, h * k), x = c.getContext('2d'), W = c.width, H = c.height;
    const palette = PH_PALETTES[variant];
    const sky = x.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, palette.sky[0]); sky.addColorStop(1, palette.sky[1]);
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,.64)';
    x.beginPath(); x.arc(W * .5, H * .37, Math.min(W, H) * .14, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(W * .5, H * 1.02, W * .32, H * .39, 0, 0, Math.PI * 2); x.fill();
    return phCache[key] = c;
}
function previewCanvas(layout, style, targetW, offset = 0) {
    const d = newDoc(layout, style);
    const sc = targetW / layout.W, c = mk(layout.W * sc, layout.H * sc);
    render(c.getContext('2d'), d, {sc, photos: layout.slots.map((s, i) => placeholder(s.w, s.h, i + offset))});
    return c;
}

/* =====================================================================
   App state + navigation
   ===================================================================== */
let doc = null;            // the design being edited
let selectedCaptionId = null;
let selectedTextIsDate = false;
let selectedTextIsLocation = false;
let selectedSlotIndex = 0;
let photos = [];           // captured photo canvases (at slot aspect)
let photoVer = 0;
let flow = {mode: 'instant', n: 1, preset: null, layout: null};
let serverTextSel = null;
/* ---------- editable text on server frames (names, year, date...) ---------- */
const FRAME_FONTS = {
    ...Object.fromEntries(FONTS.map(font => [font.key, (px, bold = false, italic = false) => font.css(px, bold, italic)]))
};
const textKey = t => `photobooth-frame-text-${t.id}`;
function loadTextValues(t) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(textKey(t)) || '{}') || {}; } catch { saved = {}; }
    const out = {};
    (t.texts || []).forEach(f => {
        const value = saved[f.id];
        const fallback = f.type === 'upload' ? '' : f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(f.text || '') ? '' : f.text || '';
        const state = typeof value === 'string' ? {value} : value && typeof value === 'object' ? {...value} : {value: fallback};
        if (f.type === 'upload' && state.value && !String(state.value).startsWith('data:image/')) state.value = fallback;
        if (f.type === 'date' && state.value && !/^\d{4}-\d{2}-\d{2}$/.test(state.value)) state.value = '';
        out[f.id] = state;
    });
    return out;
}
function frameTextState(f) {
    const saved = flow.textValues[f.id];
    if (typeof saved === 'string') flow.textValues[f.id] = {value: saved};
    if (!flow.textValues[f.id] || typeof flow.textValues[f.id] !== 'object') flow.textValues[f.id] = {value: f.text || ''};
    return flow.textValues[f.id];
}
function saveTextValues() {
    if (!flow || !flow.serverTemplate) return;
    saveFrameTextValues(flow.serverTemplate, flow.textValues);
}
function saveFrameTextValues(template, values) {
    try { localStorage.setItem(textKey(template), JSON.stringify(values)); } catch { /* private mode */ }
}
function loadFrameFonts(t) {
    if (!document.fonts || !(t.texts || []).length) return Promise.resolve();
    const jobs = [...new Set(t.texts.map(f => f.font))].map(k => document.fonts.load(FRAME_FONTS[k] ? FRAME_FONTS[k](40) : '40px serif', 'Aa0'));
    return Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(r, 2500))]);
}
const FRAME_UPLOADS = new Map();
function loadFrameUpload(id, src) {
    if (!src) return null;
    const existing = FRAME_UPLOADS.get(String(id));
    if (existing && existing.src === src) return existing.image.complete && existing.image.naturalWidth ? existing.image : null;
    const image = new Image();
    FRAME_UPLOADS.set(String(id), {src, image});
    image.onload = () => refreshFrameText();
    image.src = src;
    return image.complete && image.naturalWidth ? image : null;
}
function drawFrameTexts(ctx, L, t = flow && flow.serverTemplate, values = flow && flow.textValues) {
    if (!t || !t.texts || !t.texts.length || !values) return;
    t.texts.forEach(f => {
        const saved = values[f.id];
        const state = typeof saved === 'string' ? {value: saved} : saved || {};
        if (state.hidden) return;
        // Keep administrator-defined text boxes inside the frame. A box near
        // the bottom edge otherwise centers its baseline beyond the canvas.
        const bx = clamp(Number.isFinite(state.x) ? state.x * L.W : Number(f.x) * L.W || 0, 0, L.W - 1);
        const by = clamp(Number.isFinite(state.y) ? state.y * L.H : Number(f.y) * L.H || 0, 0, L.H - 1);
        const bw = clamp(Number.isFinite(state.w) ? state.w * L.W : Number(f.w) * L.W || L.W, 1, L.W - bx);
        const bh = clamp(Number.isFinite(state.h) ? state.h * L.H : Number(f.h) * L.H || 1, 1, L.H - by);
        const rotation = Number(state.rotation) || 0;
        if ((f.type || 'text') === 'upload') {
            const image = loadFrameUpload(f.id, state.value || f.image);
            if (!image) return;
            ctx.save();
            ctx.translate(bx + bw / 2, by + bh / 2); ctx.rotate(rotation);
            ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.clip();
            const scale = Math.min(bw / image.naturalWidth, bh / image.naturalHeight);
            const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
            ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih);
            ctx.restore();
            return;
        }
        let v = String(state.value ?? (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(f.text || '') ? '' : f.text || '')).trim();
        if (!v) return;
        if (f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = fmtDate(v);
        if (f.upper) v = v.toUpperCase();
        const lines = v.split(/\r?\n/);
        const font = FRAME_FONTS[state.font || f.font] || FRAME_FONTS.modern;
        const bold = state.bold ?? f.bold ?? false;
        const italic = state.italic ?? f.italic ?? false;
        const effect = state.effect || f.effect || 'none';
        let px = Math.max(8, Math.round(bh * .86 / lines.length * (state.size || f.fontSize || 1)));
        ctx.save();
        ctx.translate(bx + bw / 2, by + bh / 2); ctx.rotate(rotation);
        ctx.font = font(px, bold, italic);
        const maxLineWidth = () => Math.max(...lines.map(line => ctx.measureText(line || ' ').width));
        const maxWidth = maxLineWidth();
        const fitScale = Math.min(1, bw / maxWidth, bh / (px * lines.length * 1.15));
        if (fitScale < 1) { px = Math.max(8, Math.floor(px * fitScale)); ctx.font = font(px, bold, italic); }
        ctx.fillStyle = state.color || f.color || '#000';
        ctx.textBaseline = 'middle';
        const align = state.align || f.align || 'center';
        ctx.textAlign = align;
        const ax = align === 'left' ? -bw / 2 : align === 'right' ? bw / 2 : 0;
        const lineHeight = Math.min(px * 1.15, bh / lines.length);
        const lineY = index => (index - (lines.length - 1) / 2) * lineHeight;
        if (effect === 'shadow') {
            ctx.shadowColor = 'rgba(0,0,0,.35)';
            ctx.shadowBlur = Math.max(1, px * .12);
            ctx.shadowOffsetY = Math.max(1, px * .06);
        } else if (effect === 'outline') {
            ctx.lineWidth = Math.max(1, px * .055);
            ctx.strokeStyle = state.color || f.color || '#000';
            lines.forEach((line, index) => ctx.strokeText(line, ax, lineY(index), bw));
            ctx.fillStyle = '#fff';
        }
        lines.forEach((line, index) => ctx.fillText(line, ax, lineY(index), bw));
        if (f.underline) {
            ctx.lineWidth = Math.max(1, px * .04); ctx.strokeStyle = state.color || f.color || '#000';
            lines.forEach((line, index) => {
                const textWidth = Math.min(ctx.measureText(line).width, bw);
                const lineX = align === 'left' ? ax : align === 'right' ? ax - textWidth : -textWidth / 2;
                ctx.beginPath(); ctx.moveTo(lineX, lineY(index) + px * .55); ctx.lineTo(lineX + textWidth, lineY(index) + px * .55); ctx.stroke();
            });
        }
        ctx.restore();
    });
}
function refreshFrameText() {
    if (!flow || !flow.serverTemplate) return;
    if (view === 'capture') updateServerCameraWindow();
    if (!$('v-studio').hidden) draw();
    else if (view === 'result') drawResult();
}

function buildStudioFrameFields(t) {
    const host = $('serverTextFields'), uploadHost = $('serverUploadFields');
    host.innerHTML = '';
    uploadHost.innerHTML = '';
    const fields = t && t.texts || [];
    $('serverTextTools').hidden = !fields.some(field => field.type !== 'upload');
    $('serverUploadTools').hidden = !fields.some(field => field.type === 'upload');
    if (!fields.length) return;
    t.texts.forEach(f => {
        const targetHost = f.type === 'upload' ? uploadHost : host;
        const state = frameTextState(f), row = el('div', `server-text-field${state.hidden ? ' is-hidden' : ''}`);
        row.dataset.fieldId = f.id;
        const title = el('b', 'server-text-label'); title.textContent = f.label;
        row.appendChild(title);
        const visibility = el('button', 'server-text-visibility', state.hidden ? 'Show field' : 'Hide field');
        visibility.type = 'button';
        visibility.onclick = () => { state.hidden = !state.hidden; saveTextValues(); buildStudioFrameFields(t); refreshFrameText(); draw(); };
        row.appendChild(visibility);
        let input;
        if (f.type === 'upload') {
            const picker = el('label', 'server-text-upload');
            const selectedImage = state.value || f.image || '';
            const pickerTitle = el('span', 'server-text-upload-title', selectedImage ? 'Replace image' : 'Choose an image');
            picker.append(pickerTitle);
            input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
            input.setAttribute('aria-label', `Choose image for ${f.label}`);
            picker.appendChild(input);
            const preview = document.createElement('img'); preview.className = 'server-text-upload-preview';
            preview.alt = selectedImage ? `${state.value ? 'Selected' : 'Default'} image for ${f.label}` : '';
            preview.hidden = !selectedImage;
            if (selectedImage) preview.src = selectedImage;
            picker.appendChild(preview); row.appendChild(picker);
            const clear = el('button', 'link', f.image ? 'Restore default image' : 'Remove image'); clear.type = 'button'; clear.hidden = !state.value;
            clear.onclick = () => { state.value = ''; clear.hidden = true; preview.hidden = !f.image; if (f.image) preview.src = f.image; else preview.removeAttribute('src'); pickerTitle.textContent = f.image ? 'Replace image' : 'Choose an image'; saveTextValues(); refreshFrameText(); };
            row.appendChild(clear);
            input.addEventListener('change', async () => {
                const file = input.files && input.files[0]; input.value = '';
                if (!file) return;
                try {
                    const bitmap = await loadBitmap(file), ratio = Math.min(1, 1200 / Math.max(bitmap.w, bitmap.h));
                    const canvas = mk(bitmap.w * ratio, bitmap.h * ratio);
                    canvas.getContext('2d').drawImage(bitmap.src, 0, 0, canvas.width, canvas.height);
                    const data = canvas.toDataURL('image/jpeg', .86);
                    const image = await new Promise((resolve, reject) => {
                        const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = data;
                    });
                    state.value = data;
                    FRAME_UPLOADS.set(String(f.id), {src: data, image}); clear.hidden = false;
                    preview.src = data; preview.hidden = false; pickerTitle.textContent = 'Change image';
                    saveTextValues(); refreshFrameText();
                } catch { toast('Could not load that image'); }
            });
        } else {
            input = f.type === 'date' ? document.createElement('input') : document.createElement('textarea');
            if (f.type === 'date') input.type = 'date';
            else { input.rows = 2; input.maxLength = f.max || 80; input.className = 'server-text-value'; }
            input.value = state.value || '';
            input.placeholder = f.text || f.label;
            if (f.type === 'date') input.autocomplete = 'off';
            else input.setAttribute('aria-label', `${f.label}. Press Shift+Enter to start a new line.`);
            row.appendChild(input);
            input.addEventListener('input', () => { state.value = input.value; saveTextValues(); refreshFrameText(); });
        }
        const fontLabel = el('label', 'server-text-font'); fontLabel.append(el('span', '', 'Font'));
        const font = document.createElement('select');
        FONTS.forEach(fontChoice => {
            const option = document.createElement('option');
            option.value = fontChoice.key;
            option.textContent = fontChoice.n;
            option.style.fontFamily = fontChoice.family;
            font.appendChild(option);
        });
        font.value = state.font || f.font || 'modern';
        font.addEventListener('change', () => { state.font = font.value; saveTextValues(); refreshFrameText(); });
        fontLabel.appendChild(font); row.appendChild(fontLabel);
        fontLabel.hidden = f.type === 'upload';
        if (f.type !== 'upload') {
            const sizeLabel = el('label', 'server-text-font'); sizeLabel.append(el('span', '', 'Text size'));
            const size = document.createElement('select');
            FONT_SIZES.forEach(value => {
                const option = document.createElement('option');
                option.value = String(value);
                option.textContent = `${value} pt`;
                size.appendChild(option);
            });
            const sizeRatio = state.size || f.fontSize || 1;
            const currentSize = sizeRatio * FONT_SIZE_BASE;
            size.value = String(FONT_SIZES.reduce((closest, value) =>
                Math.abs(value - currentSize) < Math.abs(closest - currentSize) ? value : closest, FONT_SIZES[0]));
            size.addEventListener('change', () => {
                state.size = Number(size.value) / FONT_SIZE_BASE;
                saveTextValues();
                refreshFrameText();
            });
            sizeLabel.append(size); row.appendChild(sizeLabel);
            const format = el('div', 'server-text-format');
            [['bold', 'B', 'Bold'], ['italic', 'I', 'Italic']].forEach(([key, label, title]) => {
                const button = el('button', `format-toggle${key === 'italic' ? ' italic' : ''}`);
                button.type = 'button';
                button.textContent = label;
                button.title = title;
                button.setAttribute('aria-label', title);
                button.setAttribute('aria-pressed', String(!!state[key]));
                button.classList.toggle('on', !!state[key]);
                button.onclick = () => {
                    state[key] = !state[key];
                    button.classList.toggle('on', state[key]);
                    button.setAttribute('aria-pressed', String(state[key]));
                    saveTextValues();
                    refreshFrameText();
                };
                format.appendChild(button);
            });
            row.appendChild(format);
            const colorLabel = el('label', 'server-text-font'); colorLabel.append(el('span', '', 'Text colour'));
            const color = document.createElement('input'); color.type = 'color'; color.value = /^#[0-9a-f]{6}$/i.test(state.color || f.color || '') ? (state.color || f.color) : '#222222';
            color.addEventListener('input', () => { state.color = color.value; saveTextValues(); refreshFrameText(); });
            colorLabel.append(color); row.appendChild(colorLabel);
        }
        row.addEventListener('focusin', () => {
            serverTextSel = f.id;
            document.querySelectorAll('.server-text-field').forEach(item => item.classList.toggle('is-selected', item === row));
            draw();
        });
        targetHost.appendChild(row);
    });
    if (!serverTextSel || !t.texts.some(f => String(f.id) === String(serverTextSel))) serverTextSel = t.texts[0].id;
}
function resetStudioFrameFields() {
    if (!flow.serverTemplate) return;
    flow.serverTemplate.texts.forEach(f => {
        const value = f.type === 'upload' ? (f.image || '') : f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(f.text || '') ? '' : f.text || '';
        flow.textValues[f.id] = {
            value, x: f.x, y: f.y, w: f.w, h: f.h, font: f.font, color: f.color, align: f.align,
            size: f.fontSize || 1, bold: !!f.bold, italic: !!f.italic, effect: f.effect || 'none',
            rotation: 0, hidden: false
        };
    });
    serverTextSel = flow.serverTemplate.texts[0]?.id || null;
    saveTextValues(); buildStudioFrameFields(flow.serverTemplate); refreshFrameText(); draw();
}

let activeServerFrame = null;
let activeServerTransparentSlots = [];

function hasTransparentFrameOpening(ctx, slot) {
    try {
        let transparent = 0, samples = 0;
        for (const fy of [.2, .4, .6, .8]) for (const fx of [.2, .4, .6, .8]) {
            const x = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(slot.x + slot.w * fx)));
            const y = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(slot.y + slot.h * fy)));
            if (ctx.getImageData(x, y, 1, 1).data[3] < 32) transparent++;
            samples++;
        }
        return transparent >= Math.ceil(samples * .6);
    } catch (error) {
        // If the browser cannot inspect the source image, use the established
        // opaque-frame cutout path as a safe fallback.
        return false;
    }
}

const FCACHE = new Map();
function photosFor(filter) {
    const key = photoVer + '|' + filter;
    if (!FCACHE.has(key)) {
        if (FCACHE.size > 14) FCACHE.clear();
        FCACHE.set(key, photos.map(p => applyFilter(p, filter)));
    }
    return FCACHE.get(key);
}

let view = 'home';
function show(v) {
    view = v;
    document.body.classList.toggle('choose-view', v === 'choose');
    document.body.classList.toggle('capture-view', v === 'capture');
    document.body.classList.toggle('result-view', v === 'result');
    ['home', 'faq', 'frames', 'choose', 'capture', 'result', 'studio'].forEach(n => $('v-' + n).classList.toggle('on', n === v));
    $('steps').hidden = campaignConfig || v === 'home' || v === 'faq' || v === 'frames' || v === 'studio';
    const landingView = v === 'home' || v === 'faq' || v === 'frames';
    $('siteNav').hidden = campaignConfig || !landingView;
    $('navToggle').hidden = campaignConfig || !landingView;
    $('tryFreeBtn').hidden = campaignConfig || !landingView;
    setNavMenuOpen(false);
    const step = v === 'choose' ? 1 : v === 'capture' ? 2 : 3;
    document.querySelectorAll('#steps li').forEach(li => li.classList.toggle('on', +li.dataset.s === step));
    if (v === 'capture') startCam(); else stopCam();
    window.scrollTo(0, 0);
}

/* ---------- home ---------- */
function buildHome() {
    const a = $('artInstant');
    [1, 2, 3, 4].forEach(n => a.appendChild(previewCanvas(layoutFor('instant', n), {}, 320, n)));
    const b = $('artStrip');
    ['classic', 'blush', 'midnight'].forEach((id, i) => {
        const p = STRIPS.find(s => s.id === id);
        b.appendChild(previewCanvas(layoutFor('strip', p.n), p, 280, i));
    });
    renderSavedTemplates();
    loadServerFrames();
}

let serverFrameTemplates = [];
const SERVER_FRAME_PREVIEW_COUNT = 8;

function renderServerFrameCard(t) {
    const card = el('button', 'choice'), thumb = el('div', 'thumb'), canvas = mk(120, 150), image = new Image();
    image.onload = () => {
        const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
        const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
        canvas.getContext('2d').drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    image.src = t.image; thumb.appendChild(canvas);
    const title = document.createElement('b'), count = document.createElement('small');
    title.textContent = t.name; count.textContent = `${t.slots.length} photo${t.slots.length === 1 ? '' : 's'}`;
    card.append(thumb, title, count);
    card.onclick = () => startServerFrame(t);
    return card;
}

function renderServerFrames() {
    const host = $('serverChoices');
    const visibleTemplates = serverFrameTemplates.slice(0, SERVER_FRAME_PREVIEW_COUNT);
    host.replaceChildren(...visibleTemplates.map(renderServerFrameCard));

    if (serverFrameTemplates.length > SERVER_FRAME_PREVIEW_COUNT) {
        const viewAll = el('button', 'choice server-view-all');
        const icon = el('span', 'server-view-all-icon');
        const label = el('b');
        const detail = el('small');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '+';
        label.textContent = 'View all';
        detail.textContent = `${serverFrameTemplates.length} frames`;
        viewAll.append(icon, label, detail);
        viewAll.onclick = () => {
            renderAllServerFrames();
            show('frames');
        };
        host.appendChild(viewAll);
    }

    $('serverFramePrev').hidden = serverFrameTemplates.length <= SERVER_FRAME_PREVIEW_COUNT;
    $('serverFrameNext').hidden = serverFrameTemplates.length <= SERVER_FRAME_PREVIEW_COUNT;
    $('serverFramePrev').disabled = host.scrollLeft <= 0;
    $('serverFrameNext').disabled = host.scrollLeft + host.clientWidth >= host.scrollWidth - 2;
}

function renderAllServerFrames() {
    $('allFramesGrid').replaceChildren(...serverFrameTemplates.map(renderServerFrameCard));
}

async function loadServerFrames() {
    const section = $('serverFrameSection');
    try {
        const response = await fetch('/api/templates/');
        if (!response.ok) throw new Error();
        const data = await response.json();
        serverFrameTemplates = (data.categories || []).flatMap(category => category.templates || []);
        renderServerFrames();
        section.hidden = serverFrameTemplates.length === 0;
    } catch (err) {
        section.hidden = true;
    }
}

$('serverFramePrev').addEventListener('click', () => {
    $('serverChoices').scrollBy({left: -$('serverChoices').clientWidth * .8, behavior: 'smooth'});
});
$('serverFrameNext').addEventListener('click', () => {
    $('serverChoices').scrollBy({left: $('serverChoices').clientWidth * .8, behavior: 'smooth'});
});
$('serverChoices').addEventListener('scroll', () => {
    $('serverFramePrev').disabled = $('serverChoices').scrollLeft <= 0;
    $('serverFrameNext').disabled = $('serverChoices').scrollLeft + $('serverChoices').clientWidth >= $('serverChoices').scrollWidth - 2;
});
$('backToFrames').addEventListener('click', () => {
    show('home');
    requestAnimationFrame(() => $('serverFrameSection').scrollIntoView({behavior: 'smooth', block: 'start'}));
});
$('tryFreeBtn').addEventListener('click', e => {
    e.preventDefault();
    renderAllServerFrames();
    show('frames');
});

async function startServerFrame(t) {
    try {
        clearCameraVideoMask();
        const image = await new Promise((resolve, reject) => {
            const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = t.image;
        });
        await loadFrameFonts(t);
        const scale = Math.min(1, 2000 / Math.max(t.w, t.h));
        const W = Math.round(t.w * scale), H = Math.round(t.h * scale);
        const layout = {kind: 'server', n: t.slots.length, W, H,
            slots: t.slots.map(s => ({x: s.x * W, y: s.y * H, w: s.w * W, h: s.h * H, shape: s.shape || 'square'})), foot: {y: H, h: 0}};
        // Uploaded PNGs sometimes contain example photos instead of transparent
        // windows. Cut the detected slot interiors from the frame overlay so
        // captured photos can show through in the final composed strip.
        activeServerFrame = mk(W, H);
        const frameCtx = activeServerFrame.getContext('2d');
        frameCtx.drawImage(image, 0, 0, W, H);
        activeServerTransparentSlots = layout.slots.map(slot => hasTransparentFrameOpening(frameCtx, slot));
        frameCtx.globalCompositeOperation = 'destination-out';
        layout.slots.forEach((slot, index) => {
            // A transparent PNG already contains the exact photo aperture,
            // including decorative scallops and curved borders. Keep that
            // alpha mask untouched; only cut windows from opaque sample-photo frames.
            if (activeServerTransparentSlots[index]) return;
            // Match the rounded photo-window corners so the original border
            // stays intact around the newly captured photo.
            if (slot.shape && slot.shape !== 'square') photoShapePath(frameCtx, slot);
            else rr(frameCtx, slot.x, slot.y, slot.w, slot.h, Math.min(slot.w, slot.h) * .08);
            frameCtx.fill();
        });
        frameCtx.globalCompositeOperation = 'source-over';
        flow = {mode: 'server', n: layout.n, preset: {}, layout, name: t.name,
            savedDesign: newDoc(layout, {filter: t.filter || 'Normal'}), serverTemplate: t};
        flow.textValues = loadTextValues(t);
        photos = []; photoVer++;
        const cam = $('cam'), overlay = $('camFrame'), first = layout.slots[0];
        cam.classList.toggle('transparent-window', layout.n === 1 && activeServerTransparentSlots[0]);
        if (layout.n === 1) {
            setupCameraTemplate();
            cam.classList.add('templated');
            cam.style.setProperty('--ar', `${W}/${H}`); cam.style.setProperty('--arn', (W / H).toFixed(4));
            cam.style.setProperty('--slot-x', `${t.slots[0].x * 100}%`);
            cam.style.setProperty('--slot-y', `${t.slots[0].y * 100}%`);
            cam.style.setProperty('--slot-w', `${t.slots[0].w * 100}%`);
            cam.style.setProperty('--slot-h', `${t.slots[0].h * 100}%`);
            cam.style.setProperty('--slot-clip', photoShapeClipCSS(first.shape));
            setCameraVideoMask(activeServerFrame, first);
            $('v-capture').style.setProperty('--capture-ar', (W / H).toFixed(4));
        } else {
            cam.classList.remove('templated', 'overlay-design');
            ['--slot-x', '--slot-y', '--slot-w', '--slot-h', '--slot-clip'].forEach(p => cam.style.removeProperty(p));
            overlay.hidden = true;
            cam.style.setProperty('--ar', `${first.w}/${first.h}`);
            cam.style.setProperty('--arn', (first.w / first.h).toFixed(4));
            $('v-capture').style.setProperty('--capture-ar', (first.w / first.h).toFixed(4));
        }
        $('capName').textContent = t.name; $('sSave').hidden = true;
        if (campaignConfig) $('capBack').hidden = true;
        buildSlots(); show('capture');
    } catch (err) {
        activeServerFrame = null;
        activeServerTransparentSlots = [];
        $('cam').classList.remove('transparent-window');
        clearCameraVideoMask();
        if (campaignConfig) {
            $('campaignError').hidden = false;
            document.body.classList.remove('capture-view', 'result-view');
        } else {
            toast('Could not load that frame');
        }
    }
}

function readSavedTemplates() {
    try {
        const entries = JSON.parse(localStorage.getItem(SAVED_TEMPLATES_KEY) || '[]');
        return Array.isArray(entries) ? entries.filter(t =>
            t && (t.mode === 'instant' || t.mode === 'strip') &&
            Number.isInteger(t.n) && t.n >= 1 && t.n <= 4 &&
            typeof t.name === 'string' && typeof t.key === 'string' &&
            (t.mode === 'instant' || STRIPS.some(s => s.id === t.presetId))
        ).slice(0, 12) : [];
    } catch { return []; }
}

const SAVED_IMAGE_LOADS = new Map();
function ensureSavedTemplateImage(design) {
    const bg = design && design.bg;
    if (!bg || bg.mode !== 'image' || IMGS[bg.imgId]) return Promise.resolve();
    if (!bg.imgData) return Promise.reject(new Error('Template image is missing'));
    if (SAVED_IMAGE_LOADS.has(bg.imgId)) return SAVED_IMAGE_LOADS.get(bg.imgId);
    const task = new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => {
            try {
                const c = mk(16, 16), x = c.getContext('2d');
                x.drawImage(im, 0, 0, 16, 16);
                const data = x.getImageData(0, 0, 16, 16).data;
                let lum = 0;
                for (let i = 0; i < data.length; i += 4) lum += .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
                IMGS[bg.imgId] = {img: im, lum: lum / (256 * 255)};
                resolve();
            } catch (err) { reject(err); }
        };
        im.onerror = () => reject(new Error('Could not load saved template image'));
        im.src = bg.imgData;
    });
    SAVED_IMAGE_LOADS.set(bg.imgId, task);
    return task;
}

function paintSavedTemplate(canvas, t, targetW) {
    const layout = layoutFor(t.mode, t.n), scale = targetW / layout.W;
    canvas.width = Math.round(layout.W * scale);
    canvas.height = Math.round(layout.H * scale);
    const d = t.design ? JSON.parse(JSON.stringify(t.design)) : newDoc(layout, t.mode === 'strip' ? STRIPS.find(s => s.id === t.presetId) || {} : {});
    d.layout = layout;
    render(canvas.getContext('2d'), d, {sc: scale, photos: layout.slots.map((s, i) => placeholder(s.w, s.h, i))});
}

function startUsingSavedTemplate(t, button = $('templateDialogUse')) {
    button.disabled = true;
    ensureSavedTemplateImage(t.design).then(() => {
        const preset = t.mode === 'strip' ? STRIPS.find(s => s.id === t.presetId) : {};
        const design = t.design ? JSON.parse(JSON.stringify(t.design)) : null;
        if (design && design.bg) delete design.bg.imgData;
        startCapture(t.mode, t.n, preset || {}, t.name, design);
        if ($('templateDialog').open) $('templateDialog').close();
    }).catch(() => toast('Could not load the saved template')).finally(() => { button.disabled = false; });
}

function editSavedTemplate(t, button) {
    button.disabled = true;
    ensureSavedTemplateImage(t.design).then(() => {
        const design = JSON.parse(JSON.stringify(t.design));
        if (design.bg) delete design.bg.imgData;
        const layout = design.layout || layoutFor(t.mode, t.n);
        const preset = t.mode === 'strip' ? STRIPS.find(item => item.id === t.presetId) : null;
        flow = {mode: t.mode, n: t.n, preset, layout, name: t.name};
        doc = design;
        doc.layout = layout;
        photos = []; photoVer++;
        activeServerFrame = null;
        activeServerTransparentSlots = [];
        editingSavedTemplateKey = t.key;
        $('sSave').hidden = false;
        if ($('templateDialog').open) $('templateDialog').close();
        openStudio();
    }).catch(() => toast('Could not open the saved template for editing')).finally(() => { button.disabled = false; });
}

function requestDeleteSavedTemplate(t) {
    $('deleteTemplateName').textContent = t.name;
    const dialog = $('deleteTemplateDialog');
    const deleteNow = () => {
        try {
            const saved = readSavedTemplates().filter(item => item.key !== t.key);
            localStorage.setItem(SAVED_TEMPLATES_KEY, JSON.stringify(saved));
            if (editingSavedTemplateKey === t.key) editingSavedTemplateKey = null;
            if (dialog.open) dialog.close();
            if ($('templateDialog').open) $('templateDialog').close();
            renderSavedTemplates();
            toast('Saved template deleted');
        } catch { toast('Could not delete the saved template'); }
    };
    $('deleteTemplateConfirm').onclick = deleteNow;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else if (window.confirm(`Are you sure you want to delete “${t.name}”?`)) deleteNow();
}
$('deleteTemplateCancel').onclick = () => $('deleteTemplateDialog').close();

async function openSavedTemplatePreview(t) {
    const dialog = $('templateDialog'), canvas = $('templatePreviewCanvas');
    try { await ensureSavedTemplateImage(t.design); }
    catch { toast('Could not load the saved template preview'); }
    $('templateDialogTitle').textContent = t.name;
    paintSavedTemplate(canvas, t, 440);
    $('templateDialogUse').onclick = () => startUsingSavedTemplate(t);
    $('templateDialogRemove').onclick = () => {
        requestDeleteSavedTemplate(t);
    };
    if (typeof dialog.showModal === 'function') dialog.showModal();
}

function renderSavedTemplates() {
    const list = $('savedTemplates'), section = $('savedSection');
    if (!list || !section) return;
    const saved = readSavedTemplates();
    section.hidden = saved.length === 0;
    list.innerHTML = '';
    saved.forEach((t, i) => {
        const card = el('article', 'choice saved-item');
        const preview = el('button', 'saved-preview');
        preview.type = 'button';
        const thumb = el('span', 'saved-thumb');
        const mini = mk(220, 220);
        try { paintSavedTemplate(mini, t, 200); } catch {}
        thumb.appendChild(mini);
        if (t.design && t.design.bg && t.design.bg.mode === 'image' && !IMGS[t.design.bg.imgId]) {
            ensureSavedTemplateImage(t.design).then(renderSavedTemplates).catch(() => {});
        }
        const title = el('b'), detail = el('small');
        title.textContent = t.name;
        detail.textContent = `${t.mode === 'strip' ? 'Photo strip' : 'Instant frame'} \u00B7 ${t.n} photos`;
        preview.append(thumb, title, detail);
        preview.onclick = () => openSavedTemplatePreview(t);
        preview.setAttribute('aria-label', `Preview ${t.name} template`);
        const remove = el('button', 'saved-remove', 'Delete');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${t.name} template`);
        remove.onclick = () => {
            requestDeleteSavedTemplate(t);
        };
        const actions = el('div', 'saved-item-actions');
        const start = el('button', 'saved-start', 'Use template');
        start.type = 'button';
        start.onclick = () => startUsingSavedTemplate(t, start);
        const edit = el('button', 'saved-edit', 'Edit');
        edit.type = 'button';
        edit.setAttribute('aria-label', `Edit ${t.name} template`);
        edit.onclick = () => editSavedTemplate(t, edit);
        actions.append(start, edit, remove);
        card.append(preview, actions);
        list.appendChild(card);
    });
}

async function saveCurrentTemplate() {
    const presetId = flow.mode === 'strip' ? flow.preset.id : null;
    const saved = readSavedTemplates();
    const base = `${flow.name || 'Photo'} template`;
    const editing = editingSavedTemplateKey && saved.some(t => t.key === editingSavedTemplateKey);
    let name = editing ? saved.find(t => t.key === editingSavedTemplateKey).name : base;
    let suffix = 2;
    while (!editing && saved.some(t => t.name === name)) name = `${base} (${suffix++})`;
    const key = editing ? editingSavedTemplateKey : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const design = JSON.parse(JSON.stringify(doc));
    if (design.bg.mode === 'image') {
        const sourceRecord = IMGS[design.bg.imgId], source = sourceRecord && sourceRecord.img;
        if (!source) { toast('Could not save the background image'); return; }
        const maxSide = 1400, ratio = Math.min(1, maxSide / Math.max(source.width, source.height));
        const bitmap = mk(source.width * ratio, source.height * ratio);
        bitmap.getContext('2d').drawImage(source, 0, 0, bitmap.width, bitmap.height);
        try { design.bg.imgData = bitmap.toDataURL('image/png'); }
        catch { toast('Could not save the background image'); return; }
        design.bg.imgId = `saved-template-${key}`;
        IMGS[design.bg.imgId] = {img: bitmap, lum: sourceRecord.lum};
    }
    const updated = {key, mode: flow.mode, n: flow.n, presetId, name, design};
    if (editing) saved[saved.findIndex(t => t.key === key)] = updated;
    else saved.unshift(updated);
    try {
        localStorage.setItem(SAVED_TEMPLATES_KEY, JSON.stringify(saved.slice(0, 12)));
        renderSavedTemplates();
        toast(editing ? 'Template changes saved on this device' : 'Template saved on this device');
    } catch { toast('Could not save the template on this device'); }
}

function adminFrameBlob() {
    const L = doc.layout, scale = 2, canvas = mk(L.W * scale, L.H * scale), ctx = canvas.getContext('2d');
    render(ctx, doc, {sc: scale, photos: [], layer: buildLayer(doc, scale)});
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    L.slots.forEach(slot => {
        const corner = !slot.shape || slot.shape === 'square' ? Math.min(slot.w, slot.h) * .08 : 0;
        photoShapePath(ctx, slot, corner);
        ctx.fill();
    });
    ctx.restore();
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
async function saveAdminStudioFrame() {
    const name = $('adminFrameName').value.trim(), submit = $('adminFrameSaveConfirm'), error = $('adminFrameSaveError');
    if (!name) { error.textContent = 'Enter a name for this frame.'; error.hidden = false; $('adminFrameName').focus(); return; }
    submit.disabled = true; submit.textContent = 'Saving…'; error.hidden = true;
    try {
        const image = await adminFrameBlob();
        if (!image) throw new Error('Could not render the frame.');
        const data = new FormData();
        data.append('name', name);
        data.append('image', image, 'campaign-frame.png');
        data.append('filter', doc.filter || 'Normal');
        data.append('slots', JSON.stringify(doc.layout.slots.map(slot => ({
            x: slot.x / doc.layout.W * 100, y: slot.y / doc.layout.H * 100,
            w: slot.w / doc.layout.W * 100, h: slot.h / doc.layout.H * 100,
            shape: slot.shape || 'square'
        }))));
        if (adminStudioConfig.campaignId) data.append('campaign_id', adminStudioConfig.campaignId);
        if (adminStudioConfig.frameId) data.append('frame_id', adminStudioConfig.frameId);
        const response = await fetch(adminStudioConfig.saveUrl, {
            method: 'POST', body: data,
            headers: {'X-CSRFToken': document.querySelector('meta[name="csrf"]').content}
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || 'Could not save this frame.');
        if (window.opener && result.frameId) {
            window.opener.postMessage({type: 'campaign-frame-created', id: result.frameId, name: result.frameName}, window.location.origin);
        }
        window.location.assign(result.url || adminStudioConfig.returnUrl);
    } catch (err) {
        error.textContent = err.message || 'Could not save this frame.';
        error.hidden = false;
    } finally {
        submit.disabled = false; submit.textContent = 'Save frame';
    }
}
$('optInstant').onclick = () => openChoose('instant');
$('optStrip').onclick = () => openChoose('strip');
function openBlankStudio() {
    editingSavedTemplateKey = null;
    activeServerFrame = null;
    activeServerTransparentSlots = [];
    $('sSave').hidden = false;
    flow = {mode: 'instant', n: 1, preset: null, layout: layoutFor('instant', 1), name: 'Single frame'};
    photos = [];
    photoVer++;
    doc = newDoc(flow.layout, {bg: {mode: 'transparent', c1: '#ffffff'}, overlayOnly: true});
    doc.text.showDate = false;
    doc.text.date = '';
    live.dirty = true;
    openStudio();
}
$('brand').onclick = e => {
    e.preventDefault();
    if (campaignConfig) return;
    if (view !== 'home') show('home');
    else window.scrollTo({top: 0, behavior: 'smooth'});
};
function setNavMenuOpen(open) {
    $('siteNav').classList.toggle('menu-open', open);
    $('navToggle').setAttribute('aria-expanded', String(open));
    $('navToggle').setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
}
$('navToggle').addEventListener('click', () => {
    setNavMenuOpen($('navToggle').getAttribute('aria-expanded') !== 'true');
});
$('siteNav').addEventListener('click', e => {
    const link = e.target.closest('a');
    if (!link) return;
    e.preventDefault();
    const target = link.getAttribute('href').slice(1);
    setNavMenuOpen(false);
    if (target === 'studio') {
        openBlankStudio();
        return;
    }
    if (target === 'faq') {
        show('faq');
        return;
    }
    if (view !== 'home') show('home');
    requestAnimationFrame(() => {
        if (target === 'v-home') window.scrollTo({top: 0, behavior: 'smooth'});
        else $(target).scrollIntoView({behavior: 'smooth', block: 'start'});
    });
});
$('faqContactLink').addEventListener('click', e => {
    e.preventDefault();
    show('home');
    requestAnimationFrame(() => $('contact').scrollIntoView({behavior: 'smooth', block: 'start'}));
});
document.addEventListener('click', e => {
    if (!e.target.closest('.top')) setNavMenuOpen(false);
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setNavMenuOpen(false);
});
$('contactForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const status = $('contactStatus');
    const button = form.querySelector('.contact-submit');
    button.disabled = true;
    status.classList.remove('is-error');
    status.textContent = 'Sending your message...';
    try {
        const response = await fetch('/api/inquiries/', {
            method: 'POST',
            body: new FormData(form),
            headers: {'X-CSRFToken': document.querySelector('meta[name="csrf"]').content}
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
            const first = result.errors ? Object.values(result.errors)[0] : '';
            throw new Error(first || result.error || 'Something went wrong. Please try again.');
        }
        form.reset();
        status.textContent = 'Thank you. Your message has been sent and we will get back to you soon.';
    } catch (err) {
        status.classList.add('is-error');
        status.textContent = err.message || 'Could not send your message. Please check your connection and try again.';
    } finally {
        button.disabled = false;
    }
});
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => show(b.dataset.back));

/* ---------- choose ---------- */
let stripPhotoCount = 3;
function renderStripChoices() {
    const host = $('choices');
    host.innerHTML = '';
    STRIPS.forEach((preset, i) => {
        const button = el('button', 'choice');
        const thumb = el('div', 'thumb');
        thumb.appendChild(previewCanvas(layoutFor('strip', stripPhotoCount), preset, 400, i));
        button.append(thumb, el('b', '', preset.name), el('small', '', `${stripPhotoCount} photos`));
        button.onclick = () => startCapture('strip', stripPhotoCount, preset, preset.name + ' strip');
        host.appendChild(button);
    });
    document.querySelectorAll('[data-strip-count]').forEach(button => {
        const active = Number(button.dataset.stripCount) === stripPhotoCount;
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
    });
    requestAnimationFrame(syncStripArrows);
}
document.querySelectorAll('[data-strip-count]').forEach(button => {
    button.onclick = () => {
        stripPhotoCount = Number(button.dataset.stripCount);
        renderStripChoices();
    };
});
function openChoose(mode) {
    flow.mode = mode;
    const host = $('choices');
    host.classList.toggle('strip-choices', mode === 'strip');
    host.classList.toggle('instant-choices', mode === 'instant');
    $('stripBrowser').classList.toggle('on', mode === 'strip');
    $('stripCountPicker').hidden = mode !== 'strip';
    document.body.classList.toggle('instant-choose-view', mode === 'instant');
    host.innerHTML = '';
    if (mode === 'instant') {
        $('chooseTitle').textContent = 'Instant Frames';
        $('chooseSub').textContent = 'How many photos do you want in your frame?';
        [[1, 'Single', '1 photo'], [2, 'Duo', '2 photos'], [3, 'Trio', '3 photos'], [4, 'Quad', '4 photos']].forEach(([n, name, sub]) => {
            const b = el('button', 'choice');
            const th = el('div', 'thumb');
            th.appendChild(previewCanvas(layoutFor('instant', n), {}, 440, n));
            b.append(th, el('b', '', name), el('small', '', sub));
            b.onclick = () => startCapture('instant', n, {}, name + ' frame');
            host.appendChild(b);
        });
    } else {
        $('chooseTitle').textContent = 'Select your strip';
        $('chooseSub').textContent = 'Choose a refined print style and set the number of photos for your strip.';
        renderStripChoices();
    }
    show('choose');
    requestAnimationFrame(syncStripArrows);
}

function syncStripArrows() {
    const host = $('choices'), max = host.scrollWidth - host.clientWidth;
    $('stripPrev').disabled = host.scrollLeft <= 2;
    $('stripNext').disabled = host.scrollLeft >= max - 2;
}
$('stripPrev').onclick = () => $('choices').scrollBy({left: -$('choices').clientWidth * .8, behavior: 'smooth'});
$('stripNext').onclick = () => $('choices').scrollBy({left: $('choices').clientWidth * .8, behavior: 'smooth'});
$('choices').addEventListener('scroll', syncStripArrows, {passive: true});
window.addEventListener('resize', syncStripArrows);

/* =====================================================================
   Capture
   ===================================================================== */
const vid = $('vid');
let stream = null, facing = 'user', mirror = true, flashOn = false, timer = 3;
let busy = false, abort = false, audioCtx = null;
let camZoom = 1, hwZoom = null, camRes = 1;   // chosen zoom, hardware zoom range, leftover digital zoom
let cameraVideoMaskURLs = null;

function clearCameraVideoMask() {
    const video = $('vid');
    cameraVideoMaskURLs = null;
    ['maskImage', 'webkitMaskImage', 'maskSize', 'webkitMaskSize', 'maskRepeat', 'webkitMaskRepeat'].forEach(property => {
        video.style[property] = '';
    });
}

function updateCameraVideoMask() {
    if (!cameraVideoMaskURLs) return;
    const image = mirror && facing === 'user' ? cameraVideoMaskURLs.mirrored : cameraVideoMaskURLs.normal;
    const video = $('vid');
    video.style.maskImage = image;
    video.style.webkitMaskImage = image;
}

function setCameraVideoMask(source, slot) {
    const width = Math.max(1, Math.round(slot.w)), height = Math.max(1, Math.round(slot.h));
    const video = $('vid');
    const sourcePixels = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    const mask = mk(width, height), maskContext = mask.getContext('2d');
    const maskPixels = maskContext.createImageData(width, height);
    for (let y = 0; y < height; y++) {
        const sourceY = Math.min(source.height - 1, Math.floor(slot.y + (y + .5) * slot.h / height));
        for (let x = 0; x < width; x++) {
            const sourceX = Math.min(source.width - 1, Math.floor(slot.x + (x + .5) * slot.w / width));
            const sourceIndex = (sourceY * source.width + sourceX) * 4;
            const maskIndex = (y * width + x) * 4;
            maskPixels.data[maskIndex] = 255;
            maskPixels.data[maskIndex + 1] = 255;
            maskPixels.data[maskIndex + 2] = 255;
            maskPixels.data[maskIndex + 3] = sourcePixels[sourceIndex + 3] < 32 ? 255 : 0;
        }
    }
    maskContext.putImageData(maskPixels, 0, 0);
    const mirroredMask = mk(width, height), mirroredContext = mirroredMask.getContext('2d');
    mirroredContext.translate(width, 0);
    mirroredContext.scale(-1, 1);
    mirroredContext.drawImage(mask, 0, 0);
    cameraVideoMaskURLs = {
        normal: `url("${mask.toDataURL('image/png')}")`,
        mirrored: `url("${mirroredMask.toDataURL('image/png')}")`
    };
    video.style.maskSize = '100% 100%';
    video.style.webkitMaskSize = '100% 100%';
    video.style.maskRepeat = 'no-repeat';
    video.style.webkitMaskRepeat = 'no-repeat';
    updateCameraVideoMask();
}

function setupCameraTemplate() {
    const cam = $('cam'), overlay = $('camFrame'), L = flow.layout;
    cam.classList.toggle('overlay-design', !!(flow.savedDesign && flow.savedDesign.overlayOnly));
    if (!flow.savedDesign) {
        cam.classList.remove('templated');
        overlay.hidden = true;
        ['--slot-x', '--slot-y', '--slot-w', '--slot-h', '--slot-clip'].forEach(p => cam.style.removeProperty(p));
        return;
    }
    const d = JSON.parse(JSON.stringify(flow.savedDesign)), slot = L.slots[0];
    d.layout = L;
    cam.classList.add('templated');
    cam.style.setProperty('--ar', `${L.W}/${L.H}`);
    cam.style.setProperty('--arn', (L.W / L.H).toFixed(4));
    cam.style.setProperty('--slot-x', `${slot.x / L.W * 100}%`);
    cam.style.setProperty('--slot-y', `${slot.y / L.H * 100}%`);
    cam.style.setProperty('--slot-w', `${slot.w / L.W * 100}%`);
    cam.style.setProperty('--slot-h', `${slot.h / L.H * 100}%`);
    cam.style.setProperty('--slot-clip', photoShapeClipCSS(slot.shape));
    overlay.width = L.W;
    overlay.height = L.H;
    const ctx = overlay.getContext('2d');
    if (flow.serverTemplate && activeServerFrame) {
        // Preserve the PNG's own alpha mask so shaped photo windows keep their
        // original arch, corners and decorative frame artwork.
        ctx.clearRect(0, 0, L.W, L.H);
        ctx.drawImage(activeServerFrame, 0, 0, L.W, L.H);
        drawFrameTexts(ctx, L);
    } else {
        render(ctx, d, {sc: 1, photos: [], layer: buildLayer(d, 1)});
        // Keep the live camera visible in the photo window even when a saved
        // image contains a checkerboard preview instead of real transparency.
        ctx.save(); photoShapePath(ctx, slot); ctx.clip(); ctx.clearRect(slot.x, slot.y, slot.w, slot.h); ctx.restore();
    }
    overlay.hidden = false;
}

function updateServerCameraWindow() {
    const L = flow.layout, index = Math.min(photos.length, L.n - 1);
    const slot = L.slots[index], cam = $('cam'), overlay = $('camFrame');
    if (L.n > 1) return;
    if (flow.savedDesign && !flow.serverTemplate) {
        // Keep the saved composition fixed while moving the live camera into
        // the next photo window. Show already captured photos in their slots.
        const d = JSON.parse(JSON.stringify(flow.savedDesign));
        d.layout = L;
        cam.style.setProperty('--slot-x', `${slot.x / L.W * 100}%`);
        cam.style.setProperty('--slot-y', `${slot.y / L.H * 100}%`);
        cam.style.setProperty('--slot-w', `${slot.w / L.W * 100}%`);
        cam.style.setProperty('--slot-h', `${slot.h / L.H * 100}%`);
        cam.style.setProperty('--slot-clip', photoShapeClipCSS(slot.shape));
        const ctx = overlay.getContext('2d');
        render(ctx, d, {sc: 1, photos, layer: buildLayer(d, 1)});
        ctx.save(); photoShapePath(ctx, slot); ctx.clip(); ctx.clearRect(slot.x, slot.y, slot.w, slot.h); ctx.restore();
        return;
    }
    if (!flow.serverTemplate || !activeServerFrame) return;
    const t = flow.serverTemplate, bounds = t.slots[index];
    cam.style.setProperty('--slot-x', `${bounds.x * 100}%`);
    cam.style.setProperty('--slot-y', `${bounds.y * 100}%`);
    cam.style.setProperty('--slot-w', `${bounds.w * 100}%`);
    cam.style.setProperty('--slot-h', `${bounds.h * 100}%`);
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.drawImage(activeServerFrame, 0, 0, L.W, L.H);
    drawFrameTexts(ctx, L);
}

function startCapture(mode, n, preset, name, savedDesign = null) {
    editingSavedTemplateKey = null;
    const layout = layoutFor(mode, n);
    if (savedDesign && savedDesign.layout && savedDesign.layout.slots && savedDesign.layout.slots.length === layout.slots.length) {
        layout.slots = savedDesign.layout.slots.map(slot => ({...slot}));
    }
    flow = {mode, n, preset, layout, name, savedDesign};
    activeServerFrame = null;
    activeServerTransparentSlots = [];
    $('sSave').hidden = false;
    $('cam').classList.remove('templated', 'transparent-window');
    clearCameraVideoMask();
    photos = [];
    photoVer++;
    const s = flow.layout.slots[0];
    const cam = $('cam'), overlay = $('camFrame');
    if (n > 1) {
        // Keep the capture step focused on the live camera. The saved design
        // is composed around all photos after the final shot is taken.
        cam.classList.remove('templated', 'overlay-design');
        ['--slot-x', '--slot-y', '--slot-w', '--slot-h', '--slot-clip'].forEach(p => cam.style.removeProperty(p));
        overlay.hidden = true;
        cam.style.setProperty('--ar', `${s.w}/${s.h}`);
        cam.style.setProperty('--arn', (s.w / s.h).toFixed(4));
    } else {
        setupCameraTemplate();
        if (!savedDesign) {
            cam.style.setProperty('--ar', `${s.w}/${s.h}`);
            cam.style.setProperty('--arn', (s.w / s.h).toFixed(4));
        }
    }
    const camAspect = n === 1 && savedDesign ? flow.layout.W / flow.layout.H : s.w / s.h;
    $('v-capture').style.setProperty('--capture-ar', camAspect.toFixed(4));
    $('capName').textContent = name;
    buildSlots();
    show('capture');
}

function buildSlots() {
    const host = $('slots'), L = flow.layout, ar = L.slots[0].w / L.slots[0].h;
    host.innerHTML = '';
    for (let i = 0; i < L.n; i++) {
        const s = el('div', 'slot', String(i + 1));
        s.style.clipPath = photoShapeClipCSS(L.slots[i].shape);
        s.style.setProperty('--slot-ar', ar);
        s.style.width = (58 * ar).toFixed(0) + 'px';
        if (photos[i]) {
            s.classList.add('done');
            s.innerHTML = '';
            const c = mk(116 * ar, 116);
            c.getContext('2d').drawImage(photos[i], 0, 0, c.width, c.height);
            s.appendChild(c);
        } else if (i === photos.length) s.classList.add('now');
        host.appendChild(s);
    }
    updateServerCameraWindow();
    const done = photos.length >= L.n;
    $('capCount').textContent = done ? 'All photos taken' : `Photo ${photos.length + 1} of ${L.n}`;
    $('resetBtn').hidden = photos.length === 0 || busy;
    $('shootLbl').textContent = busy ? 'Cancel' : photos.length ? 'Capture next' : (L.n > 1 ? `Capture ${L.n} photos` : 'Capture');
}

async function startCam() {
    stopCam();
    const msg = $('camMsg');
    msg.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        msg.hidden = false;
        msg.textContent = 'This browser cannot access a camera. You can upload photos instead.';
        return;
    }
    try {
        stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: facing, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false});
        if (view !== 'capture') { stopCam(); return; }
        vid.srcObject = stream;
        await vid.play().catch(() => {});
        const caps = stream.getVideoTracks()[0].getCapabilities ? stream.getVideoTracks()[0].getCapabilities() : {};
        hwZoom = caps.zoom ? {min: caps.zoom.min, max: caps.zoom.max} : null;
        await setCamZoom(camZoom);
    } catch (e) {
        msg.hidden = false;
        msg.textContent = 'Camera access is blocked or unavailable. Allow camera permission in your browser, or upload photos instead.';
    }
}
function stopCam() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    vid.srcObject = null;
}
function applyMirror() {
    const m = mirror && facing === 'user' ? 'scaleX(-1) ' : '';
    vid.style.transform = `${m}scale(${camRes})`;
    updateCameraVideoMask();
}
/* Zoom: use the camera's own zoom when it has one (phones), digital for the rest. */
async function setCamZoom(z) {
    camZoom = z;
    let applied = 1;
    const track = stream && stream.getVideoTracks()[0];
    if (track && hwZoom) {
        applied = clamp(z, hwZoom.min, hwZoom.max);
        try { await track.applyConstraints({advanced: [{zoom: applied}]}); } catch (e) { applied = 1; }
    }
    camRes = z / applied;
    applyMirror();
    [...$('zoomBar').children].forEach(b => b.classList.toggle('on', +b.dataset.z === z));
}
function buildZoomBar() {
    const h = $('zoomBar');
    [[.5, '0.5\u00D7'], [1, '1\u00D7'], [2, '2\u00D7']].forEach(([z, l]) => {
        const b = el('button', z === 1 ? 'on' : '', l);
        b.dataset.z = z;
        b.onclick = () => setCamZoom(z);
        h.appendChild(b);
    });
}

function beep(freq, dur) {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = freq; o.type = 'sine';
        g.gain.setValueAtTime(.001, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(.18, audioCtx.currentTime + .01);
        g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + dur);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + dur + .02);
    } catch (e) {}
}

function frameFromSource(src, sw0, sh0, slot, flip, r = 1) {
    const ar = slot.w / slot.h;
    let sw = sw0, sh = sw0 / ar;
    if (sh > sh0) { sh = sh0; sw = sh0 * ar; }
    let sx = (sw0 - sw) / 2, sy = (sh0 - sh) / 2;
    if (r > 1) { sx += sw * (1 - 1 / r) / 2; sy += sh * (1 - 1 / r) / 2; sw /= r; sh /= r; }
    const tw = Math.min(Math.round(slot.w * 2), Math.round(sw)), th = Math.round(tw / ar);
    const c = mk(tw, th), x = c.getContext('2d');
    if (flip) { x.translate(tw, 0); x.scale(-1, 1); }
    if (r < 1) {
        x.fillStyle = '#16150f'; x.fillRect(0, 0, tw, th);
        x.drawImage(src, sx, sy, sw, sh, tw * (1 - r) / 2, th * (1 - r) / 2, tw * r, th * r);
    } else x.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
    return c;
}

async function countdown() {
    const cd = $('cd');
    for (let i = timer; i >= 1 && !abort; i--) {
        cd.innerHTML = `<span>${i}</span>`;
        cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
        beep(i === 1 ? 880 : 620, .12);
        await sleep(1000);
    }
    cd.innerHTML = '';
    cd.classList.remove('pop');
}

async function runSequence() {
    if (busy) { abort = true; return; }
    if (!stream || !vid.videoWidth) { toast('Camera is not ready. Allow access or upload photos.'); return; }
    busy = true; abort = false;
    buildSlots();
    const L = flow.layout;
    while (photos.length < L.n && !abort) {
        await countdown();
        if (abort) break;
        if (flashOn) {
            const sl = $('screenLight');
            sl.classList.add('on');
            await sleep(380);
            photos.push(frameFromSource(vid, vid.videoWidth, vid.videoHeight, L.slots[photos.length], mirror && facing === 'user', camRes));
            sl.classList.remove('on');
        } else {
            photos.push(frameFromSource(vid, vid.videoWidth, vid.videoHeight, L.slots[photos.length], mirror && facing === 'user', camRes));
        }
        const sh = $('shutter');
        sh.classList.add('hit'); void sh.offsetWidth; sh.classList.remove('hit');
        beep(1200, .06);
        buildSlots();
        if (photos.length < L.n) await sleep(1100);
    }
    busy = false;
    const wasAborted = abort;
    abort = false;
    buildSlots();
    if (!wasAborted && photos.length >= L.n) finishCapture();
}

function finishCapture() {
    photoVer++;
    doc = flow.savedDesign ? JSON.parse(JSON.stringify(flow.savedDesign)) : newDoc(flow.layout, flow.preset || {});
    doc.layout = flow.layout;
    live.dirty = true;
    show('result');
    drawResult();
}

async function handleUpload(files) {
    const L = flow.layout;
    for (const f of files) {
        if (photos.length >= L.n) break;
        try {
            const bmp = await loadBitmap(f);
            photos.push(frameFromSource(bmp.src, bmp.w, bmp.h, L.slots[photos.length], false));
        } catch (e) { toast('Could not read one of the images'); }
    }
    buildSlots();
    if (photos.length >= L.n) finishCapture();
    else toast(`${photos.length} of ${L.n} added. Capture or upload the rest.`);
}
function loadBitmap(file) {
    return new Promise((res, rej) => {
        const url = URL.createObjectURL(file), im = new Image();
        im.onload = () => { res({src: im, w: im.naturalWidth, h: im.naturalHeight}); setTimeout(() => URL.revokeObjectURL(url), 2000); };
        im.onerror = () => { URL.revokeObjectURL(url); rej(); };
        im.src = url;
    });
}

/* capture controls */
function buildTimers() {
    const h = $('timers');
    [3, 5, 10].forEach(t => {
        const b = el('button', t === timer ? 'on' : '', t + 's');
        b.onclick = () => { timer = t; [...h.children].forEach(c => c.classList.toggle('on', c === b)); };
        h.appendChild(b);
    });
}
$('shootBtn').onclick = runSequence;
$('flipBtn').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; startCam(); };
$('mirBtn').onclick = e => { mirror = !mirror; e.currentTarget.classList.toggle('on', mirror); applyMirror(); };
$('flashBtn').onclick = e => { flashOn = !flashOn; e.currentTarget.classList.toggle('on', flashOn); };
$('upBtn').onclick = () => $('upIn').click();
$('upIn').onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) handleUpload(f); };
$('resetBtn').onclick = () => { photos = []; photoVer++; buildSlots(); };
$('capBack').onclick = () => { abort = true; show(flow.mode && flow.mode !== 'server' ? 'choose' : 'home'); };

/* =====================================================================
   Result
   ===================================================================== */
function drawResult() {
    const c = $('resCv'), L = doc.layout;
    c.width = L.W; c.height = L.H;
    render(c.getContext('2d'), doc, {sc: 1, photos: photosFor(doc.filter), layer: liveLayer(1)});
}
function resultBlob() {
    const L = doc.layout, sc = 2, c = mk(L.W * sc, L.H * sc);
    render(c.getContext('2d'), doc, {sc, photos: photosFor(doc.filter), layer: buildLayer(doc, sc)});
    return new Promise(resolve => c.toBlob(resolve, 'image/png'));
}
async function exportPNG() {
    const b = await resultBlob();
    if (!b) { toast('Could not export this image'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `photobooth-${stamp()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Saved to your downloads');
}
async function shareResult() {
    if (!navigator.share) {
        toast('Image sharing is not supported in this browser. Use Download to save it.');
        return;
    }
    const b = await resultBlob();
    if (!b) { toast('Could not prepare this image to share'); return; }
    const file = new File([b], `photobooth-${stamp()}.png`, {type: 'image/png'});
    if (navigator.canShare && !navigator.canShare({files: [file]})) {
        toast('Sharing images is not supported in this browser. Use Download to save it.');
        return;
    }
    try { await navigator.share({title: 'My photo booth picture', files: [file]}); }
    catch (err) { if (err.name !== 'AbortError') toast('Could not share this image'); }
}
$('resDl').onclick = exportPNG;
$('shareBtn').onclick = shareResult;
$('custBtn').onclick = openStudio;
$('retakeBtn').onclick = () => { photos = []; photoVer++; buildSlots(); show('capture'); };
$('templateDialogClose').onclick = () => $('templateDialog').close();

/* =====================================================================
   Studio
   ===================================================================== */
const cv = $('cv'), cctx = cv.getContext('2d');
let hist = [], hi = -1, tab = 'bg', selId = null, dispSc = 1, dispK = 1;
let pen = {c: PEN_COLORS[0], w: 10, e: false};
let stkCat = 'Love';

function stripPresetMatches(preset) {
    if (!doc || flow.mode !== 'strip') return false;
    const bg = preset.bg || {}, pattern = preset.pattern || {};
    return doc.bg.mode === (bg.mode || 'color') &&
        doc.bg.c1 === (bg.c1 || '#ffffff') &&
        doc.bg.c2 === (bg.c2 || bg.c1 || '#ffffff') &&
        doc.pattern.id === (pattern.id || 'none') &&
        doc.pattern.color === (pattern.color || null) &&
        doc.pattern.alpha === (pattern.alpha ?? .14) &&
        doc.filter === (preset.filter || 'Normal');
}
function buildStripStyleChoices() {
    const section = $('stripStyleTools'), host = $('stripStyleGrid');
    const visible = flow.mode === 'strip' && !flow.serverTemplate;
    section.hidden = !visible;
    host.replaceChildren();
    if (!visible) return;
    STRIPS.forEach((preset, index) => {
        const button = el('button', 'tile strip-style-tile');
        button.type = 'button';
        button.classList.toggle('on', stripPresetMatches(preset));
        button.setAttribute('aria-pressed', String(stripPresetMatches(preset)));
        button.append(previewCanvas(layoutFor('strip', flow.n), preset, 50, index), el('span', '', preset.name));
        button.onclick = () => {
            const bg = preset.bg || {mode: 'color', c1: '#ffffff'};
            const pattern = preset.pattern || {};
            doc.bg = {mode: bg.mode, c1: bg.c1 || '#ffffff', c2: bg.c2 || bg.c1 || '#ffffff', imgId: null, preset: ''};
            doc.pattern = {id: pattern.id || 'none', color: pattern.color || null, alpha: pattern.alpha ?? .14, size: pattern.size ?? 1};
            doc.filter = preset.filter || 'Normal';
            flow.preset = preset;
            flow.name = `${preset.name} strip`;
            changed();
        };
        host.appendChild(button);
    });
}

/* history */
function commit() {
    const s = JSON.stringify(doc);
    if (hist[hi] === s) return;
    hist = hist.slice(0, hi + 1);
    hist.push(s);
    if (hist.length > 80) hist.shift();
    hi = hist.length - 1;
    syncUndo();
}
function restore() {
    doc = JSON.parse(hist[hi]);
    live.dirty = true;
    if (selId && !doc.stickers.some(s => s.id === selId)) selId = null;
    syncPanels(); draw(); syncUndo();
}
function undo() { if (hi > 0) { hi--; restore(); } }
function redo() { if (hi < hist.length - 1) { hi++; restore(); } }
function syncUndo() {
    const u = hi > 0, r = hi < hist.length - 1;
    $('undoBtn').disabled = !u; $('redoBtn').disabled = !r;
    $('dUndo').disabled = !u; $('dRedo').disabled = !r;
}

/* open / close */
let studioReturnView = 'home';
function openStudio() {
    studioReturnView = view;
    hist = []; hi = -1; selId = null;
    selectedTextIsDate = false; selectedTextIsLocation = false;
    selectedSlotIndex = 0;
    buildStripStyleChoices();
    buildPhotoWindowFields();
    buildText();
    if (flow.serverTemplate) buildStudioFrameFields(flow.serverTemplate);
    else { $('serverTextTools').hidden = true; serverTextSel = null; }
    commit();
    $('v-studio').hidden = false;
    show('studio');
    document.body.style.overflow = 'hidden';
    setTab('text');
    syncPanels();
    requestAnimationFrame(() => { fitStage(); draw(); });
}
function closeStudio() {
    $('v-studio').hidden = true;
    document.body.style.overflow = '';
    show(studioReturnView);
    selId = null;
    live.dirty = true;
    drawResult();
}
$('sBack').onclick = closeStudio;
$('serverTextReset').onclick = resetStudioFrameFields;
$('dlBtn').onclick = exportPNG;
$('sShare').onclick = shareResult;
$('sSave').onclick = saveCurrentTemplate;
$('undoBtn').onclick = $('dUndo').onclick = undo;
$('redoBtn').onclick = $('dRedo').onclick = redo;

/* layout of the canvas inside the stage */
function fitStage() {
    const st = $('stage'), L = doc.layout, m = window.innerWidth < 860 ? 14 : 28;
    const s = Math.min((st.clientWidth - m * 2) / L.W, (st.clientHeight - m * 2) / L.H);
    const cssW = Math.max(60, L.W * s), cssH = Math.max(60, L.H * s);
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    cv.style.left = ''; cv.style.top = '';
    dispSc = clamp(Math.ceil(s * (window.devicePixelRatio || 1) * 10) / 10, .5, 2);
    dispK = L.W / cssW;
    cv.width = Math.round(L.W * dispSc);
    cv.height = Math.round(L.H * dispSc);
}
window.addEventListener('resize', () => { if (!$('v-studio').hidden) { fitStage(); draw(); } });
cv.addEventListener('dblclick', e => {
    if (!doc || tab === 'draw') return;
    const hit = hitFooterText(docPt(e));
    if (!hit || hit.date || hit.location) return;
    selectedCaptionId = hit.id; selectedTextIsDate = false; selectedTextIsLocation = false;
    setTab('text'); buildText(); syncPanels(); draw();
    const input = $('captionFields').querySelector(`textarea[data-item-id="${hit.id}"]`);
    input?.focus(); input?.select();
});

function draw() {
    if (!doc || $('v-studio').hidden) return;
    render(cctx, doc, {sc: dispSc, photos: photosFor(doc.filter), layer: liveLayer(dispSc), sel: tab === 'draw' ? null : selId, k: dispK, placeholderSlots: true});
    // Keep the selected photo window visible as a placement guide in every
    // Studio tool. This is drawn over the preview only, never into exports.
    if (!flow.serverTemplate) drawPhotoSlotSelection(cctx);
    if (tab === 'text') {
        // Captions, dates, and locations are document text too, including on
        // server-backed frames. Draw both selection overlays so their canvas
        // rotate and X handles remain available alongside editable frame fields.
        drawCaptionSelection(cctx);
        if (flow.serverTemplate && serverTextSel != null) drawServerTextSelection(cctx);
    }
}
const CAMERA_FRAME_CHOICES = [
    {n: 1, name: 'Single'}, {n: 2, name: 'Duo'}, {n: 3, name: 'Trio'}, {n: 4, name: 'Quad'}
];
function chooseCameraFrame(n) {
    if (!doc || flow.serverTemplate || flow.mode === 'server' || ![1, 2, 3, 4].includes(n)) return;
    if (flow.mode !== 'strip' && flow.n === n && !doc.overlayOnly && !doc.layout.customPhotoWindows) return;
    const old = doc.layout, next = layoutFor('instant', n), sx = next.W / old.W, sy = next.H / old.H, scale = (sx + sy) / 2;
    (doc.text.items || []).forEach(item => {
        if (Number.isFinite(item.x)) item.x *= sx;
        if (Number.isFinite(item.y)) item.y *= sy;
    });
    ['dateX', 'locationX'].forEach(key => { if (Number.isFinite(doc.text[key])) doc.text[key] *= sx; });
    ['dateY', 'locationY'].forEach(key => { if (Number.isFinite(doc.text[key])) doc.text[key] *= sy; });
    doc.stickers.forEach(item => { item.x *= sx; item.y *= sy; item.s *= scale; });
    doc.strokes.forEach(stroke => {
        stroke.w *= scale;
        stroke.p = stroke.p.map(([x, y]) => [x * sx, y * sy]);
    });
    doc.layout = next;
    delete doc.layout.customPhotoWindows;
    doc.overlayOnly = false;
    flow.mode = 'instant'; flow.n = n; flow.preset = null; flow.layout = next;
    flow.name = `${CAMERA_FRAME_CHOICES[n - 1].name} frame`;
    photos = photos.slice(0, n); photoVer++;
    selectedSlotIndex = 0;
    live.dirty = true;
    const first = next.slots[0];
    $('cam').style.setProperty('--ar', `${first.w}/${first.h}`);
    $('cam').style.setProperty('--arn', (first.w / first.h).toFixed(4));
    $('v-capture').style.setProperty('--capture-ar', (first.w / first.h).toFixed(4));
    fitStage();
    buildCameraFrameChoices();
    buildPhotoWindowFields();
    changed();
}
function buildCameraFrameChoices() {
    const host = $('cameraFrameChoices');
    if (!host) return;
    host.replaceChildren(...CAMERA_FRAME_CHOICES.map(option => {
        const active = flow.mode !== 'strip' && flow.n === option.n && !doc?.layout?.customPhotoWindows;
        const button = el('button', `camera-frame-option${active ? ' on' : ''}`);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-label', `${option.name}, ${option.n} ${option.n === 1 ? 'photo' : 'photos'}`);
        const canvas = previewCanvas(layoutFor('instant', option.n), {}, 70);
        const title = el('b', '', option.name), count = el('small', '', `${option.n} ${option.n === 1 ? 'photo' : 'photos'}`);
        button.append(canvas, title, count);
        button.onclick = () => chooseCameraFrame(option.n);
        return button;
    }));
}
function buildPhotoWindowFields() {
    const host = $('photoWindowFields'), slots = doc && doc.layout && doc.layout.slots || [];
    const enabled = !flow.serverTemplate && slots.length > 0;
    $('photoWindowTools').hidden = !enabled;
    host.innerHTML = '';
    buildCameraFrameChoices();
    if (!enabled) return;
    if (doc.layout.customPhotoWindows) {
        const label = el('p', 'hint photo-window-custom-label', `Custom layout \u00B7 ${slots.length} ${slots.length === 1 ? 'window' : 'windows'}`);
        host.appendChild(label);
    }
    slots.forEach((slot, index) => {
        const row = el('div', `photo-window-row${index === selectedSlotIndex ? ' on' : ''}`);
        const button = el('button', `photo-window-option${index === selectedSlotIndex ? ' on' : ''}`, `Photo window ${index + 1}`);
        button.type = 'button'; button.setAttribute('aria-pressed', String(index === selectedSlotIndex));
        button.onclick = () => { selectedSlotIndex = index; buildPhotoWindowFields(); draw(); };
        const shape = el('select', 'photo-window-shape');
        shape.setAttribute('aria-label', `Shape for photo window ${index + 1}`);
        PHOTO_SHAPES.forEach(option => {
            const item = el('option', '', option.label); item.value = option.id;
            item.selected = (slot.shape || 'square') === option.id; shape.appendChild(item);
        });
        shape.onchange = () => { slot.shape = shape.value; live.dirty = true; changed(); };
        const remove = el('button', 'photo-window-remove', '\u00D7');
        remove.type = 'button'; remove.setAttribute('aria-label', `Remove photo window ${index + 1}`);
        remove.title = slots.length === 1 ? 'At least one photo window is required' : `Remove photo window ${index + 1}`;
        remove.disabled = slots.length <= 1;
        remove.onclick = () => removePhotoWindow(index);
        row.append(button, shape, remove);
        host.appendChild(row);
    });
}
function removePhotoWindow(index) {
    const slots = doc && doc.layout && doc.layout.slots;
    if (!slots || slots.length <= 1 || index < 0 || index >= slots.length) return;
    slots.splice(index, 1);
    doc.layout.n = slots.length;
    doc.layout.customPhotoWindows = true;
    photos.splice(index, 1); photoVer++;
    flow.mode = 'instant'; flow.n = slots.length; flow.preset = null; flow.layout = doc.layout;
    flow.name = `Custom ${slots.length}-window frame`;
    selectedSlotIndex = Math.min(selectedSlotIndex === index ? index : selectedSlotIndex > index ? selectedSlotIndex - 1 : selectedSlotIndex, slots.length - 1);
    live.dirty = true;
    buildPhotoWindowFields();
    fitStage();
    changed();
}
function photoSlotBox(index = selectedSlotIndex) {
    const s = doc && doc.layout && doc.layout.slots[index];
    return s ? {x: s.x, y: s.y, w: s.w, h: s.h} : null;
}
function drawPhotoSlotSelection(ctx) {
    const b = photoSlotBox(); if (!b) return;
    const k = dispK;
    ctx.save(); ctx.setTransform(dispSc, 0, 0, dispSc, 0, 0);
    ctx.strokeStyle = '#e4492b'; ctx.lineWidth = 2 * k; ctx.setLineDash([]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    const points = [[b.x,b.y],[b.x+b.w/2,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h/2],[b.x+b.w,b.y+b.h/2],[b.x,b.y+b.h],[b.x+b.w/2,b.y+b.h],[b.x+b.w,b.y+b.h]];
    const grip = 8 * k;
    points.forEach(([x,y]) => { ctx.fillStyle='#fff'; ctx.strokeStyle='#e4492b'; ctx.lineWidth=1.5*k; ctx.beginPath(); ctx.roundRect(x-grip/2,y-grip/2,grip,grip,2*k); ctx.fill(); ctx.stroke(); });
    // Compact delete control floats above the top-right corner.
    const cx = b.x + b.w, cy = b.y - 15 * k, r = 11 * k;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fillStyle='#e4492b'; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.6*k; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(cx-4*k,cy-4*k); ctx.lineTo(cx+4*k,cy-4*k); ctx.moveTo(cx-3*k,cy-2*k); ctx.lineTo(cx-2*k,cy+4*k); ctx.moveTo(cx+3*k,cy-2*k); ctx.lineTo(cx+2*k,cy+4*k); ctx.moveTo(cx-2*k,cy+5*k); ctx.lineTo(cx+2*k,cy+5*k); ctx.stroke();
    ctx.restore();
}
function photoSlotHandle(p) {
    const b = photoSlotBox(), k = dispK;
    if (!b) return null;
    const radius = 12 * k;
    if (Math.hypot(p.x - (b.x + b.w), p.y - (b.y - 15 * k)) <= radius) return {type:'delete'};
    const points = [
        ['nw',b.x,b.y],['n',b.x+b.w/2,b.y],['ne',b.x+b.w,b.y],['w',b.x,b.y+b.h/2],['e',b.x+b.w,b.y+b.h/2],
        ['sw',b.x,b.y+b.h],['s',b.x+b.w/2,b.y+b.h],['se',b.x+b.w,b.y+b.h]
    ];
    const handle = points.find(([,x,y]) => Math.hypot(p.x-x,p.y-y) <= radius);
    return handle ? {type:'resize', edge:handle[0]} : null;
}
function hitPhotoSlot(p) {
    const slots = doc && doc.layout && doc.layout.slots || [];
    for (let i = slots.length - 1; i >= 0; i--) {
        const s = slots[i];
        if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) return i;
    }
    return -1;
}
function serverFieldBox(f) {
    const state = frameTextState(f), L = flow.layout;
    const x = Number.isFinite(state.x) ? state.x : f.x;
    const y = Number.isFinite(state.y) ? state.y : f.y;
    const w = Number.isFinite(state.w) ? state.w : f.w;
    const h = Number.isFinite(state.h) ? state.h : f.h;
    return {x: x * L.W, y: y * L.H, w: w * L.W, h: h * L.H};
}
function drawServerTextSelection(ctx) {
    const f = flow.serverTemplate.texts.find(item => String(item.id) === String(serverTextSel));
    if (!f) return;
    const state = frameTextState(f);
    if (state.hidden) return;
    const b = serverFieldBox(f);
    const rotation = Number(state.rotation) || 0, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    ctx.save(); ctx.setTransform(dispSc, 0, 0, dispSc, 0, 0); ctx.translate(cx, cy); ctx.rotate(rotation);
    ctx.strokeStyle = '#e4492b'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#e4492b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-b.w / 2, -b.h / 2, 10 * dispK, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e4492b'; ctx.font = `${12 * dispK}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('×', -b.w / 2, -b.h / 2 + .5);
    ctx.beginPath(); ctx.arc(b.w / 2, -b.h / 2, 10 * dispK, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.w / 2 - 4 * dispK, -b.h / 2 + 2 * dispK); ctx.lineTo(b.w / 2 + 4 * dispK, -b.h / 2 - 2 * dispK); ctx.stroke();
    ctx.fillStyle = '#e4492b'; ctx.fillRect(b.w / 2 - 7, b.h / 2 - 7, 14, 14);
    ctx.restore();
}
function hitServerText(p) {
    const fields = flow.serverTemplate && flow.serverTemplate.texts || [];
    for (let i = fields.length - 1; i >= 0; i--) {
        const f = fields[i], state = frameTextState(f);
        if (state.hidden) continue;
        const b = serverFieldBox(f), r = Number(state.rotation) || 0, dx = p.x - b.x - b.w / 2, dy = p.y - b.y - b.h / 2;
        const lx = dx * Math.cos(r) + dy * Math.sin(r), ly = -dx * Math.sin(r) + dy * Math.cos(r);
        if (lx >= -b.w / 2 - 10 && lx <= b.w / 2 + 10 && ly >= -b.h / 2 - 10 && ly <= b.h / 2 + 10) return f;
    }
    return null;
}

/* tabs */
function setTab(t) {
    tab = t;
    document.querySelectorAll('#rail button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + t));
    cv.classList.toggle('drawing', t === 'draw' && !pen.e);
    cv.classList.toggle('erasing', t === 'draw' && pen.e);
    cv.classList.toggle('panning', t === 'bg' && doc.bg.mode === 'image');
    if (t === 'filters') buildFilters();
    if (t === 'pattern') buildPatterns();
    $('panel').scrollTop = 0;
    draw();
}
document.querySelectorAll('#rail button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

/* swatches */
function swatches(host, items, onPick, opts = {}) {
    host.innerHTML = '';
    if (opts.auto) {
        const b = el('button', 'sw auto'); b.title = 'Automatic'; b._v = null;
        b.onclick = () => onPick(null);
        host.appendChild(b);
    }
    items.forEach(it => {
        const b = el('button', 'sw');
        b._v = it;
        b.style.background = Array.isArray(it) ? `linear-gradient(135deg,${it[0]},${it[1]})` : it;
        b.title = Array.isArray(it) ? it.join(' \u2192 ') : it;
        b.onclick = () => onPick(it);
        host.appendChild(b);
    });
}
const markSw = (host, test) => [...host.children].forEach(b => b.classList.toggle('on', test(b._v)));
const same = (a, b) => (a == null || b == null) ? a == b : (Array.isArray(a) ? Array.isArray(b) && a[0] === b[0] && a[1] === b[1] : String(a).toLowerCase() === String(b).toLowerCase());

/* --- background panel --- */
const BG_FRAME_PRESETS = [
    ['Blush', '#fff0f3', '#e9a9bd', 'dots'],
    ['Botanical', '#eff4e9', '#78966a', 'leaves'],
    ['Golden', '#fff7df', '#d6a843', 'stars'],
    ['Confetti', '#f2efff', '#8871d9', 'confetti'],
    ['Ocean', '#e7f5f7', '#4c9da7', 'waves'],
    ['Midnight', '#25213a', '#d4baff', 'stars'],
    ['Birthday', '#fff1e7', '#f06b86', 'birthday'],
    ['Diwali', '#311b12', '#ffb52e', 'diwali']
];
function bgFrameSvg(preset) {
    const [, bg, accent, style] = preset;
    let art = '';
    if (style === 'dots') art = `<pattern id="p" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="3" fill="${accent}" opacity=".48"/><circle cx="25" cy="25" r="2" fill="${accent}" opacity=".3"/></pattern>`;
    if (style === 'leaves') art = `<pattern id="p" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M4 38Q8 9 36 5Q32 33 4 38M4 38l25-25" fill="${accent}" opacity=".36"/><path d="M30 48Q32 27 48 25Q46 43 30 48" fill="${accent}" opacity=".22"/></pattern>`;
    if (style === 'stars') art = `<pattern id="p" width="54" height="54" patternUnits="userSpaceOnUse"><path d="M14 4l3 8 8 3-8 3-3 8-3-8-8-3 8-3zM42 32l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="${accent}" opacity=".48"/></pattern>`;
    if (style === 'confetti') art = `<pattern id="p" width="58" height="58" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="4" fill="${accent}" opacity=".65"/><path d="M34 5l5 12M8 42l13-4M42 40l8 8" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity=".55"/><circle cx="48" cy="22" r="2" fill="${accent}"/></pattern>`;
    if (style === 'waves') art = `<pattern id="p" width="60" height="32" patternUnits="userSpaceOnUse"><path d="M-10 16Q5 2 20 16T50 16T80 16" fill="none" stroke="${accent}" stroke-width="2" opacity=".42"/></pattern>`;
    if (style === 'birthday') art = `<pattern id="p" width="96" height="96" patternUnits="userSpaceOnUse"><path d="M18 4v20M66 44v20" stroke="${accent}" stroke-width="4"/><path d="M18 2l-5 8h10zM66 42l-5 8h10z" fill="#f5bd45"/><circle cx="46" cy="18" r="5" fill="#72b8a0"/><circle cx="82" cy="80" r="5" fill="#8871d9"/><path d="M8 72l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="${accent}" opacity=".7"/></pattern>`;
    if (style === 'diwali') art = `<pattern id="p" width="100" height="90" patternUnits="userSpaceOnUse"><path d="M18 48q18 25 36 0z" fill="${accent}"/><path d="M36 28q-10 12 0 18q10-6 0-18" fill="#ffe78a"/><circle cx="78" cy="20" r="3" fill="#ffe78a"/><path d="M78 10v-5m0 30v-5m10-10h5m-30 0h5m17-7 4-4m-22 22 4-4m14 0 4 4m-22-22 4 4" stroke="#ffe78a" stroke-width="2"/></pattern>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640"><rect width="480" height="640" fill="${bg}"/><defs>${art}</defs><rect width="480" height="640" fill="url(#p)"/></svg>`;
}
function useBgImage(img, lum, preset = '') {
    const id = 'img' + imgSeq++;
    IMGS[id] = {img, lum};
    doc.bg = {mode: 'image', c1: '#ffffff', c2: '#ffffff', imgId: id, preset, zoom: 1, ox: 0, oy: 0};
    changed();
}
function buildBackground() {
    swatches($('bgColors'), BG_COLORS, c => { doc.bg = {mode: 'color', c1: c, c2: c, imgId: null}; changed(); });
    swatches($('bgGrads'), BG_GRADS, g => { doc.bg = {mode: 'gradient', c1: g[0], c2: g[1], imgId: null}; changed(); });
    const bgGrid = $('bgFrameGrid');
    bgGrid.innerHTML = '';
    BG_FRAME_PRESETS.forEach(preset => {
        const [name, bg, accent] = preset, button = el('button', 'tile bg-frame-tile');
        button.type = 'button'; button.title = name; button.setAttribute('aria-label', `${name} background`); button._v = name;
        const thumb = mk(96, 112), x = thumb.getContext('2d');
        x.fillStyle = bg; x.fillRect(0, 0, 96, 112); x.fillStyle = accent;
        for (let i = 0; i < 9; i++) { x.globalAlpha = .24 + (i % 3) * .08; x.beginPath(); x.arc(12 + (i % 3) * 34, 14 + Math.floor(i / 3) * 34, 4 + i % 2, 0, Math.PI * 2); x.fill(); }
        x.globalAlpha = 1; button.append(thumb, el('span', '', name));
        button.onclick = () => {
            const data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bgFrameSvg(preset));
            const img = new Image();
            img.onload = () => useBgImage(img, lumOf(bg), name);
            img.onerror = () => toast('Could not load that background');
            img.src = data;
        };
        bgGrid.appendChild(button);
    });
    let studioBackgrounds = [];
    try { studioBackgrounds = JSON.parse($('studioBackgrounds')?.textContent || '[]'); } catch { studioBackgrounds = []; }
    studioBackgrounds.forEach(({name, url}) => {
        const button = el('button', 'tile bg-frame-tile');
        button.type = 'button'; button.title = name; button.setAttribute('aria-label', `${name} background`); button._v = url;
        const thumb = mk(96, 112), ctx = thumb.getContext('2d');
        const image = new Image();
        image.onload = () => {
            const scale = Math.max(thumb.width / image.naturalWidth, thumb.height / image.naturalHeight);
            const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
            ctx.drawImage(image, (thumb.width - w) / 2, (thumb.height - h) / 2, w, h);
        };
        image.onerror = () => { button.disabled = true; button.title = `${name} (could not load)`; };
        image.src = url;
        button.append(thumb, el('span', '', name));
        button.onclick = () => {
            if (!image.complete || !image.naturalWidth) { toast('Could not load that background'); return; }
            const sample = mk(16, 16), sampleCtx = sample.getContext('2d');
            sampleCtx.drawImage(image, 0, 0, 16, 16);
            const pixels = sampleCtx.getImageData(0, 0, 16, 16).data;
            let brightness = 0;
            for (let i = 0; i < pixels.length; i += 4) brightness += .299 * pixels[i] + .587 * pixels[i + 1] + .114 * pixels[i + 2];
            useBgImage(image, brightness / (256 * 255), url);
        };
        bgGrid.appendChild(button);
    });
    const ci = $('bgCustom');
    ci.oninput = () => { doc.bg = {mode: 'color', c1: ci.value, c2: ci.value, imgId: null}; live2(); };
    ci.onchange = () => { changed(); };
    $('bgUpload').onclick = () => $('bgFile').click();
    $('bgFile').onchange = async e => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        try {
            const r = await loadBitmap(f), im = r.src;
            const t = mk(16, 16), x = t.getContext('2d');
            x.drawImage(im, 0, 0, 16, 16);
            const d = x.getImageData(0, 0, 16, 16).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) sum += .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
            useBgImage(im, sum / (256 * 255));
        } catch (err) { toast('Could not read that image'); }
    };
    const zs = $('bgZoom');
    const setZoom = z => {
        doc.bg.zoom = clamp(z, .5, 4);
        const bx = bgImgBox(doc);
        if (bx) { doc.bg.ox = bx.ox; doc.bg.oy = bx.oy; }
    };
    zs.oninput = () => { setZoom(zs.value / 100); live2(); };
    zs.onchange = changed;
    $('bgReset').onclick = () => { doc.bg.zoom = 1; doc.bg.ox = 0; doc.bg.oy = 0; changed(); };
    let wheelT;
    cv.addEventListener('wheel', e => {
        if (tab !== 'bg' || doc.bg.mode !== 'image') return;
        e.preventDefault();
        setZoom((doc.bg.zoom || 1) * Math.exp(-e.deltaY * .0015));
        $('bgZoom').value = Math.round(doc.bg.zoom * 100);
        draw();
        clearTimeout(wheelT);
        wheelT = setTimeout(commit, 400);
    }, {passive: false});
    $('bgRemove').onclick = () => { doc.bg = {mode: 'color', c1: doc.bg.c1 || '#ffffff', c2: doc.bg.c1 || '#ffffff', imgId: null}; changed(); };
}

/* --- pattern panel --- */
function buildPatterns() {
    const host = $('patGrid');
    host.innerHTML = '';
    PATTERNS.forEach(([id, name]) => {
        const b = el('button', 'tile'); b._v = id;
        const c = mk(120, 120), x = c.getContext('2d');
        x.fillStyle = '#f1ece0'; x.fillRect(0, 0, 120, 120);
        const fake = {bg: {mode: 'color', c1: '#f1ece0'}, pattern: {id, color: id === 'confetti' ? null : '#e4492b', alpha: id === 'confetti' ? .9 : .55, size: 1}};
        x.save(); x.scale(.5, .5); drawPattern(x, fake, 240, 240); x.restore();
        if (id === 'none') { x.fillStyle = '#b9b2a2'; x.font = '600 13px system-ui'; x.textAlign = 'center'; x.fillText('\u2014', 60, 66); }
        b.append(c, el('span', '', name));
        b.onclick = () => { doc.pattern.id = id; changed(); };
        host.appendChild(b);
    });
    syncPanels();
}
function buildPatternControls() {
    swatches($('patColors'), ['#ffffff', '#000000', '#e4492b', '#e0457b', '#f5c46b', '#3b82f6', '#2f9e6e', '#a78bfa'], c => { doc.pattern.color = c; changed(); }, {auto: true});
    const ci = $('patCustom');
    ci.oninput = () => { doc.pattern.color = ci.value; live2(); };
    ci.onchange = changed;
    const a = $('patAlpha'), s = $('patSize');
    a.oninput = () => { doc.pattern.alpha = a.value / 100; live2(); };
    a.onchange = changed;
    s.oninput = () => { doc.pattern.size = s.value / 100; live2(); };
    s.onchange = changed;
}

/* --- stickers panel --- */
function buildStickers() {
    const cats = $('stkCats');
    cats.innerHTML = '';
    Object.keys(STICKERS).forEach(k => {
        const b = el('button', 'chip' + (k === stkCat ? ' on' : ''), k);
        b.onclick = () => { stkCat = k; buildStickers(); };
        cats.appendChild(b);
    });
    const g = $('stkGrid');
    g.innerHTML = '';
    STICKERS[stkCat].forEach(e => {
        const b = el('button', '', e);
        b.onclick = () => addSticker(e);
        g.appendChild(b);
    });
}
function addSticker(e) {
    const L = doc.layout, sl = L.slots[Math.floor(Math.random() * L.slots.length)];
    const s = {id: doc.nid++, e, x: sl.x + sl.w / 2 + (Math.random() - .5) * sl.w * .3, y: sl.y + sl.h / 2 + (Math.random() - .5) * sl.h * .3, s: Math.round(L.W * .2), r: (Math.random() - .5) * .3};
    doc.stickers.push(s);
    selId = s.id;
    changed();
}
const logoImages = new Map();
function removePlainBackground(source) {
    const maxSide = 1400, scale = Math.min(1, maxSide / Math.max(source.naturalWidth, source.naturalHeight));
    const canvas = mk(source.naturalWidth * scale, source.naturalHeight * scale), ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height), px = image.data, w = canvas.width, h = canvas.height, n = w * h;
    const sw = Math.min(12, w), sh = Math.min(12, h);
    const samples = [[0, 0], [w - sw, 0], [0, h - sh], [w - sw, h - sh]].map(([sx, sy]) => {
        const sum = [0, 0, 0]; let count = 0;
        for (let y = sy; y < sy + sh; y += 2) for (let x = sx; x < sx + sw; x += 2) {
            const i = (y * w + x) * 4; if (px[i + 3] < 16) continue;
            sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; count++;
        }
        return count ? sum.map(v => v / count) : [255, 255, 255];
    });
    const colorDistance = i => {
        let best = Infinity;
        for (let k = 0; k < samples.length; k++) {
            const c = samples[k], dr = px[i] - c[0], dg = px[i + 1] - c[1], db = px[i + 2] - c[2];
            const distance = Math.sqrt(dr * dr + dg * dg + db * db);
            if (distance < best) best = distance;
        }
        return best;
    };
    const similar = i => {
        return px[i + 3] > 16 && colorDistance(i) < 76;
    };
    const seen = new Uint8Array(n), queue = new Uint32Array(n); let head = 0, tail = 0;
    const seed = i => { const p = i / 4; if (!seen[p] && similar(i)) { seen[p] = 1; queue[tail++] = p; } };
    for (let x = 0; x < w; x++) { seed(x * 4); seed(((h - 1) * w + x) * 4); }
    for (let y = 1; y < h - 1; y++) { seed(y * w * 4); seed((y * w + w - 1) * 4); }
    while (head < tail) {
        const p = queue[head++], x = p % w, y = (p / w) | 0, i = p * 4;
        const dist = colorDistance(i);
        px[i + 3] = Math.round(px[i + 3] * Math.max(0, Math.min(1, (dist - 24) / 48)));
        const neighbors = [x ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y ? p - w : -1, y + 1 < h ? p + w : -1];
        for (const q of neighbors) if (q >= 0 && !seen[q] && similar(q * 4)) { seen[q] = 1; queue[tail++] = q; }
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
}
function addLogo(src, replaceId = null) {
    const image = new Image();
    image.onload = () => {
        logoImages.set(src, image);
        const existing = replaceId && doc.stickers.find(item => String(item.id) === String(replaceId));
        if (existing) {
            existing.src = src;
            selId = existing.id;
            changed();
            toast('Image replaced. Drag it to position it.');
            return;
        }
        const L = doc.layout, s = {id: doc.nid++, src, x: L.W / 2, y: L.H / 2, s: Math.round(L.W * .28), r: 0};
        doc.stickers.push(s); selId = s.id; changed();
        toast('Background removed. Drag the image to position it.');
    };
    image.onerror = () => toast('Could not prepare this image');
    image.src = src;
}
function uploadLogo(file, replaceId = null) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Choose a PNG, JPG, or WebP image'); return; }
    if (file.size > 12 * 1024 * 1024) { toast('Choose an image smaller than 12 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
        const source = new Image();
        source.onload = () => {
            try { addLogo(removePlainBackground(source), replaceId); }
            catch (error) { toast('Could not remove the image background'); }
        };
        source.onerror = () => toast('Could not read this image');
        source.src = reader.result;
    };
    reader.onerror = () => toast('Could not read this image');
    reader.readAsDataURL(file);
}
const logoFile = $('logoFile');
$('logoUpload').onclick = () => { replacingStickerId = null; logoFile.click(); };
let replacingStickerId = null;
$('replaceLogo').onclick = () => { replacingStickerId = selId; logoFile.click(); };
logoFile.onchange = () => { uploadLogo(logoFile.files[0], replacingStickerId); replacingStickerId = null; logoFile.value = ''; };
const selSticker = () => doc.stickers.find(s => s.id === selId);
function delSticker(id) { doc.stickers = doc.stickers.filter(s => s.id !== id); if (selId === id) selId = null; }
$('stkSmall').onclick = () => { const s = selSticker(); if (s) { s.s = Math.max(40, s.s * .85); changed(); } };
$('stkBig').onclick = () => { const s = selSticker(); if (s) { s.s = Math.min(700, s.s * 1.18); changed(); } };
$('stkRot').onclick = () => { const s = selSticker(); if (s) { s.r += Math.PI / 12; changed(); } };
$('stkDuplicate').onclick = () => { const s = selSticker(); if (s) { const copy = {...s, id: doc.nid++, x: clamp(s.x + 28, 20, doc.layout.W - 20), y: clamp(s.y + 28, 20, doc.layout.H - 20)}; doc.stickers.push(copy); selId = copy.id; changed(); } };
$('stkDel').onclick = () => { if (selId) { delSticker(selId); changed(); } };

/* --- text panel --- */
function selectedTextTarget() {
    if (!doc) return null;
    if (selectedTextIsDate || selectedTextIsLocation) return doc.text;
    return (doc.text.items || []).find(item => String(item.id) === String(selectedCaptionId)) || doc.text;
}

function buildText() {
    if (!Array.isArray(doc.text.items)) doc.text.items = doc.text.caption ? [{id: 1, value: doc.text.caption}] : [];
    if (!Number.isFinite(doc.text.nextItemId)) doc.text.nextItemId = Math.max(0, ...doc.text.items.map(item => Number(item.id) || 0)) + 1;
    if (!doc.text.items.some(item => String(item.id) === String(selectedCaptionId))) selectedCaptionId = doc.text.items[0]?.id ?? null;
    const fields = $('captionFields');
    fields.innerHTML = '';
    doc.text.items.forEach(item => {
        const row = el('div', `caption-field${String(item.id) === String(selectedCaptionId) ? ' is-selected' : ''}`);
        const input = document.createElement('textarea'); input.rows = 2; input.maxLength = 80; input.placeholder = 'Type a caption'; input.value = item.value || '';
        input.dataset.itemId = item.id;
        input.setAttribute('aria-label', 'Caption text. Press Shift+Enter to start a new line.');
        input.addEventListener('focus', () => { selectedCaptionId = item.id; selectedTextIsDate = false; selectedTextIsLocation = false; fields.querySelectorAll('.caption-field').forEach(entry => entry.classList.toggle('is-selected', entry === row)); syncPanels(); draw(); });
        input.addEventListener('input', () => { item.value = input.value; doc.text.caption = item.value; live2(); });
        input.addEventListener('change', changed);
        const remove = el('button', 'caption-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove caption');
        remove.onclick = () => { doc.text.items = doc.text.items.filter(entry => entry !== item); selectedCaptionId = doc.text.items[0]?.id ?? null; buildText(); changed(); };
        const rotate = el('button', 'caption-rotate', '↻'); rotate.type = 'button'; rotate.setAttribute('aria-label', 'Rotate caption 15 degrees'); rotate.title = 'Rotate 15°';
        rotate.onclick = () => { selectedCaptionId = item.id; selectedTextIsDate = false; selectedTextIsLocation = false; item.rotation = (item.rotation || 0) + Math.PI / 12; syncPanels(); changed(); };
        const duplicate = el('button', 'caption-duplicate', '⧉'); duplicate.type = 'button'; duplicate.title = 'Duplicate text'; duplicate.setAttribute('aria-label', 'Duplicate text');
        duplicate.onclick = () => { const copy = {...item, id: doc.text.nextItemId++, x: (item.x ?? doc.layout.W / 2) + 24, y: (item.y ?? doc.layout.H / 2) + 24}; doc.text.items.push(copy); selectedCaptionId = copy.id; selectedTextIsDate = false; selectedTextIsLocation = false; buildText(); changed(); const next = fields.querySelector(`textarea[data-item-id="${copy.id}"]`); next?.focus(); next?.select(); };
        row.append(input, duplicate, rotate, remove); fields.append(row);
    });
    const addStyledText = (value, size) => {
        const item = {
            id: doc.text.nextItemId++, value, x: doc.layout.W / 2, y: doc.layout.H / 2,
            font: doc.text.font, color: doc.text.color || null, size,
            bold: !!doc.text.bold, italic: !!doc.text.italic, align: 'center'
        };
        doc.text.items.push(item); selectedCaptionId = item.id; selectedTextIsDate = false; selectedTextIsLocation = false; buildText(); changed();
        const input = fields.lastElementChild?.querySelector('textarea'); input?.focus(); input?.select();
    };
    $('addHeading').onclick = () => addStyledText('Add a heading', 1.5);
    $('addSubheading').onclick = () => addStyledText('Add a subheading', 1.15);
    $('addBodyText').onclick = () => addStyledText('Add body text', .82);
    const fontSelect = $('textFont');
    if (fontSelect) {
        fontSelect.innerHTML = '';
        FONTS.forEach((font, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = font.n;
            option.style.fontFamily = font.family;
            option.style.fontWeight = String(font.weight);
            fontSelect.appendChild(option);
        });
        fontSelect.onchange = () => {
            const target = selectedTextTarget();
            if (!target) return;
            target.font = Number(fontSelect.value);
            if (target === doc.text) doc.text.font = Number(fontSelect.value);
            changed();
            const font = FONTS[Number(fontSelect.value)];
            if (font && document.fonts) document.fonts.load(font.css(48), 'Aa').then(() => { if (!cv.hidden) draw(); }).catch(() => {});
        };
    } else if ($('fontChips')) {
        const chips = $('fontChips');
        chips.innerHTML = '';
        FONTS.slice(0, 5).forEach((font, index) => {
            const button = el('button', 'chip', font.n);
            button.dataset.i = index;
            button.style.font = font.css(14);
            button.onclick = () => {
                const target = selectedTextTarget();
                if (!target) return;
                target.font = index;
                if (target === doc.text) doc.text.font = index;
                changed();
            };
            chips.appendChild(button);
        });
    }
    const textSize = $('textSize');
    if (textSize && textSize.tagName === 'SELECT') {
        textSize.innerHTML = '';
        FONT_SIZES.forEach(size => {
            const option = document.createElement('option');
            option.value = String(size);
            option.textContent = `${size} pt`;
            textSize.appendChild(option);
        });
        textSize.onchange = () => {
            const target = selectedTextTarget();
            if (!target) return;
            const scale = Number(textSize.value) / FONT_SIZE_BASE;
            target.size = scale;
            if (target === doc.text) doc.text.size = scale;
            changed();
        };
        const bumpTextSize = delta => {
            const target = selectedTextTarget();
            if (!target) return;
            const current = Number(textSize.value) || 24;
            const next = FONT_SIZES.reduce((best, value) => Math.abs(value - (current + delta)) < Math.abs(best - (current + delta)) ? value : best, FONT_SIZES[0]);
            textSize.value = String(next); textSize.onchange();
        };
        $('textSizeDown').onclick = () => bumpTextSize(-2);
        $('textSizeUp').onclick = () => bumpTextSize(2);
    } else if (textSize) {
        const sizeValue = $('textSizeValue');
        const setSize = value => {
            const target = selectedTextTarget();
            if (!target) return;
            const scaled = clamp(value / 100, .5, 2);
            target.size = scaled;
            if (target === doc.text) doc.text.size = scaled;
            textSize.value = String(value);
            if (sizeValue) sizeValue.value = `${value}%`;
            changed();
        };
        textSize.oninput = () => {
            const target = selectedTextTarget();
            if (!target) return;
            target.size = clamp(+textSize.value / 100, .5, 2);
            if (target === doc.text) doc.text.size = target.size;
            if (sizeValue) sizeValue.value = `${textSize.value}%`;
            live2();
        };
        textSize.onchange = changed;
        if ($('textSizeDown')) $('textSizeDown').onclick = () => setSize(Math.max(50, +textSize.value - 10));
        if ($('textSizeUp')) $('textSizeUp').onclick = () => setSize(Math.min(200, +textSize.value + 10));
    }
    [['textBold', 'bold'], ['textItalic', 'italic']].forEach(([id, key]) => {
        const button = $(id);
        if (!button) return;
        button.onclick = () => {
            const target = selectedTextTarget();
            if (!target) return;
            target[key] = !target[key];
            if (target === doc.text) doc.text[key] = target[key];
            changed();
        };
    });
    $('textUnderline').onclick = () => {
        const target = selectedTextTarget(); if (!target) return;
        const key = selectedTextIsDate ? 'dateUnderline' : selectedTextIsLocation ? 'locationUnderline' : 'underline';
        target[key] = !target[key];
        changed();
    };
    [['textAlignLeft','left'],['textAlignCenter','center'],['textAlignRight','right']].forEach(([id,align]) => {
        $(id).onclick = () => {
            const target = selectedTextTarget(); if (!target) return;
            const key = selectedTextIsDate ? 'dateAlign' : selectedTextIsLocation ? 'locationAlign' : 'align';
            target[key] = align;
            if (target !== doc.text && !selectedTextIsDate && !selectedTextIsLocation) target.align = align;
            changed();
        };
    });
    swatches($('txtColors'), INK_COLORS, c => { doc.text.color = c; const item = !selectedTextIsDate && !selectedTextIsLocation && doc.text.items.find(entry => String(entry.id) === String(selectedCaptionId)); if (item) item.color = c; changed(); }, {auto: true});
    const ci = $('txtCustom');
    ci.oninput = () => { doc.text.color = ci.value; const item = !selectedTextIsDate && !selectedTextIsLocation && doc.text.items.find(entry => String(entry.id) === String(selectedCaptionId)); if (item) item.color = ci.value; live2(); };
    ci.onchange = changed;
    const dt = $('dateIn'), on = $('dateOn'), location = $('locationIn');
    dt.onfocus = () => { selectedTextIsDate = true; selectedTextIsLocation = false; syncPanels(); draw(); };
    dt.oninput = () => { doc.text.date = dt.value; live2(); };
    dt.onchange = changed;
    on.onfocus = () => { selectedTextIsDate = true; selectedTextIsLocation = false; syncPanels(); draw(); };
    on.onchange = () => { doc.text.showDate = on.checked; changed(); };
    $('rotateDate').onclick = () => { selectedTextIsDate = true; selectedTextIsLocation = false; doc.text.showDate = true; on.checked = true; doc.text.dateRotation = (doc.text.dateRotation || 0) + Math.PI / 12; syncPanels(); changed(); };
    $('removeDate').onclick = () => { doc.text.showDate = false; on.checked = false; changed(); };
    location.value = doc.text.location || '';
    location.onfocus = () => { selectedTextIsDate = false; selectedTextIsLocation = true; syncPanels(); draw(); };
    location.oninput = () => { doc.text.location = location.value; live2(); };
    location.onchange = changed;
    $('rotateLocation').onclick = () => { selectedTextIsDate = false; selectedTextIsLocation = true; doc.text.locationRotation = (doc.text.locationRotation || 0) + Math.PI / 12; syncPanels(); changed(); };
    $('removeLocation').onclick = () => { doc.text.location = ''; location.value = ''; changed(); };
    const rotation = $('textRotation'), rotationValue = $('textRotationValue');
    const selectedTextRotation = () => {
        if (selectedTextIsDate) return doc.text.dateRotation || 0;
        if (selectedTextIsLocation) return doc.text.locationRotation || 0;
        const item = (doc.text.items || []).find(entry => String(entry.id) === String(selectedCaptionId));
        return item && item.rotation || 0;
    };
    rotation.value = String(Math.round(selectedTextRotation() * 180 / Math.PI));
    rotationValue.value = `${rotation.value}°`;
    rotation.oninput = () => {
        const radians = (+rotation.value) * Math.PI / 180;
        if (selectedTextIsDate) doc.text.dateRotation = radians;
        else if (selectedTextIsLocation) doc.text.locationRotation = radians;
        else {
            const item = (doc.text.items || []).find(entry => String(entry.id) === String(selectedCaptionId));
            if (item) item.rotation = radians;
        }
        rotationValue.value = `${rotation.value}°`;
        live2();
    };
    rotation.onchange = changed;
}

function hitFooterText(p) {
    const t = doc.text, L = doc.layout;
    const hit = (value, x, y, rotation, font, size, bold, italic, align = 'center') => {
        if (!String(value || '').trim()) return false;
        const px = Math.round(size), fo = font || FONTS[0];
        cctx.save(); cctx.font = fo.css(px, bold, italic);
        let width = cctx.measureText(String(value).trim()).width;
        cctx.restore();
        if (width > L.W - 48) width = L.W - 48;
        const dx = p.x - x, dy = p.y - y, c = Math.cos(rotation || 0), s = Math.sin(rotation || 0);
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        const left = align === 'left' ? 0 : align === 'right' ? -width : -width/2;
        return lx >= left - 12 && lx <= left + width + 12 && Math.abs(ly) <= px * .8 + 10;
    };
    if (String(t.location || '').trim()) {
        const value = String(t.location).trim(), font = FONTS[t.font] || FONTS[0];
        if (hit(value, Number.isFinite(t.locationX) ? t.locationX : L.W / 2,
            Number.isFinite(t.locationY) ? t.locationY : L.H * .57, t.locationRotation, font, L.W * .038 * (t.size || 1), t.bold, t.italic, t.locationAlign)) return {id: '__location', location: true};
    }
    if (t.showDate && t.date) {
        const font = FONTS[t.font] || FONTS[0];
        if (hit(fmtDate(t.date), Number.isFinite(t.dateX) ? t.dateX : L.W / 2,
            Number.isFinite(t.dateY) ? t.dateY : L.H / 2, t.dateRotation, font, L.W * .042 * (t.size || 1), t.bold, t.italic, t.dateAlign)) return {id: '__date', date: true};
    }
    const items = (t.items || (t.caption ? [{id: 1, value: t.caption}] : [])).filter(item => String(item.value || '').trim());
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const y = Number.isFinite(item.y) ? item.y : doc.layout.H / 2 + (i - (items.length - 1) / 2) * doc.layout.H * .07;
        const font = FONTS[item.font ?? t.font] || FONTS[0];
        if (hit(item.value, Number.isFinite(item.x) ? item.x : L.W / 2, y, item.rotation,
            font, font.k * L.W * (item.size || t.size || 1), item.bold ?? t.bold, item.italic ?? t.italic, item.align || t.align)) return item;
    }
    return null;
}
function captionSelectionBox() {
    if (!doc) return null;
    const t = doc.text, L = doc.layout;
    let value, x, y, rotation, font, scale, basePx, bold, italic, align = 'center';
    if (selectedTextIsDate) {
        if (!t.showDate || !t.date) return null;
        value = fmtDate(t.date); x = Number.isFinite(t.dateX) ? t.dateX : L.W / 2; y = Number.isFinite(t.dateY) ? t.dateY : L.H / 2;
        rotation = t.dateRotation || 0; font = FONTS[t.font] || FONTS[0]; scale = t.size || 1; basePx = L.W * .042 * scale; align = t.dateAlign || 'center';
        bold = t.bold; italic = t.italic;
    } else if (selectedTextIsLocation) {
        if (!String(t.location || '').trim()) return null;
        value = String(t.location).trim(); x = Number.isFinite(t.locationX) ? t.locationX : L.W / 2; y = Number.isFinite(t.locationY) ? t.locationY : L.H * .57;
        rotation = t.locationRotation || 0; font = FONTS[t.font] || FONTS[0]; scale = t.size || 1; basePx = L.W * .038 * scale; align = t.locationAlign || 'center';
        bold = t.bold; italic = t.italic;
    } else {
        const item = (t.items || []).find(entry => String(entry.id) === String(selectedCaptionId));
        if (!item || !String(item.value || '').trim()) return null;
        value = String(item.value).trim(); x = Number.isFinite(item.x) ? item.x : L.W / 2;
        const captions = t.items.filter(entry => String(entry.value || '').trim()), index = captions.indexOf(item);
        y = Number.isFinite(item.y) ? item.y : L.H / 2 + (index - (captions.length - 1) / 2) * L.H * .07;
        rotation = item.rotation || 0; font = FONTS[item.font ?? t.font] || FONTS[0]; scale = item.size || t.size || 1;
        bold = item.bold ?? t.bold; italic = item.italic ?? t.italic; align = item.align || t.align || 'center';
    }
    let size = Math.round(basePx || font.k * L.W * scale);
    cctx.save(); cctx.font = font.css(size, bold, italic);
    let width = cctx.measureText(value).width;
    if (width > L.W - 48) { size = Math.floor(size * (L.W - 48) / width); cctx.font = font.css(size, bold, italic); width = cctx.measureText(value).width; }
    cctx.restore();
    const boxWidth = Math.max(24, width + 20);
    return {x: x + (align === 'left' ? boxWidth/2 : align === 'right' ? -boxWidth/2 : 0), y, w: boxWidth, h: Math.max(32, size * 1.45), rotation};
}
function drawCaptionSelection(ctx) {
    const b = captionSelectionBox(); if (!b) return;
    const k = dispK;
    ctx.save(); ctx.setTransform(dispSc, 0, 0, dispSc, 0, 0); ctx.translate(b.x, b.y); ctx.rotate(b.rotation);
    ctx.strokeStyle = '#e4492b'; ctx.lineWidth = 2 * k; ctx.setLineDash([7 * k, 5 * k]);
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.setLineDash([]);
    const r = 13 * k;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-b.w / 2, -b.h / 2, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.lineWidth = 2 * k; ctx.moveTo(-b.w / 2 - 5 * k, -b.h / 2 - 5 * k); ctx.lineTo(-b.w / 2 + 5 * k, -b.h / 2 + 5 * k); ctx.moveTo(-b.w / 2 + 5 * k, -b.h / 2 - 5 * k); ctx.lineTo(-b.w / 2 - 5 * k, -b.h / 2 + 5 * k); ctx.stroke();
    ctx.fillStyle = '#e4492b'; ctx.beginPath(); ctx.arc(b.w / 2, b.h / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * k; ctx.beginPath(); ctx.arc(b.w / 2, b.h / 2, r * .55, Math.PI * .15, Math.PI * 1.5); ctx.stroke();
    ctx.restore();
}
function hitCaptionHandle(p) {
    const b = captionSelectionBox(); if (!b) return null;
    const dx = p.x - b.x, dy = p.y - b.y, c = Math.cos(b.rotation), s = Math.sin(b.rotation);
    const x = dx * c + dy * s, y = -dx * s + dy * c, r = 20 * dispK;
    if (Math.hypot(x + b.w / 2, y + b.h / 2) <= r) return 'delete';
    // Rotation handle is drawn at the lower-right corner of the selection.
    if (Math.hypot(x - b.w / 2, y - b.h / 2) <= r) return 'rotate';
    return null;
}

/* --- draw panel --- */
function buildDraw() {
    swatches($('penColors'), PEN_COLORS, c => { pen.c = c; syncPanels(); });
    $('penCustom').oninput = e => { pen.c = e.target.value; syncPanels(); };
    $('penSize').oninput = e => { pen.w = +e.target.value; };
    document.querySelectorAll('#toolSeg button').forEach(b => b.onclick = () => {
        pen.e = b.dataset.t === 'eraser';
        cv.classList.toggle('drawing', !pen.e); cv.classList.toggle('erasing', pen.e);
        syncPanels();
    });
    $('dClear').onclick = () => { if (doc.strokes.length) { doc.strokes = []; live.dirty = true; changed(); } };
}

/* --- filters panel --- */
function buildFilters() {
    const host = $('fltGrid');
    host.innerHTML = '';
    const src = photos[0] ? thumbOf(photos[0]) : null;
    Object.keys(FILTERS).forEach(name => {
        const b = el('button', 'tile'); b._v = name;
        const c = src ? applyFilter(src, name) : mk(80, 80);
        const cc = mk(110, 110), x = cc.getContext('2d');
        if (src) {
            const s = Math.max(110 / c.width, 110 / c.height);
            x.drawImage(c, (110 - c.width * s) / 2, (110 - c.height * s) / 2, c.width * s, c.height * s);
        }
        b.append(cc, el('span', '', name));
        b.onclick = () => { doc.filter = name; changed(); };
        host.appendChild(b);
    });
    syncPanels();
}
const thumbCache = new WeakMap();
function thumbOf(p) {
    if (thumbCache.has(p)) return thumbCache.get(p);
    const k = 140 / Math.max(p.width, p.height), c = mk(p.width * k, p.height * k);
    c.getContext('2d').drawImage(p, 0, 0, c.width, c.height);
    thumbCache.set(p, c);
    return c;
}

/* keep the panels in sync with the document */
function syncPanels() {
    if (!doc) return;
    $('stripStyleTools').hidden = flow.mode !== 'strip' || !!flow.serverTemplate;
    [...$('stripStyleGrid').children].forEach((button, index) => {
        const active = stripPresetMatches(STRIPS[index]);
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
    });
    const b = doc.bg;
    markSw($('bgColors'), v => b.mode === 'color' && same(v, b.c1));
    markSw($('bgGrads'), v => b.mode === 'gradient' && same(v, [b.c1, b.c2]));
    [...$('bgFrameGrid').children].forEach(t => t.classList.toggle('on', b.mode === 'image' && t._v === b.preset));
    if (b.mode !== 'gradient') $('bgCustom').value = /^#[0-9a-f]{6}$/i.test(b.c1) ? b.c1 : '#ffffff';
    $('bgRemove').hidden = b.mode !== 'image';
    $('bgZoomBox').hidden = b.mode !== 'image';
    $('bgZoom').value = Math.round((b.zoom || 1) * 100);
    cv.classList.toggle('panning', tab === 'bg' && b.mode === 'image');

    const p = doc.pattern;
    [...$('patGrid').children].forEach(t => t.classList.toggle('on', t._v === p.id));
    markSw($('patColors'), v => same(v, p.color));
    $('patAlpha').value = Math.round(p.alpha * 100);
    $('patSize').value = Math.round(p.size * 100);

    const t = doc.text, selected = (t.items || []).find(item => String(item.id) === String(selectedCaptionId));
    $('dateIn').value = t.date;
    if (document.activeElement !== $('locationIn')) $('locationIn').value = t.location || '';
    $('dateOn').checked = t.showDate;
    const selectedTarget = selectedTextTarget();
    const selectedFont = selectedTarget && selectedTarget.font != null ? selectedTarget.font : t.font;
    const selectedSize = selectedTarget && selectedTarget.size != null ? selectedTarget.size : t.size || 1;
    const selectedPointSize = selectedSize * FONT_SIZE_BASE;
    if ($('textFont')) $('textFont').value = String(selectedFont);
    if ($('textSize')?.tagName === 'SELECT') {
        $('textSize').value = String(FONT_SIZES.reduce((closest, value) =>
            Math.abs(value - selectedPointSize) < Math.abs(closest - selectedPointSize) ? value : closest, FONT_SIZES[0]));
    } else if ($('textSize')) {
        const sizePct = Math.round(selectedSize * 100);
        $('textSize').value = String(sizePct);
        if ($('textSizeValue')) $('textSizeValue').value = `${sizePct}%`;
    }
    const selectedBold = selectedTarget ? !!selectedTarget.bold : !!t.bold;
    const selectedItalic = selectedTarget ? !!selectedTarget.italic : !!t.italic;
    if ($('textBold')) {
        $('textBold').classList.toggle('on', selectedBold);
        $('textBold').setAttribute('aria-pressed', String(selectedBold));
    }
    if ($('textItalic')) {
        $('textItalic').classList.toggle('on', selectedItalic);
        $('textItalic').setAttribute('aria-pressed', String(selectedItalic));
    }
    const selectedUnderline = selectedTextIsDate ? !!(t.dateUnderline ?? t.underline) : selectedTextIsLocation ? !!(t.locationUnderline ?? t.underline) : !!(selected ? (selected.underline ?? t.underline) : t.underline);
    $('textUnderline').classList.toggle('on', selectedUnderline);
    $('textUnderline').setAttribute('aria-pressed', String(selectedUnderline));
    const selectedAlign = selectedTextIsDate ? (t.dateAlign || 'center') : selectedTextIsLocation ? (t.locationAlign || 'center') : (selected?.align || t.align || 'center');
    [['textAlignLeft','left'],['textAlignCenter','center'],['textAlignRight','right']].forEach(([id,align]) => {
        $(id).classList.toggle('on', selectedAlign === align);
        $(id).setAttribute('aria-pressed', String(selectedAlign === align));
    });
    if ($('fontChips')) {
        [...$('fontChips').children].forEach(chip => chip.classList.toggle('on', +chip.dataset.i === selectedFont));
    }
    const selectedRotation = selectedTextIsDate ? (t.dateRotation || 0) : selectedTextIsLocation ? (t.locationRotation || 0) : (selected && selected.rotation || 0);
    $('textRotation').value = String(Math.round(selectedRotation * 180 / Math.PI));
    $('textRotationValue').value = `${$('textRotation').value}°`;
    markSw($('txtColors'), v => same(v, (selected && selected.color) || t.color));
    if (/^#[0-9a-f]{6}$/i.test((selected && selected.color) || t.color || '')) $('txtCustom').value = (selected && selected.color) || t.color;

    markSw($('penColors'), v => !pen.e && same(v, pen.c));
    document.querySelectorAll('#toolSeg button').forEach(x => x.classList.toggle('on', (x.dataset.t === 'eraser') === pen.e));
    $('penOpts').style.opacity = pen.e ? .4 : 1;
    $('penOpts').style.pointerEvents = pen.e ? 'none' : '';

    [...$('fltGrid').children].forEach(x => x.classList.toggle('on', x._v === doc.filter));
    $('stkCtl').hidden = !selId;
    $('replaceLogo').hidden = !(doc.stickers || []).some(item => String(item.id) === String(selId) && !!item.src);
    $('stkDuplicate').hidden = !selSticker();
}

/* a discrete edit: redraw, record in history */
function changed() { syncPanels(); draw(); commit(); }
/* a continuous edit (slider / colour picker drag): redraw only */
function live2() { draw(); }

/* ---------- pointer handling on the canvas ---------- */
const ptr = {mode: null};
function docPt(e) {
    const r = cv.getBoundingClientRect(), L = doc.layout;
    return {x: (e.clientX - r.left) * L.W / r.width, y: (e.clientY - r.top) * L.H / r.height};
}
const toLocal = (s, p) => {
    const dx = p.x - s.x, dy = p.y - s.y, c = Math.cos(s.r), n = Math.sin(s.r);
    return {x: dx * c + dy * n, y: -dx * n + dy * c};
};
function hitSticker(p) {
    for (let i = doc.stickers.length - 1; i >= 0; i--) {
        const s = doc.stickers[i], l = toLocal(s, p), box = stickerBox(s);
        if (Math.abs(l.x) <= box.w / 2 && Math.abs(l.y) <= box.h / 2) return s;
    }
    return null;
}
cv.addEventListener('pointerdown', e => {
    if (!doc) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const p = docPt(e);
    // Uploaded logos are drawn above the frame and photo windows. Hit them
    // first so clicking a logo never starts moving the camera/photo window below.
    const stickerUnderPointer = hitSticker(p), selectedLogo = doc.stickers.find(item => item.id === selId && item.src);
    const selectedBox = selectedLogo && stickerBox(selectedLogo), selectedLocal = selectedLogo && toLocal(selectedLogo, p);
    const handleRadius = 24 * dispK;
    const onLogoHandle = selectedBox && (
        Math.hypot(selectedLocal.x + selectedBox.w / 2, selectedLocal.y + selectedBox.h / 2) < handleRadius ||
        Math.hypot(selectedLocal.x - selectedBox.w / 2, selectedLocal.y - selectedBox.h / 2) < handleRadius
    );
    const logo = stickerUnderPointer && stickerUnderPointer.src ? stickerUnderPointer : onLogoHandle ? selectedLogo : null;
    if (logo) {
        const box = stickerBox(logo), local = toLocal(logo, p), radius = 24 * dispK;
        selId = logo.id;
        doc.stickers = doc.stickers.filter(item => item !== logo).concat(logo);
        if (Math.hypot(local.x + box.w / 2, local.y + box.h / 2) < radius) {
            delSticker(logo.id); changed(); return;
        }
        if (Math.hypot(local.x - box.w / 2, local.y - box.h / 2) < radius) {
            ptr.mode = 'scale'; ptr.s = logo; ptr.moved = false;
            ptr.size0 = logo.s; ptr.handleAngle = Math.atan2(box.h, box.w); ptr.handleDistance = Math.hypot(box.w / 2, box.h / 2);
        } else {
            ptr.mode = 'move'; ptr.s = logo; ptr.dx = logo.x - p.x; ptr.dy = logo.y - p.y; ptr.moved = false;
        }
        if (tab !== 'uploads') setTab('uploads');
        syncPanels(); draw(); return;
    }
    if (tab !== 'draw' && flow.serverTemplate) {
        const selected = flow.serverTemplate.texts.find(item => String(item.id) === String(serverTextSel));
        const selectedBox = selected && serverFieldBox(selected), selectedState = selected && frameTextState(selected);
        let handle = null;
        if (selectedBox && selectedState && !selectedState.hidden) {
            const r = Number(selectedState.rotation) || 0, dx = p.x - selectedBox.x - selectedBox.w / 2, dy = p.y - selectedBox.y - selectedBox.h / 2;
            const lx = dx * Math.cos(r) + dy * Math.sin(r), ly = -dx * Math.sin(r) + dy * Math.cos(r), radius = 22 * dispK;
            if (Math.hypot(lx + selectedBox.w / 2, ly + selectedBox.h / 2) <= radius) handle = 'delete';
            else if (Math.hypot(lx - selectedBox.w / 2, ly + selectedBox.h / 2) <= radius) handle = 'rotate';
            else if (Math.hypot(lx - selectedBox.w / 2, ly - selectedBox.h / 2) <= radius) handle = 'resize';
        }
        const field = (handle ? selected : null) || hitServerText(p);
        if (field) {
            const state = frameTextState(field);
            if (handle === 'delete') {
                state.hidden = true; saveTextValues(); buildStudioFrameFields(flow.serverTemplate); refreshFrameText(); draw(); return;
            }
            if (!Number.isFinite(state.x)) state.x = field.x;
            if (!Number.isFinite(state.y)) state.y = field.y;
            serverTextSel = field.id;
            document.querySelectorAll('.server-text-field').forEach(row => row.classList.toggle('is-selected', String(row.dataset.fieldId) === String(field.id)));
            const box = serverFieldBox(field);
            ptr.mode = handle === 'rotate' ? 'server-rotate' : handle === 'resize' ? 'server-resize' : 'server-text'; ptr.field = field; ptr.sx = p.x; ptr.sy = p.y;
            ptr.x0 = state.x; ptr.y0 = state.y; ptr.moved = false;
            ptr.w0 = Number.isFinite(state.w) ? state.w : field.w; ptr.h0 = Number.isFinite(state.h) ? state.h : field.h;
            ptr.cx = box.x + box.w / 2; ptr.cy = box.y + box.h / 2;
            ptr.a0 = Math.atan2(p.y - ptr.cy, p.x - ptr.cx); ptr.r0 = Number(state.rotation) || 0;
            const targetTab = field.type === 'upload' ? 'uploads' : 'text';
            if (tab !== targetTab) setTab(targetTab);
            draw();
            return;
        }
    }
    if (tab !== 'draw' && !flow.serverTemplate) {
        const handle = photoSlotHandle(p);
        if (handle?.type === 'delete') { removePhotoWindow(selectedSlotIndex); return; }
        const hitIndex = hitPhotoSlot(p);
        if (handle?.type === 'resize') {
            const slot = doc.layout.slots[selectedSlotIndex];
            ptr.mode = 'slot-resize'; ptr.edge = handle.edge; ptr.sx = p.x; ptr.sy = p.y; ptr.x0 = slot.x; ptr.y0 = slot.y; ptr.w0 = slot.w; ptr.h0 = slot.h; ptr.slotIndex = selectedSlotIndex; ptr.moved = false;
            if (tab !== 'text') setTab('text');
            return;
        }
    }
    if (tab === 'draw') {
        const s = {c: pen.c, w: pen.e ? pen.w * 2.5 : pen.w, e: pen.e ? 1 : 0, p: [[+p.x.toFixed(1), +p.y.toFixed(1)]]};
        doc.strokes.push(s);
        ptr.mode = 'draw'; ptr.s = s;
        const x = liveLayer(dispSc).getContext('2d');
        x.save(); x.setTransform(dispSc, 0, 0, dispSc, 0, 0); strokePath(x, s); x.restore();
        draw();
        return;
    }
    if (tab !== 'draw') {
        const handle = hitCaptionHandle(p);
        if (handle === 'delete') {
            if (selectedTextIsDate) { doc.text.showDate = false; }
            else if (selectedTextIsLocation) { doc.text.location = ''; }
            else { doc.text.items = doc.text.items.filter(item => String(item.id) !== String(selectedCaptionId)); selectedCaptionId = doc.text.items[0]?.id ?? null; }
            changed(); return;
        }
        if (handle === 'rotate') {
            const b = captionSelectionBox();
            ptr.mode = selectedTextIsDate ? 'date-rotate' : selectedTextIsLocation ? 'location-rotate' : 'text-rotate';
            ptr.cx = b.x; ptr.cy = b.y; ptr.a0 = Math.atan2(p.y - b.y, p.x - b.x); ptr.r0 = b.rotation; ptr.moved = false;
            return;
        }
        const textHit = hitFooterText(p);
        if (textHit) {
            const isDate = textHit.date === true;
            const isLocation = textHit.location === true;
            selectedTextIsDate = isDate; selectedTextIsLocation = isLocation;
            if (isDate) {
                if (!Number.isFinite(doc.text.dateX)) doc.text.dateX = doc.layout.W / 2;
                if (!Number.isFinite(doc.text.dateY)) doc.text.dateY = doc.layout.H / 2;
                ptr.mode = 'date-text'; ptr.x0 = doc.text.dateX; ptr.y0 = doc.text.dateY;
            } else if (isLocation) {
                if (!Number.isFinite(doc.text.locationX)) doc.text.locationX = doc.layout.W / 2;
                if (!Number.isFinite(doc.text.locationY)) doc.text.locationY = doc.layout.H * .57;
                ptr.mode = 'location-text'; ptr.x0 = doc.text.locationX; ptr.y0 = doc.text.locationY;
            } else {
                selectedCaptionId = textHit.id;
                if (!Number.isFinite(textHit.x)) textHit.x = doc.layout.W / 2;
                if (!Number.isFinite(textHit.y)) {
                    const captions = (doc.text.items || []).filter(item => String(item.value || '').trim()), index = captions.indexOf(textHit);
                    textHit.y = doc.layout.H / 2 + (index - (captions.length - 1) / 2) * doc.layout.H * .07;
                }
                document.querySelectorAll('.caption-field').forEach(row => row.classList.toggle('is-selected', String(row.querySelector('input')?.dataset.itemId) === String(selectedCaptionId)));
                ptr.mode = 'text'; ptr.item = textHit; ptr.x0 = textHit.x; ptr.y0 = textHit.y;
            }
            ptr.sx = p.x; ptr.sy = p.y; ptr.moved = false;
            if (tab !== 'text') setTab('text');
            syncPanels(); draw();
            return;
        }
    }
    if (tab !== 'draw' && !flow.serverTemplate) {
        const index = hitPhotoSlot(p);
        if (index >= 0) {
            selectedSlotIndex = index; buildPhotoWindowFields();
            const slot = doc.layout.slots[index];
            ptr.mode = 'slot-move'; ptr.sx = p.x; ptr.sy = p.y; ptr.x0 = slot.x; ptr.y0 = slot.y; ptr.slotIndex = index; ptr.moved = false;
            if (tab !== 'text') setTab('text');
            draw(); return;
        }
    }
    const sel = selSticker();
    if (sel) {
        const l = toLocal(sel, p), h = sel.s * .6, R = 24 * dispK;
        if (Math.hypot(l.x + h, l.y + h) < R) { delSticker(sel.id); ptr.mode = null; changed(); return; }
        if (Math.hypot(l.x - h, l.y - h) < R) { ptr.mode = 'scale'; ptr.s = sel; return; }
    }
    const hit = hitSticker(p);
    if (hit) {
        selId = hit.id;
        doc.stickers = doc.stickers.filter(s => s !== hit).concat(hit);
        ptr.mode = 'move'; ptr.s = hit; ptr.dx = hit.x - p.x; ptr.dy = hit.y - p.y; ptr.moved = false;
        if (tab !== 'stickers') setTab('stickers');
    } else {
        selId = null; ptr.mode = null;
        if (tab === 'bg' && doc.bg.mode === 'image') {
            const bx = bgImgBox(doc);
            if (bx) { ptr.mode = 'pan'; ptr.sx = p.x; ptr.sy = p.y; ptr.ox0 = bx.ox; ptr.oy0 = bx.oy; ptr.moved = false; }
        }
    }
    syncPanels(); draw();
});
cv.addEventListener('pointermove', e => {
    if (!ptr.mode) {
        if (!doc) return;
        const p = docPt(e), photoHandle = tab !== 'draw' && !flow.serverTemplate ? photoSlotHandle(p) : null;
        const onText = tab !== 'draw' && (flow.serverTemplate ? !!hitServerText(p) : hitPhotoSlot(p) >= 0 || !!hitFooterText(p));
        const cursorByEdge = {e:'ew-resize',w:'ew-resize',n:'ns-resize',s:'ns-resize',ne:'nesw-resize',sw:'nesw-resize',nw:'nwse-resize',se:'nwse-resize'};
        cv.style.cursor = photoHandle?.type === 'delete' ? 'pointer' : photoHandle?.type === 'resize' ? cursorByEdge[photoHandle.edge] : (onText || (tab !== 'draw' && !!hitSticker(p))) ? 'grab' : (tab === 'draw' ? (pen.e ? 'cell' : 'crosshair') : 'default');
        return;
    }
    cv.style.cursor = 'grabbing';
    const p = docPt(e), s = ptr.s;
    if (ptr.mode === 'draw') {
        const last = s.p[s.p.length - 1], q = [+p.x.toFixed(1), +p.y.toFixed(1)];
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) < .6) return;
        s.p.push(q);
        const x = liveLayer(dispSc).getContext('2d');
        x.save(); x.setTransform(dispSc, 0, 0, dispSc, 0, 0);
        strokePath(x, {c: s.c, w: s.w, e: s.e, p: [last, q]});
        x.restore();
    } else if (ptr.mode === 'pan') {
        doc.bg.ox = ptr.ox0 + (p.x - ptr.sx); doc.bg.oy = ptr.oy0 + (p.y - ptr.sy);
        const bx = bgImgBox(doc);
        if (bx) { doc.bg.ox = bx.ox; doc.bg.oy = bx.oy; }
        ptr.moved = true;
    } else if (ptr.mode === 'text') {
        const L = doc.layout;
        ptr.item.x = clamp(ptr.x0 + (p.x - ptr.sx), 24, L.W - 24);
        ptr.item.y = clamp(ptr.y0 + (p.y - ptr.sy), 38, L.H - 38);
        ptr.moved = true;
    } else if (ptr.mode === 'date-text') {
        const L = doc.layout;
        doc.text.dateX = clamp(ptr.x0 + (p.x - ptr.sx), 24, L.W - 24);
        doc.text.dateY = clamp(ptr.y0 + (p.y - ptr.sy), 38, L.H - 38);
        ptr.moved = true;
    } else if (ptr.mode === 'location-text') {
        const L = doc.layout;
        doc.text.locationX = clamp(ptr.x0 + (p.x - ptr.sx), 24, L.W - 24);
        doc.text.locationY = clamp(ptr.y0 + (p.y - ptr.sy), 38, L.H - 38);
        ptr.moved = true;
    } else if (ptr.mode === 'slot-move') {
        const L = doc.layout, slot = L.slots[ptr.slotIndex];
        slot.x = clamp(ptr.x0 + (p.x - ptr.sx), 0, L.W - slot.w);
        slot.y = clamp(ptr.y0 + (p.y - ptr.sy), 0, L.H - slot.h);
        ptr.moved = true;
    } else if (ptr.mode === 'slot-resize') {
        const L = doc.layout, slot = L.slots[ptr.slotIndex];
        const dx = p.x - ptr.sx, dy = p.y - ptr.sy, edge = ptr.edge;
        if (edge.includes('e')) slot.w = clamp(ptr.w0 + dx, 24, L.W - ptr.x0);
        if (edge.includes('s')) slot.h = clamp(ptr.h0 + dy, 24, L.H - ptr.y0);
        if (edge.includes('w')) { const w = clamp(ptr.w0 - dx, 24, ptr.x0 + ptr.w0); slot.x = ptr.x0 + ptr.w0 - w; slot.w = w; }
        if (edge.includes('n')) { const h = clamp(ptr.h0 - dy, 24, ptr.y0 + ptr.h0); slot.y = ptr.y0 + ptr.h0 - h; slot.h = h; }
        ptr.moved = true;
    } else if (ptr.mode === 'text-rotate' || ptr.mode === 'date-rotate' || ptr.mode === 'location-rotate') {
        const isDate = ptr.mode === 'date-rotate', isLocation = ptr.mode === 'location-rotate';
        const target = isDate || isLocation ? doc.text : (doc.text.items || []).find(item => String(item.id) === String(selectedCaptionId));
        if (target) {
            const key = isDate ? 'dateRotation' : isLocation ? 'locationRotation' : 'rotation';
            target[key] = ptr.r0 + Math.atan2(p.y - ptr.cy, p.x - ptr.cx) - ptr.a0;
            if ($('textRotation')) { $('textRotation').value = String(Math.round(target[key] * 180 / Math.PI)); $('textRotationValue').value = `${$('textRotation').value}°`; }
        }
        ptr.moved = true;
    } else if (ptr.mode === 'server-text') {
        const state = frameTextState(ptr.field), L = flow.layout;
        state.x = clamp(ptr.x0 + (p.x - ptr.sx) / L.W, 0, 1 - (state.w ?? ptr.field.w));
        state.y = clamp(ptr.y0 + (p.y - ptr.sy) / L.H, 0, 1 - (state.h ?? ptr.field.h));
        ptr.moved = true;
    } else if (ptr.mode === 'server-resize') {
        const state = frameTextState(ptr.field), L = flow.layout;
        const left = Number.isFinite(state.x) ? state.x : ptr.field.x, top = Number.isFinite(state.y) ? state.y : ptr.field.y;
        state.w = clamp(ptr.w0 + (p.x - ptr.sx) / L.W, .03, 1 - left);
        state.h = clamp(ptr.h0 + (p.y - ptr.sy) / L.H, .015, 1 - top);
        ptr.moved = true;
    } else if (ptr.mode === 'server-rotate') {
        const state = frameTextState(ptr.field);
        state.rotation = ptr.r0 + Math.atan2(p.y - ptr.cy, p.x - ptr.cx) - ptr.a0;
        ptr.moved = true;
    } else if (ptr.mode === 'move') {
        s.x = p.x + ptr.dx; s.y = p.y + ptr.dy; ptr.moved = true;
    } else if (ptr.mode === 'scale') {
        const vx = p.x - s.x, vy = p.y - s.y;
        if (s.src) {
            s.s = clamp(ptr.size0 * Math.hypot(vx, vy) / ptr.handleDistance, 40, 700);
            s.r = Math.atan2(vy, vx) - ptr.handleAngle;
        } else {
            s.s = clamp(Math.hypot(vx, vy) / (.6 * Math.SQRT2), 40, 700);
            s.r = Math.atan2(vy, vx) - Math.PI / 4;
        }
        ptr.moved = true;
    }
    draw();
});
const endPtr = () => {
    if (!ptr.mode) return;
    const m = ptr.mode, moved = ptr.moved;
    ptr.mode = null;
    cv.style.cursor = '';
    if ((m === 'server-text' || m === 'server-resize' || m === 'server-rotate') && moved) saveTextValues();
    if (m === 'draw' || moved) commit();
    syncUndo();
};
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);

/* keyboard */
window.addEventListener('keydown', e => {
    if ($('v-studio').hidden) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selId && !typing) { e.preventDefault(); delSticker(selId); changed(); }
    else if (e.key === 'Escape' && selId) { selId = null; syncPanels(); draw(); }
});

/* ---------- init ---------- */
buildTimers();
buildZoomBar();
buildHome();
buildBackground();
buildPatternControls();
buildStickers();
buildDraw();
if (adminStudioConfig) {
    $('sShare').hidden = true;
    $('dlBtn').hidden = true;
    $('sSave').title = 'Save campaign frame';
    $('sSave').setAttribute('aria-label', 'Save campaign frame');
    $('sSave').querySelector('span').textContent = 'Save frame';
    document.querySelector('.s-title').textContent = 'Campaign frame Studio';
    $('adminFrameName').value = adminStudioConfig.defaultName || 'Campaign frame';
    $('adminFrameSaveCancel').onclick = () => $('adminFrameSaveDialog').close();
    $('adminFrameSaveConfirm').onclick = saveAdminStudioFrame;
    $('sSave').onclick = () => { $('adminFrameSaveError').hidden = true; $('adminFrameSaveDialog').showModal(); $('adminFrameName').focus(); $('adminFrameName').select(); };
    $('sBack').onclick = () => window.location.assign(adminStudioConfig.returnUrl);
    openBlankStudio();
} else if (campaignConfig) {
    $('siteNav').hidden = true;
    $('navToggle').hidden = true;
    $('steps').hidden = true;
    $('custBtn').hidden = true;
    $('capBack').hidden = true;
    document.querySelector('#v-result .res-side .eyebrow').textContent = 'Your branded photo';
    document.querySelector('#v-result .res-side .sub').textContent = 'Download your photo or share it with friends.';
    $('v-home').classList.remove('on');
    startServerFrame(campaignConfig.template);
}
const sl = el('div', 'screen-light'); sl.id = 'screenLight';
document.body.appendChild(sl);
window.addEventListener('beforeunload', stopCam);

/* "How it works": reveal the step cards when they scroll into view */
(function () {
    const steps = document.getElementById('howSteps');
    if (!steps) return;
    if (!('IntersectionObserver' in window)) { steps.classList.add('in-view'); return; }
    const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) { steps.classList.add('in-view'); io.disconnect(); }
    }, {threshold: .25});
    io.observe(steps);
})();
