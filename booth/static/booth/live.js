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
    const blank = () => ({role: null, code: '', peer: null, conns: [], conn: null, calls: new Map(), calledPeers: new Set(), remoteVideos: new Map(), pendingCalls: [], pendingPhotoLoads: new Set(), restarting: false, me: {slot: -1, name: ''}, members: [], pending: [], done: false, joined: false, settle: null, tmo: 0});
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
.live-feed-grid{position:absolute;z-index:1;inset:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));gap:3px;padding:3px;background:#171613}
.live-feed-tile{position:relative;min-width:0;min-height:0;overflow:hidden;border-radius:10px;background:linear-gradient(145deg,#36342f,#171613);display:grid;place-items:center}
.live-feed-tile video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
.live-feed-tile.remote video{transform:none}
.live-feed-tile .live-feed-placeholder{color:#e8e2d7;font-size:clamp(14px,2vw,25px);font-weight:650}
.live-feed-tile .live-feed-name{position:absolute;left:8px;bottom:8px;padding:4px 8px;border-radius:999px;background:rgba(0,0,0,.58);color:#fff;font-size:12px;line-height:1.2}
.room-view .cam>video{visibility:hidden}
.room-view .slots{display:none}
.room-view #upBtn{display:none}
.room-view.room-guest .shoot{display:none}
.live-room-hint{color:var(--mu);font-size:12px}
.room-view .cam-msg{z-index:4}
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
    <span class="live-room-hint" id="liveRoomHint"></span>
</div>`);
    $('cam').insertAdjacentHTML('afterbegin', '<div class="live-feed-grid" id="liveFeedGrid" aria-label="Live group camera" hidden></div>');

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
        <label class="live-field">People in this room<select id="livePeopleCount" aria-label="Number of people in the room"><option value="2">2 people</option><option value="3" selected>3 people</option><option value="4">4 people</option></select></label>
        <div class="live-frame-label"><span>Choose a frame</span><small id="liveFrameHint">Select a layout for your group</small></div>
        <div class="live-frame-grid" id="liveFrameGrid" role="group" aria-label="Choose a frame"></div>
        <p class="live-note">Choose 2, 3, or 4 people. Everyone sees the live group preview, then one shared countdown captures the group into your selected frame.</p>
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
    let liveFrames = [];
    const liveFrameGrid = $('liveFrameGrid');
    function liveFrameTemplate(template, count) {
        if (!Array.isArray(template.slots) || template.slots.length !== 1) return template;
        const opening = template.slots[0], sideBySide = opening.w / opening.h > 1;
        const slots = Array.from({length: count}, (_, index) => ({
            x: opening.x + (sideBySide ? opening.w * index / count : 0),
            y: opening.y + (sideBySide ? 0 : opening.h * index / count),
            w: sideBySide ? opening.w / count : opening.w,
            h: sideBySide ? opening.h : opening.h / count,
            shape: 'square',
        }));
        return {...template, slots, liveSharedOpening: true};
    }
    function renderLiveFrames() {
        const previous = liveFrames[selectedFrameIndex];
        const count = Number($('livePeopleCount').value) || 3;
        const uploadedFrames = (Array.isArray(serverFrameTemplates) ? serverFrameTemplates : [])
            .filter(template => Array.isArray(template.slots) && template.slots.length >= 1 && template.slots.length <= 4)
            .map(source => {
                const sharedOpening = source.slots.length === 1;
                const people = sharedOpening ? count : source.slots.length;
                const template = liveFrameTemplate(source, people);
                return {mode: 'server', n: people, template, name: template.name, sharedOpening};
            });
        liveFrames = [...uploadedFrames, ...FRAMES.filter(frame => frame.n === count)];
        selectedFrameIndex = previous ? liveFrames.findIndex(frame => frame.mode === previous.mode &&
            (frame.template?.id || frame.preset?.id || frame.name) === (previous.template?.id || previous.preset?.id || previous.name)) : uploadedFrames.length ? 0 : 1;
        if (selectedFrameIndex < 0 || selectedFrameIndex >= liveFrames.length) selectedFrameIndex = uploadedFrames.length ? 0 : 1;
        liveFrameGrid.replaceChildren();
        liveFrames.forEach((frame, index) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'live-frame-card';
        card.setAttribute('aria-pressed', String(index === selectedFrameIndex));
        const thumb = document.createElement('span');
        thumb.className = 'live-frame-thumb';
        if (frame.mode === 'server') {
            const canvas = mk(90, 110), image = new Image();
            image.onload = () => {
                const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
                const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
                canvas.getContext('2d').drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
            };
            image.src = frame.template.image;
            thumb.appendChild(canvas);
        } else {
            const stripStyle = frame.mode === 'strip' ? frame.preset : {};
            thumb.appendChild(previewCanvas(layoutFor(frame.mode, frame.n), stripStyle, 110, index));
        }
        const title = document.createElement('strong');
        title.textContent = frame.name;
        const details = document.createElement('small');
        details.textContent = frame.mode === 'server' && frame.sharedOpening
            ? `${frame.n} photos · Shared opening`
            : `${frame.n} photos · ${frame.mode === 'server' ? 'Uploaded frame' : frame.mode === 'strip' ? 'Photo strip' : 'Instant frame'}`;
        const check = document.createElement('span');
        check.className = 'live-frame-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        card.append(thumb, title, details, check);
        card.addEventListener('click', () => {
            if (frame.mode === 'server' && !frame.sharedOpening && Number($('livePeopleCount').value) !== frame.n) {
                $('livePeopleCount').value = String(frame.n);
                renderLiveFrames();
                return;
            }
            selectedFrameIndex = index;
            liveFrameGrid.querySelectorAll('.live-frame-card').forEach((item, itemIndex) => {
                item.setAttribute('aria-pressed', String(itemIndex === selectedFrameIndex));
            });
            $('liveFrameHint').textContent = frame.mode === 'server' && frame.sharedOpening
                ? `${frame.n} photos · Shared opening`
                : `${frame.n} photos · ${frame.mode === 'server' ? 'Uploaded frame' : frame.mode === 'strip' ? 'Photo strip' : 'Instant frame'}`;
        });
        liveFrameGrid.appendChild(card);
        });
        const selected = liveFrames[selectedFrameIndex];
        $('liveFrameHint').textContent = selected.mode === 'server' && selected.sharedOpening
            ? `${selected.n} photos · Shared opening`
            : `${selected.n} photos · ${selected.mode === 'server' ? 'Uploaded frame' : selected.mode === 'strip' ? 'Photo strip' : 'Instant frame'}`;
    }
    window.refreshLiveBoothFrames = renderLiveFrames;
    $('livePeopleCount').addEventListener('change', renderLiveFrames);

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
        if (m === 'create') renderLiveFrames();
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
                const cfg = liveFrames[selectedFrameIndex] || FRAMES[1];
                if (cfg.mode === 'server') {
                    const loaded = await startServerFrame(cfg.template, {live: true});
                    if (!loaded) throw {why: 'Could not load the selected frame.'};
                    await createRoom(cfg, cleanName($('liveName').value) || 'Host');
                    document.body.classList.add('room-view');
                    buildSlots();
                    liveCameraReady();
                } else {
                    await createRoom(cfg, cleanName($('liveName').value) || 'Host');
                    startCapture(cfg.mode, cfg.n, cfg.preset, cfg.name, null, true);
                }
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
        $('liveRoomHint').textContent = busy ? 'Shared countdown in progress' : room.done
            ? 'Group photo captured' : room.role === 'host'
                ? 'You control the shared capture' : 'Waiting for the host to start the group photo';
        const host = $('liveRoster');
        host.innerHTML = '';
        for (let i = 0; i < flow.layout.n; i++) {
            const m = room.members.find(x => x.slot === i), mine = i === room.me.slot;
            const chip = document.createElement('span');
            chip.className = 'live-chip' + (m ? ' on' : '') + (mine ? ' me' : '') + (photos[i] ? ' shot' : '');
            const num = document.createElement('b');
            num.textContent = i + 1;
            chip.append(num, document.createTextNode(m ? (mine ? m.name + ' (you)' : m.name) + (m.ready === false ? ' · loading' : '') : 'Waiting\u2026'));
            host.appendChild(chip);
        }
        renderLiveFeeds();
    }

    function renderLiveFeeds() {
        const grid = $('liveFeedGrid');
        if (!grid) return;
        grid.hidden = !room.role;
        if (!room.role) { grid.replaceChildren(); return; }
        const members = Array.from({length: flow.layout.n}, (_, slot) => room.members.find(item => item.slot === slot) || {slot, name: `Waiting ${slot + 1}`});
        grid.style.gridTemplateColumns = `repeat(${members.length === 2 ? 2 : 2},minmax(0,1fr))`;
        grid.style.gridTemplateRows = `repeat(${Math.ceil(members.length / 2)},minmax(0,1fr))`;
        grid.replaceChildren(...members.map(member => {
            const tile = document.createElement('div');
            tile.className = 'live-feed-tile' + (member.slot === room.me.slot ? ' local' : ' remote');
            tile.dataset.slot = String(member.slot);
            if (members.length === 3 && member.slot === 2) {
                tile.style.gridColumn = '1 / -1';
                tile.style.width = '50%';
                tile.style.justifySelf = 'center';
            }
            const video = document.createElement('video');
            video.autoplay = true; video.playsInline = true; video.muted = true;
            video.style.transform = member.slot === room.me.slot && mirror && facing === 'user' ? 'scaleX(-1)' : 'none';
            const media = member.slot === room.me.slot ? stream : room.remoteVideos.get(member.slot);
            if (media) { video.srcObject = media; video.play().catch(() => {}); }
            else {
                const placeholder = document.createElement('span');
                placeholder.className = 'live-feed-placeholder';
                placeholder.textContent = member.name.startsWith('Waiting') ? '…' : member.name.slice(0, 1).toUpperCase();
                tile.appendChild(placeholder);
            }
            const name = document.createElement('span');
            name.className = 'live-feed-name';
            name.textContent = member.slot === room.me.slot ? `${member.name} (you)` : member.name;
            tile.append(video, name);
            return tile;
        }));
    }

    function liveVideoForSlot(slot) {
        if (slot === room.me.slot) return vid;
        return $('liveFeedGrid').querySelector(`.live-feed-tile[data-slot="${slot}"] video`);
    }

    function answerLiveCall(call) {
        if (!room.role || !stream || !call || call._boothAnswered) return;
        call._boothAnswered = true;
        room.calls.set(call.peer, call);
        room.calledPeers.add(call.peer);
        try { call.answer(stream); } catch { return; }
        call.on('stream', media => receiveLiveStream(call.peer, media));
        call.on('close', () => {
            if (room.calls.get(call.peer) !== call) return;
            removeLiveStream(call.peer);
            if (!room.restarting) connectLivePeers();
        });
        call.on('error', () => removeLiveStream(call.peer));
    }

    function receiveLiveStream(peerId, media) {
        const member = room.members.find(item => item.peerId === peerId);
        if (!member) return;
        room.remoteVideos.set(member.slot, media);
        renderLiveFeeds();
    }

    function removeLiveStream(peerId) {
        const member = room.members.find(item => item.peerId === peerId);
        if (!member) return;
        room.remoteVideos.delete(member.slot);
        room.calls.delete(peerId);
        room.calledPeers.delete(peerId);
        renderLiveFeeds();
    }

    function connectLivePeers() {
        if (!room.role || !stream || !room.peer) return;
        const activePeerIds = new Set(room.members.map(member => member.peerId).filter(Boolean));
        room.calls.forEach((call, peerId) => {
            if (!activePeerIds.has(peerId)) {
                try { call.close(); } catch {}
                room.calls.delete(peerId); room.calledPeers.delete(peerId);
            }
        });
        room.pendingCalls.splice(0).forEach(answerLiveCall);
        room.members.forEach(member => {
            if (!member.peerId || member.slot === room.me.slot || room.calledPeers.has(member.peerId)) return;
            // Every pair makes one call, avoiding duplicate audio/video tracks.
            if (String(room.peer.id) > String(member.peerId)) return;
            const call = room.peer.call(member.peerId, stream);
            if (!call) return;
            room.calledPeers.add(member.peerId);
            room.calls.set(member.peerId, call);
            call.on('stream', media => receiveLiveStream(member.peerId, media));
            call.on('close', () => {
                if (room.calls.get(member.peerId) !== call) return;
                removeLiveStream(member.peerId);
                if (!room.restarting) connectLivePeers();
            });
            call.on('error', () => removeLiveStream(member.peerId));
        });
        renderLiveFeeds();
    }

    function liveCameraReady() {
        if (!room.role || !stream) return;
        connectLivePeers();
        renderLiveFeeds();
    }

    function btnLabel() {
        if (busy) return 'Cancel';
        return room.done ? 'Retake group photo' : 'Start for everyone';
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
        if (!Number.isInteger(slot) || slot < 0 || slot >= flow.layout.n) return Promise.resolve();
        return new Promise(resolve => {
            const im = new Image();
            im.onload = () => {
                const c = mk(im.naturalWidth, im.naturalHeight);
                c.getContext('2d').drawImage(im, 0, 0);
                setPhoto(slot, c, false);
                resolve();
            };
            im.onerror = resolve;
            im.src = data;
        });
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
        if (lbl) lbl.textContent = 'Retake group photo';
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

    /* Host captures all connected cameras together after the shared countdown. */
    async function goRound(sec) {
        if (busy || view !== 'capture' || !room.role) return;
        if (!stream || !vid.videoWidth) { toast('Camera is not ready. Allow access or upload a photo.'); return; }
        busy = true; abort = false;
        buildSlots();
        const old = timer;
        timer = sec;
        try { await countdown(); } finally { timer = old; }
        if (!abort && room.role === 'host') {
            const captured = [];
            for (const member of room.members) {
                const local = member.slot === room.me.slot;
                const source = liveVideoForSlot(member.slot);
                if (!source || !source.videoWidth || !source.videoHeight) {
                    toast(`Could not capture ${member.name}'s camera. Reconnect and try again.`);
                    busy = false; abort = false; buildSlots(); return;
                }
                captured.push({slot: member.slot, photo: frameFromSource(source, source.videoWidth, source.videoHeight,
                    flow.layout.slots[member.slot], local && mirror && facing === 'user', local ? camRes : 1)});
            }
            // Update the full group atomically. This prevents the last slot from
            // opening the result screen before every photo has been relayed.
            captured.forEach(({slot, photo}) => { photos[slot] = photo; });
            photoVer++;
            captured.forEach(({slot, photo}) => {
                send({t: 'photo', slot, data: toJpeg(photo)});
                recordSiteMetric('photos_captured');
            });
            room.done = true;
            send({t: 'done'});
            finish();
        }
        busy = false; abort = false;
        buildSlots();
    }

    function shootClick() {
        if (!room.role) { runSequence(); return; }
        if (busy) { abort = true; return; }
        if (room.role === 'guest') { send({t: 'start-request'}); return; }
        requestGroupCapture();
    }

    function requestGroupCapture() {
        if (room.role !== 'host' || busy) return;
        if (room.members.length !== flow.layout.n || room.members.some(member => member.ready === false)) {
            toast('Wait until everyone has joined and loaded the frame');
            return;
        }
        if (filled() === 0 && !room.done) {
            const readyCount = room.members.filter(member => member.ready !== false).length;
            const need = flow.layout.n - readyCount;
            if (need > 0) { toast(`Waiting for ${need} ${need === 1 ? 'friend' : 'friends'} to join and load the frame`); return; }
        }
        if (room.members.some(member => {
            const video = liveVideoForSlot(member.slot);
            return member.slot !== room.me.slot && (!room.remoteVideos.has(member.slot) || !video?.videoWidth);
        })) {
            toast('Waiting for everyone’s live camera to connect');
            return;
        }
        send({t: 'go', sec: timer});
        goRound(timer);
    }

    /* ---------- host ---------- */
    function createRoom(cfg, name) {
        return loadPeer().then(() => new Promise((resolve, reject) => {
            let tries = 0;
            const attempt = () => {
                const code = newCode(), peer = new Peer(PREFIX + code);
                let opened = false;
                room = Object.assign(blank(), {role: 'host', code, peer, me: {slot: 0, name}, members: [{slot: 0, name, ready: true}], frame: cfg.mode === 'server' ? cfg.template : null});
                peer.on('open', () => {
                    opened = true; room.me.peerId = peer.id;
                    room.members[0].peerId = peer.id;
                    resolve();
                });
                peer.on('call', call => {
                    if (stream) answerLiveCall(call);
                    else room.pendingCalls.push(call);
                });
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
            room.members.push({slot, name, peerId: String(m.peerId || c.peer || ''), ready: false});
            room.conns.push(c);
            c.send({t: 'welcome', slot, name, mode: flow.mode, n: flow.n, presetId: (flow.preset && flow.preset.id) || null, title: flow.name,
                frame: flow.mode === 'server' ? room.frame : null});
            photos.forEach((p, i) => { if (p) c.send({t: 'photo', slot: i, data: toJpeg(p)}); });
            roster();
            toast(`${name} joined`);
        } else if (m.t === 'photo' && c._slot === m.slot && typeof m.data === 'string' && m.data.startsWith('data:image/') && m.data.length < 6e6) {
            send(m, c);
            recv(m.slot, m.data);
        } else if (m.t === 'ready' && c._slot != null) {
            const member = room.members.find(item => item.slot === c._slot);
            if (member && !member.ready) { member.ready = true; roster(); }
            connectLivePeers();
        } else if (m.t === 'start-request') {
            requestGroupCapture();
        }
    }
    function hostDrop(c) {
        if (room.role !== 'host' || !room.conns.includes(c)) return;
        room.conns = room.conns.filter(x => x !== c);
        const m = room.members.find(x => x.slot === c._slot);
        if (m?.peerId) {
            room.restarting = true;
            try { room.calls.get(m.peerId)?.close(); } catch {}
            removeLiveStream(m.peerId);
            room.restarting = false;
        }
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
            peer.on('call', call => {
                if (stream) answerLiveCall(call);
                else me.pendingCalls.push(call);
            });
            me.tmo = setTimeout(() => { if (!me.joined) reject({message: 'timeout'}); }, 12000);
            peer.on('error', err => { if (!me.joined) reject(err); else toast('Connection problem'); });
            peer.on('open', () => {
                const c = peer.connect(PREFIX + code, {reliable: true});
                me.conn = c;
                c.on('open', () => c.send({t: 'hello', name, peerId: peer.id}));
                c.on('data', m => { if (room === me) guestMsg(m).catch(() => {}); });
                c.on('close', () => guestClosed(me));
            });
        }));
    }
    async function guestMsg(m) {
        if (!m || typeof m !== 'object') return;
        switch (m.t) {
            case 'welcome': {
                if (!['instant', 'strip', 'server'].includes(m.mode) || !Number.isInteger(m.n) || m.n < 2 || m.n > 4 || !Number.isInteger(m.slot) || m.slot < 0 || m.slot >= m.n || (m.mode === 'server' && (!m.frame || !Array.isArray(m.frame.slots) || m.frame.slots.length !== m.n || typeof m.frame.image !== 'string'))) {
                    room.settle.reject({why: 'This room uses a different version of the app.'});
                    return;
                }
                clearTimeout(room.tmo);
                room.me = {slot: m.slot, name: String(m.name || ''), peerId: room.peer.id};
                if (m.mode === 'server') {
                    const loaded = await startServerFrame(m.frame, {live: true});
                    if (!loaded) { room.settle.reject({why: 'Could not load the selected frame.'}); return; }
                } else {
                    const preset = m.mode === 'strip' ? (STRIPS.find(s => s.id === m.presetId) || {}) : {};
                    startCapture(m.mode, m.n, preset, String(m.title || 'Live booth'), null, true);
                }
                room.joined = true;
                send({t: 'ready'});
                const pending = room.pending.splice(0);
                pending.forEach(message => guestMsg(message));
                closeDlg();
                room.settle.resolve();
                break;
            }
            case 'roster':
                room.members = Array.isArray(m.members) ? m.members.filter(x => x && Number.isInteger(x.slot)).map(x => ({slot: x.slot, name: String(x.name || ''), peerId: String(x.peerId || ''), ready: x.ready !== false})) : [];
                if (room.joined) { buildSlots(); connectLivePeers(); }
                break;
            case 'photo':
                if (!room.joined) room.pending.push(m);
                else if (typeof m.data === 'string' && m.data.startsWith('data:image/')) {
                    const loading = recv(m.slot, m.data);
                    room.pendingPhotoLoads.add(loading);
                    loading.finally(() => room.pendingPhotoLoads.delete(loading));
                }
                break;
            case 'go':
                if (!room.joined) room.pending.push(m);
                else goRound([3, 5, 10].includes(m.sec) ? m.sec : 3);
                break;
            case 'done':
                if (room.joined) {
                    await Promise.all([...room.pendingPhotoLoads]);
                    if (room.joined) finish();
                }
                break;
            case 'full':
                clearTimeout(room.tmo);
                room.settle.reject({why: String(m.why || 'That booth is full.')});
                break;
        }
    }
    function guestClosed(me) {
        if (room !== me) return;
        if (!me.joined) {
            me.settle?.reject({why: 'The host closed the booth before your frame finished loading.'});
            leave();
            setStatus('The host closed the booth.', true);
            return;
        }
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
        try { old.calls.forEach(c => c.close()); } catch (e) {}
        try { if (old.peer) old.peer.destroy(); } catch (e) {}
        $('liveBar').hidden = true;
        $('liveFeedGrid').replaceChildren(); $('liveFeedGrid').hidden = true;
        const lbl = $('retakeLbl');
        if (lbl) lbl.textContent = 'Retake photos';
        document.body.classList.remove('room-view', 'room-host', 'room-guest');
    }

    /* ---------- hook into the existing app ---------- */
    const _buildSlots = buildSlots;
    buildSlots = function () {
        _buildSlots();
        if (!room.role || room.me.slot < 0) return;
        const total = flow.layout.n;
        document.querySelectorAll('#slots .slot').forEach((s, i) => s.classList.toggle('now', i === room.me.slot && !photos[i]));
        const connected = room.members.filter(member => member.ready !== false).length;
        $('capCount').textContent = room.done ? 'Group photo ready' : `${connected} of ${total} people connected`;
        $('resetBtn').hidden = true;
        $('shootLbl').textContent = btnLabel();
        renderBar();
    };

    const _show = show;
    show = function (v) {
        if (v === 'home' && room.role) leave();
        _show(v);
        document.body.classList.toggle('room-view', !!room.role);
        document.body.classList.toggle('room-host', room.role === 'host');
        document.body.classList.toggle('room-guest', room.role === 'guest');
        if (room.role) renderBar();
    };

    const _startCam = startCam;
    startCam = async function () {
        const reconnect = !!room.role && room.calls.size > 0;
        if (reconnect) {
            room.restarting = true;
            room.calls.forEach(call => { try { call.close(); } catch {} });
            room.calls.clear(); room.calledPeers.clear(); room.remoteVideos.clear();
        }
        await _startCam();
        if (room.role && stream) {
            room.restarting = false;
            liveCameraReady();
        } else room.restarting = false;
    };

    const _handleUpload = handleUpload;
    handleUpload = async function (files) {
        if (room.role) { toast('Live Booth captures everyone together from the connected cameras.'); return; }
        return _handleUpload(files);
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
