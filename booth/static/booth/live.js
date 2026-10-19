'use strict';
/* =====================================================================
   Live booth: shoot one strip together from different places.

   How it plugs in: load this file AFTER script.js. It needs no other
   edits. It adds its own UI, styles and logic, and wraps a few existing
   functions (buildSlots, show, handleUpload) so the normal booth keeps
   working exactly as before when no room is active.

   How it works:
   - The host creates a room. A short code (e.g. KQ4-7M2) becomes a
     PeerJS id, so friends can find the host by typing the code.
   - Photos travel directly between devices (WebRTC). The PeerJS cloud
     is only used to introduce the devices to each other.
   - The host is the referee: it assigns slots, starts the shared
     countdown, relays photos, and announces when the strip is full.
   ===================================================================== */
(() => {
    const PEER_SRC = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
    const PREFIX = 'photobooth-live-v1-';
    const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

    /* ---------- state ---------- */
    const blank = () => ({role: null, code: '', peer: null, conns: [], conn: null, me: {slot: -1, name: ''}, members: [], done: false, joined: false, settle: null, tmo: 0});
    let room = blank();

    /* ---------- small helpers ---------- */
    const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const fmtCode = c => c.length > 3 ? c.slice(0, 3) + '-' + c.slice(3) : c;
    const newCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map(v => ALPHA[v % ALPHA.length]).join('');
    const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    const filled = () => { let c = 0; for (let i = 0; i < flow.layout.n; i++) if (photos[i]) c++; return c; };
    const toJpeg = c => c.toDataURL('image/jpeg', .9);
    const shareLink = code => location.href.split('#')[0].split('?')[0] + '?room=' + code;

    let peerLoad = null;
    function loadPeer() {
        if (window.Peer) return Promise.resolve();
        return peerLoad || (peerLoad = new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = PEER_SRC;
            s.onload = res;
            s.onerror = () => { peerLoad = null; rej({why: 'Live booth needs an internet connection.'}); };
            document.head.appendChild(s);
        }));
    }

    /* ---------- UI: styles ---------- */
    const style = document.createElement('style');
    style.textContent = `
.live-dialog{width:min(760px,calc(100vw - 32px));max-height:92dvh;overflow-y:auto}
.live-seg{margin-top:16px}
.live-field{display:block;margin-top:14px;color:var(--mu);font-size:13.5px}
.live-field input,.live-field select{display:block;width:100%;height:44px;margin-top:6px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font:inherit}
.live-field input:focus,.live-field select:focus{outline:2px solid var(--ac);outline-offset:-1px;border-color:transparent}
#liveCodeIn{font:600 22px/1 var(--sans);letter-spacing:.2em;text-align:center;text-transform:uppercase}
.live-pane{display:none}
.live-pane.on{display:block}
.live-note{color:var(--mu);font-size:12.5px;margin-top:12px;line-height:1.5}
.live-status{min-height:20px;margin-top:12px;font-size:13.5px;color:var(--mu)}
.live-status.err{color:#b3261e}
.live-frame-label{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:18px 0 9px;color:var(--ink);font-size:13px;font-weight:650}
.live-frame-label small{color:var(--mu);font-size:11px;font-weight:450}
.live-frame-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;max-height:min(42vh,350px);overflow:auto;padding:2px 3px 6px}
.live-frame-card{position:relative;display:flex;min-width:0;flex-direction:column;align-items:center;gap:7px;padding:10px 9px 11px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.76);color:var(--ink);text-align:center;cursor:pointer;transition:border-color .16s,background .16s,box-shadow .16s,transform .16s}
.live-frame-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--ac) 55%,var(--line));box-shadow:0 5px 14px rgba(35,28,20,.08)}
.live-frame-card:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
.live-frame-card[aria-pressed="true"]{border:2px solid var(--ac);padding:9px 8px 10px;background:var(--soft);box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 10%,transparent)}
.live-frame-thumb{display:grid;width:100%;height:112px;place-items:center;border-radius:8px;background:linear-gradient(145deg,#f4efe5,#e9e2d5);overflow:hidden}
.live-frame-thumb canvas{display:block;max-width:100%;max-height:106px;width:auto;height:auto;border-radius:2px;box-shadow:0 2px 6px rgba(0,0,0,.13)}
.live-frame-card strong{max-width:100%;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.live-frame-card small{margin-top:-5px;color:var(--mu);font-size:10px}
.live-frame-check{position:absolute;top:7px;right:7px;display:grid;width:19px;height:19px;place-items:center;border-radius:50%;background:var(--ac);color:#fff;font-size:12px;font-weight:700;opacity:0;transform:scale(.8);transition:opacity .15s,transform .15s}
.live-frame-card[aria-pressed="true"] .live-frame-check{opacity:1;transform:scale(1)}
.live-bar{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px 14px;margin:0 auto 12px;max-width:100%}
.live-code{display:flex;align-items:baseline;gap:8px;padding:6px 14px;border-radius:11px;background:var(--soft);color:var(--ac-d)}
.live-code span{font-size:12px;font-weight:600}
.live-code b{font:600 20px/1 var(--sans);letter-spacing:.16em}
.live-roster{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.live-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 12px 4px 5px;border-radius:99px;border:1px dashed #cfc7b4;background:rgba(255,255,255,.5);color:#a39b88;font-size:13px;font-weight:550}
.live-chip b{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#ebe5d8;color:var(--mu);font-size:11px}
.live-chip.on{border-style:solid;border-color:var(--line);background:var(--paper);color:var(--ink)}
.live-chip.me{border-color:var(--ac)}
.live-chip.shot b{background:var(--ac);color:#fff}
@media(max-width:520px){.live-frame-grid{grid-template-columns:repeat(2,minmax(0,1fr));max-height:38vh}.live-frame-thumb{height:100px}.live-frame-thumb canvas{max-height:94px}.live-dialog{padding:18px}}
@media (min-width:861px){
    body.capture-view #v-capture,body.capture-view #v-capture.on{
        grid-template-rows:44px auto minmax(0,1fr) auto auto;
        grid-template-areas:"head" "live" "cam" "ctl" "shoot";
    }
    body.capture-view .live-bar{grid-area:live}
    body.room-view.capture-view .slots{top:calc(100px + (100% - 216px) / 2)}
}`;
    document.head.appendChild(style);

    /* ---------- UI: markup ---------- */
    const sprite = document.querySelector('body > svg defs');
    if (sprite && !document.getElementById('i-users')) {
        sprite.insertAdjacentHTML('beforeend', '<symbol id="i-users" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></symbol>');
    }

    $('cam').insertAdjacentHTML('beforebegin', `
<div class="live-bar" id="liveBar" hidden>
    <div class="live-code"><span>Room</span><b id="liveCode"></b></div>
    <button class="tog" id="liveCopy" type="button" title="Invite friends"><svg class="i"><use href="#i-share"/></svg><span>Invite</span></button>
    <div class="live-roster" id="liveRoster"></div>
</div>`);

    document.body.insertAdjacentHTML('beforeend', `
<dialog class="template-dialog live-dialog" id="liveDialog" aria-labelledby="liveTitle">
    <div class="template-dialog-head">
        <div><p class="eyebrow">Live booth</p><h2 id="liveTitle">Shoot together</h2></div>
        <button class="ib" id="liveClose" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="seg wide live-seg" id="liveSeg">
        <button type="button" data-m="create" class="on">Create a room</button>
        <button type="button" data-m="join">Join with a code</button>
    </div>
    <label class="live-field">Your name<input type="text" id="liveName" maxlength="16" placeholder="Priya" autocomplete="given-name"></label>
    <div class="live-pane on" id="lp-create">
        <div class="live-frame-label"><span>Choose a frame</span><small id="liveFrameHint">Select a layout for your group</small></div>
        <div class="live-frame-grid" id="liveFrameGrid" role="group" aria-label="Choose a frame"></div>
        <p class="live-note">Each friend takes one slot from their own phone or laptop. Photos go straight between your devices.</p>
    </div>
    <div class="live-pane" id="lp-join">
        <label class="live-field">Room code<input type="text" id="liveCodeIn" maxlength="7" placeholder="KQ4-7M2" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    </div>
    <p class="live-status" id="liveStatus" role="status"></p>
    <div class="template-dialog-actions">
        <button class="btn" id="liveCancel" type="button">Cancel</button>
        <button class="btn primary" id="liveGo" type="button">Create room</button>
    </div>
</dialog>`);

    /* the result screen's retake button gets its own label element */
    const rb = $('retakeBtn');
    [...rb.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).forEach(n => {
        const s = document.createElement('span');
        s.id = 'retakeLbl';
        s.textContent = n.textContent.trim();
        rb.replaceChild(s, n);
    });

    /* frames a room can use (needs 2 to 4 people) */
    const FRAMES = [
        {mode: 'instant', n: 2, preset: {}, name: 'Duo frame'},
        {mode: 'instant', n: 3, preset: {}, name: 'Trio frame'},
        {mode: 'instant', n: 4, preset: {}, name: 'Quad frame'},
        ...STRIPS.map(p => ({mode: 'strip', n: p.n, preset: p, name: p.name + ' strip'}))
    ];
    let selectedFrameIndex = 0;
    const liveFrameGrid = $('liveFrameGrid');
    FRAMES.forEach((frame, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'live-frame-card';
        card.setAttribute('aria-pressed', String(index === selectedFrameIndex));
        const thumb = document.createElement('span');
        thumb.className = 'live-frame-thumb';
        const stripStyle = frame.mode === 'strip' ? frame.preset : {};
        thumb.appendChild(previewCanvas(layoutFor(frame.mode, frame.n), stripStyle, 110, index));
        const title = document.createElement('strong');
        title.textContent = frame.name;
        const details = document.createElement('small');
        details.textContent = `${frame.n} photos · ${frame.mode === 'strip' ? 'Photo strip' : 'Instant frame'}`;
        const check = document.createElement('span');
        check.className = 'live-frame-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        card.append(thumb, title, details, check);
        card.addEventListener('click', () => {
            selectedFrameIndex = index;
            liveFrameGrid.querySelectorAll('.live-frame-card').forEach((item, itemIndex) => {
                item.setAttribute('aria-pressed', String(itemIndex === selectedFrameIndex));
            });
            $('liveFrameHint').textContent = `${frame.n} photos · ${frame.mode === 'strip' ? 'Photo strip' : 'Instant frame'}`;
        });
        liveFrameGrid.appendChild(card);
    });
    $('liveFrameHint').textContent = `${FRAMES[selectedFrameIndex].n} photos · Instant frame`;

    /* ---------- UI: dialog ---------- */
    let dlgMode = 'create';
    const setStatus = (msg, err) => { const s = $('liveStatus'); s.textContent = msg || ''; s.classList.toggle('err', !!err); };
    const closeDlg = () => { const d = $('liveDialog'); if (d.open) d.close(); };
    function setMode(m) {
        dlgMode = m;
        document.querySelectorAll('#liveSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
        $('lp-create').classList.toggle('on', m === 'create');
        $('lp-join').classList.toggle('on', m === 'join');
        $('liveGo').textContent = m === 'create' ? 'Create room' : 'Join booth';
        setStatus('');
    }
    function openDlg(m) {
        setMode(m);
        $('liveGo').disabled = false;
        const d = $('liveDialog');
        if (typeof d.showModal === 'function' && !d.open) d.showModal();
        setTimeout(() => $(m === 'join' ? 'liveCodeIn' : 'liveName').focus(), 50);
    }
    const errText = e => (e && e.why) ||
        (e && e.type === 'peer-unavailable' ? 'No room with that code. Check it and try again.' :
        e && e.type === 'network' ? 'Could not reach the live booth service. Check your connection.' :
        e && e.message === 'timeout' ? 'Could not reach the room. Check the code and your connection.' :
        'Could not connect. Try again.');

    document.querySelectorAll('#liveSeg button').forEach(b => b.onclick = () => setMode(b.dataset.m));
    $('liveCreate').onclick = () => openDlg('create');
    $('liveJoin').onclick = () => openDlg('join');
    $('liveClose').onclick = $('liveCancel').onclick = () => { if (room.role && !room.joined && room.role === 'guest') leave(); closeDlg(); };
    $('liveCodeIn').oninput = e => { e.target.value = fmtCode(normCode(e.target.value)); };
    $('liveGo').onclick = async () => {
        const btn = $('liveGo');
        btn.disabled = true;
        try {
            if (dlgMode === 'create') {
                setStatus('Creating your room\u2026');
                const cfg = FRAMES[selectedFrameIndex];
                await createRoom(cfg, cleanName($('liveName').value) || 'Host');
                startCapture(cfg.mode, cfg.n, cfg.preset, cfg.name);
                closeDlg();
                toast('Room ready. Invite your friends.');
            } else {
                const code = normCode($('liveCodeIn').value);
                if (code.length !== 6) { setStatus('Enter the 6-character code.', true); return; }
                setStatus('Connecting\u2026');
                await joinRoom(code, cleanName($('liveName').value) || 'Guest');
            }
        } catch (err) {
            leave();
            setStatus(errText(err), true);
        } finally { btn.disabled = false; }
    };

    $('liveCopy').onclick = async () => {
        if (!room.role) return;
        const url = shareLink(room.code), text = `Join my live photo booth. Code: ${fmtCode(room.code)}`;
        if (navigator.share) {
            try { await navigator.share({title: 'Join my photo booth', text, url}); return; }
            catch (e) { if (e.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
        catch (e) { toast('Room code: ' + fmtCode(room.code)); }
    };

    /* ---------- UI: room bar ---------- */
    function renderBar() {
        const bar = $('liveBar');
        if (!room.role) { bar.hidden = true; return; }
        bar.hidden = false;
        $('liveCode').textContent = fmtCode(room.code);
        const host = $('liveRoster');
        host.innerHTML = '';
        for (let i = 0; i < flow.layout.n; i++) {
            const m = room.members.find(x => x.slot === i), mine = i === room.me.slot;
            const chip = document.createElement('span');
            chip.className = 'live-chip' + (m ? ' on' : '') + (mine ? ' me' : '') + (photos[i] ? ' shot' : '');
            const num = document.createElement('b');
            num.textContent = i + 1;
            chip.append(num, document.createTextNode(m ? (mine ? m.name + ' (you)' : m.name) : 'Waiting\u2026'));
            host.appendChild(chip);
        }
    }

    function btnLabel() {
        if (busy) return 'Cancel';
        if (filled() === 0 && !room.done) return room.role === 'host' ? 'Start for everyone' : 'Waiting for host';
        return photos[room.me.slot] ? 'Retake mine' : 'Capture mine';
    }

    /* ---------- messaging ---------- */
    function send(msg, except) {
        if (room.role === 'host') room.conns.forEach(c => { if (c !== except && c.open) { try { c.send(msg); } catch (e) {} } });
        else if (room.role === 'guest' && room.conn && room.conn.open) { try { room.conn.send(msg); } catch (e) {} }
    }

    /* ---------- photos ---------- */
    function setPhoto(slot, canvas, mine) {
        photos[slot] = canvas;
        photoVer++;
        if (mine) send({t: 'photo', slot, data: toJpeg(canvas)});
        photoChanged(mine);
    }
    function recv(slot, data) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= flow.layout.n) return;
        const im = new Image();
        im.onload = () => {
            const c = mk(im.naturalWidth, im.naturalHeight);
            c.getContext('2d').drawImage(im, 0, 0);
            setPhoto(slot, c, false);
        };
        im.src = data;
    }
    function photoChanged(mine) {
        buildSlots();
        if (room.done) {
            if (view === 'result') drawResult();
            if (!$('v-studio').hidden) draw();
            if (view === 'capture' && mine) { show('result'); drawResult(); }
        } else if (room.role === 'host' && filled() >= flow.layout.n) {
            send({t: 'done'});
            finish();
        }
    }
    function finish() {
        room.done = true;
        const lbl = $('retakeLbl');
        if (lbl) lbl.textContent = 'Retake my photo';
        finishCapture();
    }

    /* take one photo for my own slot (flash + shutter, no sequence) */
    async function shootOnce(idx) {
        const L = flow.layout, flip = mirror && facing === 'user';
        const grab = () => frameFromSource(vid, vid.videoWidth, vid.videoHeight, L.slots[idx], flip, camRes);
        let c;
        if (flashOn) {
            const sl = $('screenLight');
            sl.classList.add('on');
            await sleep(380);
            c = grab();
            sl.classList.remove('on');
        } else c = grab();
        const sh = $('shutter');
        sh.classList.add('hit'); void sh.offsetWidth; sh.classList.remove('hit');
        beep(1200, .06);
        return c;
    }

    /* countdown, then capture my slot */
    async function goRound(sec) {
        if (busy || view !== 'capture' || !room.role) return;
        if (!stream || !vid.videoWidth) { toast('Camera is not ready. Allow access or upload a photo.'); return; }
        busy = true; abort = false;
        buildSlots();
        const old = timer;
        timer = sec;
        try { await countdown(); } finally { timer = old; }
        if (!abort && room.role) {
            const c = await shootOnce(room.me.slot);
            setPhoto(room.me.slot, c, true);
        }
        busy = false; abort = false;
        buildSlots();
    }

    function shootClick() {
        if (!room.role) { runSequence(); return; }
        if (busy) { abort = true; return; }
        if (filled() === 0 && !room.done) {
            if (room.role === 'guest') { toast('Waiting for the host to start'); return; }
            const need = flow.layout.n - room.members.length;
            if (need > 0) { toast(`Waiting for ${need} more ${need === 1 ? 'friend' : 'friends'}`); return; }
            send({t: 'go', sec: timer});
            goRound(timer);
            return;
        }
        goRound(timer);
    }

    /* ---------- host ---------- */
    function createRoom(cfg, name) {
        return loadPeer().then(() => new Promise((resolve, reject) => {
            let tries = 0;
            const attempt = () => {
                const code = newCode(), peer = new Peer(PREFIX + code);
                let opened = false;
                room = Object.assign(blank(), {role: 'host', code, peer, me: {slot: 0, name}, members: [{slot: 0, name}]});
                peer.on('open', () => { opened = true; resolve(); });
                peer.on('connection', hostAccept);
                peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
                peer.on('error', err => {
                    if (!opened) {
                        if (err.type === 'unavailable-id' && ++tries < 4) { try { peer.destroy(); } catch (e) {} attempt(); return; }
                        reject(err);
                    } else toast('Connection problem. Friends may need to rejoin.');
                });
            };
            attempt();
        }));
    }

    function hostAccept(c) {
        c.on('data', m => hostMsg(c, m));
        c.on('close', () => hostDrop(c));
        c.on('error', () => hostDrop(c));
    }
    function refuse(c, why) {
        try { c.send({t: 'full', why}); } catch (e) {}
        setTimeout(() => { try { c.close(); } catch (e) {} }, 400);
    }
    function hostMsg(c, m) {
        if (room.role !== 'host' || !m || typeof m !== 'object') return;
        if (m.t === 'hello' && c._slot == null) {
            if (room.done) { refuse(c, 'That booth has already finished.'); return; }
            const used = new Set(room.members.map(x => x.slot));
            let slot = -1;
            for (let i = 0; i < flow.layout.n; i++) if (!used.has(i)) { slot = i; break; }
            if (slot < 0) { refuse(c, 'That booth is full.'); return; }
            c._slot = slot;
            const name = cleanName(m.name) || `Guest ${slot + 1}`;
            room.members.push({slot, name});
            room.conns.push(c);
            c.send({t: 'welcome', slot, name, mode: flow.mode, n: flow.n, presetId: (flow.preset && flow.preset.id) || null, title: flow.name});
            photos.forEach((p, i) => { if (p) c.send({t: 'photo', slot: i, data: toJpeg(p)}); });
            roster();
            toast(`${name} joined`);
        } else if (m.t === 'photo' && c._slot === m.slot && typeof m.data === 'string' && m.data.startsWith('data:image/') && m.data.length < 6e6) {
            send(m, c);
            recv(m.slot, m.data);
        }
    }
    function hostDrop(c) {
        if (room.role !== 'host' || !room.conns.includes(c)) return;
        room.conns = room.conns.filter(x => x !== c);
        const m = room.members.find(x => x.slot === c._slot);
        room.members = room.members.filter(x => x.slot !== c._slot);
        if (m) toast(`${m.name} left`);
        roster();
    }
    function roster() {
        send({t: 'roster', members: room.members});
        buildSlots();
    }

    /* ---------- guest ---------- */
    function joinRoom(code, name) {
        return loadPeer().then(() => new Promise((resolve, reject) => {
            const peer = new Peer();
            const me = room = Object.assign(blank(), {role: 'guest', code, peer, me: {slot: -1, name}, settle: {resolve, reject}});
            me.tmo = setTimeout(() => { if (!me.joined) reject({message: 'timeout'}); }, 12000);
            peer.on('error', err => { if (!me.joined) reject(err); else toast('Connection problem'); });
            peer.on('open', () => {
                const c = peer.connect(PREFIX + code, {reliable: true});
                me.conn = c;
                c.on('open', () => c.send({t: 'hello', name}));
                c.on('data', m => { if (room === me) guestMsg(m); });
                c.on('close', () => guestClosed(me));
            });
        }));
    }
    function guestMsg(m) {
        if (!m || typeof m !== 'object') return;
        switch (m.t) {
            case 'welcome': {
                if (!['instant', 'strip'].includes(m.mode) || !Number.isInteger(m.n) || m.n < 2 || m.n > 4 || !Number.isInteger(m.slot) || m.slot < 0 || m.slot >= m.n) {
                    room.settle.reject({why: 'This room uses a different version of the app.'});
                    return;
                }
                clearTimeout(room.tmo);
                room.joined = true;
                room.me = {slot: m.slot, name: String(m.name || '')};
                const preset = m.mode === 'strip' ? (STRIPS.find(s => s.id === m.presetId) || {}) : {};
                startCapture(m.mode, m.n, preset, String(m.title || 'Live booth'));
                closeDlg();
                room.settle.resolve();
                break;
            }
            case 'roster':
                room.members = Array.isArray(m.members) ? m.members.filter(x => x && Number.isInteger(x.slot)).map(x => ({slot: x.slot, name: String(x.name || '')})) : [];
                if (room.joined) buildSlots();
                break;
            case 'photo':
                if (room.joined && typeof m.data === 'string' && m.data.startsWith('data:image/')) recv(m.slot, m.data);
                break;
            case 'go':
                if (room.joined && !room.done) goRound([3, 5, 10].includes(m.sec) ? m.sec : 3);
                break;
            case 'done':
                if (room.joined) finish();
                break;
            case 'full':
                clearTimeout(room.tmo);
                room.settle.reject({why: String(m.why || 'That booth is full.')});
                break;
        }
    }
    function guestClosed(me) {
        if (room !== me || !me.joined) return;
        toast('The host closed the booth');
        const away = !room.done && view === 'capture';
        leave();
        if (away) show('home');
    }

    /* ---------- leave ---------- */
    function leave() {
        const old = room;
        room = blank();
        clearTimeout(old.tmo);
        try { old.conns.forEach(c => c.close()); } catch (e) {}
        try { if (old.conn) old.conn.close(); } catch (e) {}
        try { if (old.peer) old.peer.destroy(); } catch (e) {}
        $('liveBar').hidden = true;
        const lbl = $('retakeLbl');
        if (lbl) lbl.textContent = 'Retake photos';
        document.body.classList.remove('room-view');
    }

    /* ---------- hook into the existing app ---------- */
    const _buildSlots = buildSlots;
    buildSlots = function () {
        _buildSlots();
        if (!room.role || room.me.slot < 0) return;
        const n = filled(), total = flow.layout.n;
        document.querySelectorAll('#slots .slot').forEach((s, i) => s.classList.toggle('now', i === room.me.slot && !photos[i]));
        $('capCount').textContent = n >= total ? 'All photos taken' : `${n} of ${total} photos in`;
        $('resetBtn').hidden = true;
        $('shootLbl').textContent = btnLabel();
        renderBar();
    };

    const _show = show;
    show = function (v) {
        if (v === 'home' && room.role) leave();
        _show(v);
        document.body.classList.toggle('room-view', !!room.role);
    };

    const _handleUpload = handleUpload;
    handleUpload = async function (files) {
        if (!room.role) return _handleUpload(files);
        try {
            const b = await loadBitmap(files[0]);
            setPhoto(room.me.slot, frameFromSource(b.src, b.w, b.h, flow.layout.slots[room.me.slot], false), true);
        } catch (e) { toast('Could not read that image'); }
    };

    $('shootBtn').onclick = shootClick;

    $('capBack').onclick = () => {
        if (room.role) {
            if (room.done) { abort = true; show('result'); return; }
            if (!confirm('Leave this live booth?')) return;
            abort = true;
            leave();
            show('home');
            return;
        }
        abort = true;
        show(flow.mode && flow.mode !== 'server' ? 'choose' : 'home');
    };

    const _retake = $('retakeBtn').onclick;
    $('retakeBtn').onclick = () => {
        if (room.role) { buildSlots(); show('capture'); return; }
        _retake();
    };

    window.addEventListener('beforeunload', () => { try { if (room.peer) room.peer.destroy(); } catch (e) {} });

    /* open a shared link: ?room=KQ4-7M2 */
    const shared = normCode(new URLSearchParams(location.search).get('room'));
    if (shared.length === 6) {
        openDlg('join');
        $('liveCodeIn').value = fmtCode(shared);
    }
})();
