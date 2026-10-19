(() => {
    'use strict';
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const cfg = window.PANEL || {};

    /* ---- mobile navigation ---- */
    document.addEventListener('click', e => {
        if (e.target.closest('[data-nav-toggle]')) document.body.classList.toggle('nav-open');
        else if (e.target.closest('.scrim')) document.body.classList.remove('nav-open');
    });

    /* ---- confirmation dialog for destructive forms ---- */
    const dlg = $('#confirmDialog');
    document.addEventListener('submit', e => {
        const form = e.target.closest('form[data-confirm]');
        if (!form || form.dataset.confirmed || !dlg || !dlg.showModal) return;
        e.preventDefault();
        $('#confirmTitle').textContent = form.dataset.confirmTitle || 'Are you sure?';
        $('#confirmText').textContent = form.dataset.confirm;
        const ok = $('#confirmOk');
        ok.textContent = form.dataset.confirmLabel || 'Delete';
        dlg.returnValue = '';
        dlg.showModal();
        dlg.addEventListener('close', () => {
            if (dlg.returnValue === 'ok') { form.dataset.confirmed = '1'; form.submit(); }
        }, {once: true});
    });

    /* ---- copy to clipboard ---- */
    document.addEventListener('click', async e => {
        const btn = e.target.closest('[data-copy]');
        if (!btn) return;
        const text = btn.dataset.copy;
        try { await navigator.clipboard.writeText(text); }
        catch (_) {
            const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t);
            t.select(); document.execCommand('copy'); t.remove();
        }
        const label = btn.querySelector('.copy-label');
        const old = label ? label.textContent : '';
        btn.classList.add('copied');
        if (label) label.textContent = 'Copied';
        setTimeout(() => { btn.classList.remove('copied'); if (label) label.textContent = old; }, 1400);
    });

    /* ---- dismissible flash messages ---- */
    $$('.flash button').forEach(b => b.addEventListener('click', () => b.closest('.flash').remove()));

    /* ---- slug from brand name + live link preview ---- */
    const brand = $('[data-slug-source]'), slug = $('[data-slug-target]');
    if (brand && slug) {
        let touched = slug.value.length > 0;
        const make = v => v.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
        slug.addEventListener('input', () => { touched = true; });
        brand.addEventListener('input', () => { if (!touched) slug.value = make(brand.value); });
    }

    /* ---- image previews on file inputs ---- */
    $$('input[type=file][data-preview]').forEach(input => {
        input.addEventListener('change', () => {
            const target = $(input.dataset.preview), file = input.files[0];
            if (target && file) target.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
        });
    });

    /* ---- drag & drop upload ---- */
    const drop = $('.drop');
    if (drop) {
        const input = $('input[type=file]', drop), list = $('#fileList');
        const show = () => {
            list.innerHTML = '';
            [...input.files].forEach(f => {
                const li = document.createElement('li');
                li.innerHTML = '<span></span><span class="muted"></span>';
                li.children[0].textContent = f.name;
                li.children[1].textContent = (f.size / 1024 / 1024).toFixed(2) + ' MB';
                list.appendChild(li);
            });
            const n = input.files.length, btn = $('#uploadBtn');
            if (btn) { btn.disabled = !n; btn.querySelector('span').textContent = n ? `Upload ${n} frame${n > 1 ? 's' : ''}` : 'Upload frames'; }
        };
        input.addEventListener('change', show);
        ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
        ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
        drop.addEventListener('drop', e => { input.files = e.dataTransfer.files; show(); });
    }

    /* ---- bulk selection on frames ---- */
    const bar = $('#bulkBar');
    if (bar) {
        const boxes = () => $$('input[name=ids]');
        const update = () => {
            const n = boxes().filter(b => b.checked).length;
            bar.hidden = n === 0;
            $('.count', bar).textContent = `${n} selected`;
        };
        document.addEventListener('change', e => { if (e.target.name === 'ids') update(); });
        $('#selectAll')?.addEventListener('click', () => { boxes().forEach(b => b.checked = true); update(); });
        $('#clearSel')?.addEventListener('click', () => { boxes().forEach(b => b.checked = false); update(); });
        $('#bulkForm')?.addEventListener('submit', e => {
            if (!$('select[name=action]', bar).value) { e.preventDefault(); $('select[name=action]', bar).focus(); }
        });
    }

    /* ---- add a photo window row ---- */
    const addRow = $('#addSlot');
    if (addRow) {
        addRow.addEventListener('click', () => {
            const total = $('#id_slots-TOTAL_FORMS');
            const idx = +total.value;
            const html = $('#slotTemplate').innerHTML.replaceAll('__prefix__', idx);
            $('#slotRows').insertAdjacentHTML('beforeend', html);
            const row = $('#slotRows').lastElementChild;
            row.querySelector('[name$="-order"]').value = idx;
            total.value = idx + 1;
            $('#slotEmpty')?.remove();
            renumber($('#slotRows'));
        });
    }

    /* ---- notifications bell ---- */
    const bellBtn = $('#bellBtn'), menu = $('#bellMenu');
    if (bellBtn && menu) {
        bellBtn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; bellBtn.setAttribute('aria-expanded', String(!menu.hidden)); });
        document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.hidden = true; });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.hidden = true; });
    }
    if (cfg.notifyUrl) {
        const baseTitle = document.title.replace(/^\(\d+\)\s*/, '');
        let known = cfg.newest || 0;
        const ago = iso => {
            const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
            if (s < 60) return 'just now';
            if (s < 3600) return Math.floor(s / 60) + ' min ago';
            if (s < 86400) return Math.floor(s / 3600) + ' h ago';
            return Math.floor(s / 86400) + ' d ago';
        };
        const esc = t => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };
        const icon = id => `<svg class="i i-sm"><use href="#i-${id}"/></svg>`;
        const toast = item => {
            const el = document.createElement('div');
            el.className = 'toast'; el.setAttribute('role', 'status');
            el.innerHTML = `<div class="t-icon">${icon('mail')}</div><div><b>New inquiry from ${esc(item.name)}</b><p>${esc(item.snippet)}</p><a class="view" href="${item.url}">View message</a></div><button class="x" aria-label="Dismiss">${icon('x')}</button>`;
            $('#toasts').appendChild(el);
            const kill = () => el.remove();
            $('.x', el).addEventListener('click', kill);
            setTimeout(kill, 12000);
        };
        const render = data => {
            const n = data.unread;
            $$('[data-unread]').forEach(el => { el.textContent = n; el.hidden = n === 0; });
            document.title = (n ? `(${n}) ` : '') + baseTitle;
            const list = $('#bellList');
            if (!list) return;
            list.innerHTML = data.items.map(i => `<li><a href="${i.url}" class="is-new"><span class="avatar">${esc(i.name.charAt(0))}</span><span class="body"><b>${esc(i.name)}<small>${ago(i.created)}</small></b><p>${esc(i.interest)} - ${esc(i.snippet)}</p></span></a></li>`).join('');
            $('#bellNone').hidden = data.items.length > 0;
            list.hidden = data.items.length === 0;
        };
        const poll = async () => {
            if (document.hidden) return;
            try {
                const r = await fetch(cfg.notifyUrl, {headers: {'Accept': 'application/json'}, credentials: 'same-origin'});
                if (r.status === 401) { location.reload(); return; }
                if (!r.ok) return;
                const data = await r.json();
                data.items.filter(i => i.id > known).reverse().forEach(toast);
                if (data.newest_id > known) known = data.newest_id;
                render(data);
            } catch (_) { /* offline: try again next tick */ }
        };
        $$('[data-iso]').forEach(el => { el.textContent = ago(el.dataset.iso); });
        setInterval(poll, 15000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    }
})();


/* Editable-text rows on the frame form */
(function () {
    const btn = document.getElementById('addText');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const total = document.getElementById('id_texts-TOTAL_FORMS');
        const idx = parseInt(total.value, 10);
        const html = document.getElementById('textTemplate').innerHTML.replaceAll('__prefix__', idx);
        document.getElementById('textRows').insertAdjacentHTML('beforeend', html);
        const row = document.getElementById('textRows').lastElementChild;
        row.querySelector('[name$="-order"]').value = idx;
        updateStudioField(row);
        setupStudioColor(row);
        total.value = idx + 1;
        renumber(document.getElementById('textRows'));
    });
})();

function renumber(rows) {
    if (!rows) return;
    let number = 0;
    rows.querySelectorAll('.editor-row').forEach(row => {
        const checkbox = row.querySelector('input[name$="-DELETE"]');
        row.classList.toggle('is-deleted', !!checkbox?.checked);
        const badge = row.querySelector('.row-index');
        if (badge) badge.textContent = checkbox?.checked ? '–' : ++number;
    });
}

document.addEventListener('change', event => {
    const row = event.target.closest('.studio-field-card');
    if (!row) return;
    if (event.target.matches('input[name$="-DELETE"]')) renumber(row.parentElement);
    if (event.target.matches('select[name$="-data_type"]')) updateStudioField(row);
});
document.addEventListener('input', event => {
    if (!event.target.matches('.studio-field-card input[name$="-label"]')) return;
    const title = event.target.closest('.studio-field-card').querySelector('.studio-field-title');
    if (title) title.textContent = event.target.value.trim() || 'New field';
});
document.addEventListener('change', event => {
    const input = event.target;
    if (!input.matches('.default-image-setting input[type="file"]') || !input.files?.[0]) return;
    const setting = input.closest('.default-image-setting');
    let preview = setting.querySelector('.default-image-thumb');
    if (!preview) {
        preview = document.createElement('img');
        preview.className = 'default-image-thumb';
        preview.alt = 'Selected default image preview';
        setting.insertBefore(preview, input);
    }
    preview.src = URL.createObjectURL(input.files[0]);
});
function updateStudioField(row) {
    const type = row.querySelector('select[name$="-data_type"]')?.value || 'text';
    row.dataset.fieldType = type;
    row.querySelectorAll('.field-setting').forEach(control => {
        const setting = control.dataset.setting;
        control.hidden = (type === 'upload' && setting !== 'image') ||
            (type !== 'upload' && setting === 'image') || (type === 'date' && setting === 'max');
    });
    row.querySelectorAll('.studio-type-hint').forEach(hint => { hint.hidden = hint.dataset.hint !== type; });
}
document.querySelectorAll('.studio-field-card').forEach(row => { updateStudioField(row); setupStudioColor(row); });
function setupStudioColor(row) {
    const picker = row.querySelector('[data-color-picker]');
    if (!picker || picker.dataset.ready) return;
    picker.dataset.ready = '1';
    const value = picker.parentElement.querySelector('input[name$="-color"]');
    if (!value) return;
    if (/^#[0-9a-f]{6}$/i.test(value.value)) picker.value = value.value;
    picker.addEventListener('input', () => { value.value = picker.value; });
    value.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(value.value)) picker.value = value.value; });
}
document.querySelectorAll('#slotRows, #textRows').forEach(renumber);
