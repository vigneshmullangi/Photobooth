(function () {
    'use strict';
    const preview = document.querySelector('.frame-preview');
    const rows = document.getElementById('textRows');
    if (!preview || !rows) return;
    const slotRows = document.getElementById('slotRows');

    const control = (row, key) => row.querySelector(`[name$="-${key}"]`);
    const allRows = () => [...rows.querySelectorAll('.studio-field-card')].filter(row => control(row, 'x'));
    const number = (row, key, fallback) => {
        const raw = control(row, key)?.value;
        if (raw == null || raw.trim() === '') return fallback;
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    };
    const write = (row, key, value) => {
        const input = control(row, key);
        if (!input) return;
        input.value = String(Math.round(value * 100) / 100);
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
    };
    const deleted = row => !!row.querySelector('input[name$="-DELETE"]')?.checked;
    const styleBox = (box, row) => {
        box.style.left = `${number(row, 'x', 10)}%`;
        box.style.top = `${number(row, 'y', 5)}%`;
        box.style.width = `${number(row, 'w', 80)}%`;
        box.style.height = `${number(row, 'h', 8)}%`;
        const label = row.querySelector('[name$="-label"]')?.value || 'Text';
        const text = row.querySelector('[name$="-default_text"]')?.value || label;
        const type = row.querySelector('[name$="-data_type"]')?.value || 'text';
        const upper = row.querySelector('[name$="-uppercase"]')?.checked;
        const color = row.querySelector('[name$="-color"]')?.value || '#b8893b';
        const align = row.querySelector('[name$="-align"]')?.value || 'center';
        const font = row.querySelector('[name$="-font"]')?.value || 'modern';
        const fonts = {
            script: '"Great Vibes",cursive', serif: '"Playfair Display",Georgia,serif',
            bold: 'Montserrat,system-ui,sans-serif', modern: 'Inter,system-ui,sans-serif',
            display: '"Bebas Neue",Impact,sans-serif', mono: '"Courier New",monospace',
            rounded: '"Trebuchet MS",Arial,sans-serif', arial: 'Arial,Helvetica,sans-serif',
            verdana: 'Verdana,Geneva,sans-serif', trebuchet: '"Trebuchet MS",Arial,sans-serif',
            georgia: 'Georgia,serif', times: '"Times New Roman",Times,serif',
            courier: '"Courier New",Courier,monospace', impact: 'Impact,sans-serif',
            inter: 'Inter,system-ui,sans-serif', fraunces: 'Fraunces,Georgia,serif',
            playfair: '"Playfair Display",Georgia,serif', montserrat: 'Montserrat,system-ui,sans-serif',
            bebas: '"Bebas Neue",Impact,sans-serif'
        };
        const bold = row.querySelector('[name$="-bold"]')?.checked;
        const italic = row.querySelector('[name$="-italic"]')?.checked;
        const underline = row.querySelector('[name$="-underline"]')?.checked;
        const size = number(row, 'font_size', 1);
        const effect = row.querySelector('[name$="-effect"]')?.value || 'none';
        const span = box.querySelector('span');
        let image = box.querySelector('.field-image-preview');
        const fileInput = control(row, 'default_image');
        if (fileInput?.files?.[0] && row._previewImageFile !== fileInput.files[0]) {
            if (row._previewImageUrl) URL.revokeObjectURL(row._previewImageUrl);
            row._previewImageFile = fileInput.files[0];
            row._previewImageUrl = URL.createObjectURL(fileInput.files[0]);
            box.dataset.imageUrl = row._previewImageUrl;
        }
        if (!fileInput?.files?.[0] && row.querySelector('input[name$="-default_image-clear"]')?.checked) {
            box.dataset.imageUrl = '';
        }
        const imageUrl = box.dataset.imageUrl || '';
        if (type === 'upload') {
            box.classList.add('image-field');
            if (imageUrl) {
                if (!image) {
                    image = document.createElement('img');
                    image.className = 'field-image-preview';
                    image.alt = `${label} preview`;
                    box.insertBefore(image, span);
                }
                image.src = imageUrl;
                image.hidden = false;
                span.hidden = true;
            } else {
                image?.remove();
                span.hidden = false;
                span.textContent = 'Upload image';
            }
        } else {
            box.classList.remove('image-field');
            image?.remove();
            span.hidden = false;
            span.textContent = upper ? text.toUpperCase() : text;
        }
        span.style.color = color;
        span.style.textAlign = align;
        span.style.fontFamily = fonts[font];
        span.style.fontWeight = bold ? '700' : '';
        span.style.fontStyle = italic ? 'italic' : '';
        span.style.textDecoration = underline ? 'underline' : '';
        span.style.fontSize = `${Math.max(8, Math.round(16 * size))}px`;
        span.style.textShadow = effect === 'shadow' ? '1px 2px 3px #0008' : '';
        span.style.webkitTextStroke = effect === 'outline' ? '1px currentColor' : '';
        box.title = `${label}: drag to move; drag the corner to resize`;
        box.hidden = deleted(row);
    };
    const ensureBoxes = () => {
        allRows().forEach((row, index) => {
            [['x', 10], ['y', 5], ['w', 80], ['h', 8]].forEach(([key, value]) => {
                const input = control(row, key);
                if (input && input.value.trim() === '') input.value = String(value);
            });
            let box = preview.querySelector(`.win.txt[data-text-index="${index}"]`);
            if (!box) {
                box = document.createElement('div');
                box.className = 'win txt';
                box.dataset.textIndex = index;
                box.innerHTML = '<span></span><i class="txt-resize" aria-hidden="true"></i>';
                preview.appendChild(box);
            }
            if (!box.dataset.dragBound) {
                box.addEventListener('pointerdown', beginDrag);
                box.dataset.dragBound = '1';
            }
            box._row = row;
            styleBox(box, row);
        });
        [...preview.querySelectorAll('.win.txt')].forEach(box => {
            if (!allRows().includes(box._row)) box.remove();
        });
    };
    function beginDrag(event) {
        event.preventDefault();
        event.stopPropagation();
        const box = event.currentTarget, row = box._row;
        if (!row || deleted(row)) return;
        preview.querySelectorAll('.win.txt').forEach(item => item.classList.toggle('is-selected', item === box));
        const resizing = event.target.classList.contains('txt-resize');
        const rect = preview.getBoundingClientRect();
        const startX = event.clientX, startY = event.clientY;
        const start = {x: number(row, 'x', 10), y: number(row, 'y', 5), w: number(row, 'w', 80), h: number(row, 'h', 8)};
        const move = e => {
            const dx = (e.clientX - startX) / rect.width * 100;
            const dy = (e.clientY - startY) / rect.height * 100;
            if (resizing) {
                write(row, 'w', Math.max(3, Math.min(100 - start.x, start.w + dx)));
                write(row, 'h', Math.max(2, Math.min(100 - start.y, start.h + dy)));
            } else {
                write(row, 'x', Math.max(0, Math.min(100 - start.w, start.x + dx)));
                write(row, 'y', Math.max(0, Math.min(100 - start.h, start.y + dy)));
            }
            styleBox(box, row);
        };
        const end = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            ensureBoxes();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end, {once: true});
    }
    rows.addEventListener('input', ensureBoxes);
    rows.addEventListener('change', ensureBoxes);
    document.getElementById('addText')?.addEventListener('click', () => requestAnimationFrame(ensureBoxes));
    ensureBoxes();

    // Keep the numbered camera windows directly editable in the same preview.
    if (slotRows) {
        const cameraRows = () => [...slotRows.querySelectorAll('tr')].filter(row => control(row, 'x'));
        const styleCameraBox = (box, row, index) => {
            box.style.left = `${number(row, 'x', 0)}%`;
            box.style.top = `${number(row, 'y', 0)}%`;
            box.style.width = `${number(row, 'w', 20)}%`;
            box.style.height = `${number(row, 'h', 20)}%`;
            const shape = control(row, 'shape')?.value || 'square';
            box.className = `win win-${shape} camera-window${row.querySelector('input[name$="-DELETE"]')?.checked ? ' is-deleted' : ''}`;
            box.textContent = String(index + 1);
            box.title = `Photo window ${index + 1}: drag to move; use the coordinate fields for exact placement`;
            box.hidden = !!row.querySelector('input[name$="-DELETE"]')?.checked;
        };
        const ensureCameraBoxes = () => {
            cameraRows().forEach((row, index) => {
                let box = preview.querySelector(`.camera-window[data-slot-index="${index}"]`);
                if (!box) {
                    box = document.createElement('div');
                    box.dataset.slotIndex = String(index);
                    preview.appendChild(box);
                }
                if (!box.dataset.dragBound) {
                    box.addEventListener('pointerdown', beginCameraDrag);
                    box.dataset.dragBound = '1';
                }
                box._row = row;
                styleCameraBox(box, row, index);
            });
            [...preview.querySelectorAll('.camera-window')].forEach(box => {
                if (!cameraRows().includes(box._row)) box.remove();
            });
        };
        function beginCameraDrag(event) {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const box = event.currentTarget, row = box._row;
            if (!row || row.querySelector('input[name$="-DELETE"]')?.checked) return;
            preview.querySelectorAll('.camera-window').forEach(item => item.classList.toggle('is-selected', item === box));
            const rect = preview.getBoundingClientRect(), startX = event.clientX, startY = event.clientY;
            const start = {x: number(row, 'x', 0), y: number(row, 'y', 0), w: number(row, 'w', 20), h: number(row, 'h', 20)};
            const move = e => {
                const dx = (e.clientX - startX) / rect.width * 100;
                const dy = (e.clientY - startY) / rect.height * 100;
                write(row, 'x', Math.max(0, Math.min(100 - start.w, start.x + dx)));
                write(row, 'y', Math.max(0, Math.min(100 - start.h, start.y + dy)));
                styleCameraBox(box, row, Number(box.dataset.slotIndex));
            };
            const end = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', end);
                ensureCameraBoxes();
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', end, {once: true});
            window.addEventListener('pointercancel', end, {once: true});
        }
        slotRows.addEventListener('input', ensureCameraBoxes);
        slotRows.addEventListener('change', ensureCameraBoxes);
        slotRows.addEventListener('click', event => {
            if (event.target.closest('#addSlot')) requestAnimationFrame(ensureCameraBoxes);
        });
        new MutationObserver(ensureCameraBoxes).observe(slotRows, {childList: true});
        ensureCameraBoxes();
    }

})();
