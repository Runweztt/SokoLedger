// The signature interaction: a trader speaks or types a sentence and
// watches it resolve into a structured tally row. Everything here is
// built around that one moment; every other view is quieter by design.
const SokoEntry = (() => {
  let pendingPollTimer = null;

  function money(n) {
    return Number(n).toFixed(2);
  }

  function confidenceChip(confidence) {
    if (confidence === null || confidence === undefined) return '';
    const pct = Math.round(confidence * 100);
    const tier = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
    return `<span class="confidence-chip ${tier}"><span class="spark"></span>heard ${pct}% clearly</span>`;
  }

  function renderTallyRow(entry) {
    const row = document.createElement('div');
    row.className = 'tally-row';
    const amountClass = entry.is_estimated ? 'amount estimated' : 'amount';
    row.innerHTML = `
      <span class="item">${entry.quantity} &times; ${escapeHtml(entry.item)}</span>
      <span class="${amountClass}">
        ${money(entry.total_amount)}
        ${entry.is_estimated ? '<span class="estimated-flag">estimated price</span>' : ''}
        ${confidenceChip(entry.confidence)}
      </span>
    `;
    const container = document.getElementById('entry-result');
    container.prepend(row);
  }

  function setAiStatus(state, text) {
    const el = document.getElementById('ai-status');
    if (!el) return;
    el.className = `ai-status${state ? ` state-${state}` : ''}`;
    el.querySelector('.ai-status-text').textContent = text;
  }

  function showParsingGhost() {
    const ghost = document.createElement('div');
    ghost.className = 'parsing-ghost';
    ghost.id = 'parsing-ghost';
    ghost.innerHTML = `
      <span class="ghost-bar item"></span>
      <span class="ghost-bar amount"></span>
    `;
    document.getElementById('entry-result').prepend(ghost);
    return ghost;
  }

  function removeParsingGhost() {
    const ghost = document.getElementById('parsing-ghost');
    if (ghost) ghost.remove();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function clearBanners() {
    for (const id of ['entry-clarify', 'entry-duplicate', 'entry-queue-note']) {
      const el = document.getElementById(id);
      el.classList.add('hidden');
      el.innerHTML = '';
    }
  }

  // Renders the minimal fallback form pre-filled with whatever partial
  // data was extracted, never a blank form. Used for both the
  // "couldn't understand you" path and completing a queue item that
  // eventually came back unparseable.
  function buildFallbackForm({ rawText, partial, onSubmit }) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <p>${rawText ? `You said: "${escapeHtml(rawText)}"` : ''}</p>
      <div class="field"><label>Item</label><input class="fb-item" value="${escapeHtml(partial?.item || '')}" /></div>
      <div class="field"><label>Quantity</label><input class="fb-qty" type="number" step="any" value="${partial?.quantity ?? ''}" /></div>
      <div class="field"><label>Unit price (or leave blank and fill total)</label><input class="fb-unit" type="number" step="any" value="${partial?.unitPrice ?? ''}" /></div>
      <div class="field"><label>Total amount (or leave blank if unit price given)</label><input class="fb-total" type="number" step="any" value="${partial?.totalAmount ?? ''}" /></div>
      <button type="button" class="btn-small fb-submit">Save this sale</button>
    `;
    wrap.querySelector('.fb-submit').addEventListener('click', () => {
      const item = wrap.querySelector('.fb-item').value.trim();
      const quantity = Number(wrap.querySelector('.fb-qty').value);
      const unitPriceRaw = wrap.querySelector('.fb-unit').value;
      const totalRaw = wrap.querySelector('.fb-total').value;
      if (!item || !quantity || quantity <= 0) {
        alert('Enter at least an item and a quantity greater than zero.');
        return;
      }
      onSubmit({
        item,
        quantity,
        unitPrice: unitPriceRaw === '' ? undefined : Number(unitPriceRaw),
        totalAmount: totalRaw === '' ? undefined : Number(totalRaw),
        rawText: rawText || `${quantity} ${item}`,
      });
    });
    return wrap;
  }

  async function submitManual(payload) {
    const data = await SokoAPI.request('/api/sales/manual', { method: 'POST', body: payload });
    if (data.status === 'duplicate') {
      showDuplicateBanner(data, payload);
      return;
    }
    // No price given and no history to estimate from, so ask again rather
    // than inserting a sale with no revenue figure at all.
    if (data.status === 'clarify') {
      showClarify(data.question, payload, payload.rawText);
      return;
    }
    clearBanners();
    renderTallyRow(data.entry);
    window.dispatchEvent(new CustomEvent('sokoledger:entry-added'));
  }

  function showClarify(question, partial, rawText) {
    const el = document.getElementById('entry-clarify');
    el.classList.remove('hidden');
    el.innerHTML = `<p>${escapeHtml(question)}</p>`;
    el.appendChild(
      buildFallbackForm({
        rawText,
        partial,
        onSubmit: (payload) => submitManual(payload).then(() => el.classList.add('hidden')),
      })
    );
  }

  function showDuplicateBanner(data, payload) {
    const el = document.getElementById('entry-duplicate');
    el.classList.remove('hidden');
    el.innerHTML = `<p>${escapeHtml(data.message)}</p>`;
    const actions = document.createElement('div');
    actions.className = 'dup-actions';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn-small';
    confirmBtn.textContent = 'Log it again anyway';
    confirmBtn.addEventListener('click', async () => {
      await submitManual({ ...payload, force: true });
      el.classList.add('hidden');
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-small';
    cancelBtn.textContent = 'No, skip it';
    cancelBtn.addEventListener('click', () => el.classList.add('hidden'));
    actions.append(confirmBtn, cancelBtn);
    el.appendChild(actions);
  }

  function showQueued(message) {
    const el = document.getElementById('entry-queue-note');
    el.classList.remove('hidden');
    el.textContent = message;
    refreshPending();
  }

  async function handleParseResponse(data, rawText) {
    clearBanners();
    if (data.status === 'inserted') {
      renderTallyRow(data.entry);
      setAiStatus('done', 'Logged. Say the next one whenever you\'re ready');
      window.dispatchEvent(new CustomEvent('sokoledger:entry-added'));
    } else if (data.status === 'clarify') {
      showClarify(data.question, data.partial, rawText);
      setAiStatus('error', 'Almost there, just needs one more detail');
    } else if (data.status === 'unparseable') {
      showClarify(data.message, null, rawText);
      setAiStatus('error', 'Couldn\'t make sense of that one');
    } else if (data.status === 'duplicate') {
      showDuplicateBanner(data, {
        item: data.partial.item,
        quantity: data.partial.quantity,
        unitPrice: data.partial.unitPrice,
        totalAmount: data.partial.totalAmount,
        rawText,
      });
      setAiStatus(null, 'Looks like one you already logged');
    } else if (data.status === 'queued') {
      showQueued(data.message);
      setAiStatus('thinking', 'Connection is slow, so this is queued and will finish in the background');
    }
  }

  function renderPendingRow(item) {
    const row = document.createElement('div');
    row.className = 'pending-item';
    const statusClass = item.status === 'failed' ? 'status-failed' : 'status-pending';
    const statusLabel = item.status === 'failed' ? (item.last_error || 'Needs your input') : 'Still processing…';
    row.innerHTML = `<span>"${escapeHtml(item.raw_text)}"</span><span class="${statusClass}">${escapeHtml(statusLabel)}</span>`;

    if (item.status === 'failed') {
      const fixBtn = document.createElement('button');
      fixBtn.className = 'btn-small';
      fixBtn.textContent = 'Finish this entry';
      fixBtn.addEventListener('click', () => {
        const form = buildFallbackForm({
          rawText: item.raw_text,
          partial: null,
          onSubmit: async (payload) => {
            await submitManual(payload);
            await SokoAPI.request(`/api/sales/pending/${item.id}`, { method: 'DELETE' });
            refreshPending();
          },
        });
        row.appendChild(form);
        fixBtn.remove();
      });
      row.appendChild(fixBtn);
    }
    return row;
  }

  async function refreshPending() {
    const data = await SokoAPI.request('/api/sales/pending');
    const card = document.getElementById('pending-card');
    const list = document.getElementById('pending-list');
    list.innerHTML = '';
    if (data.rows.length === 0) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    for (const row of data.rows) {
      list.appendChild(renderPendingRow(row));
    }
  }

  function startPendingPolling() {
    if (pendingPollTimer) return;
    refreshPending();
    pendingPollTimer = setInterval(refreshPending, 8000);
  }

  function stopPendingPolling() {
    clearInterval(pendingPollTimer);
    pendingPollTimer = null;
  }

  function setupMic() {
    const micBtn = document.getElementById('mic-btn');
    const textarea = document.getElementById('entry-text');
    const unsupportedNote = document.getElementById('speech-unsupported-note');
    const waveBars = document.querySelectorAll('#mic-waveform span');

    if (!SokoSpeech.isSupported()) {
      micBtn.classList.add('hidden');
      unsupportedNote.classList.remove('hidden');
      return;
    }

    let recognizer = null;
    let visualizer = null;
    let recording = false;
    let heardSomething = false;

    function paintLevel(level) {
      waveBars.forEach((bar, i) => {
        const jitter = 0.55 + Math.abs(Math.sin(Date.now() / 140 + i * 1.3)) * 0.6;
        const pct = Math.max(15, Math.min(100, level * jitter * 100));
        bar.style.height = `${pct}%`;
      });
    }

    function stopRecording() {
      recording = false;
      micBtn.classList.remove('recording');
      if (visualizer) visualizer.stop();
      waveBars.forEach((bar) => (bar.style.height = '20%'));
    }

    micBtn.addEventListener('click', () => {
      if (recording) {
        recognizer.stop();
        return;
      }
      heardSomething = false;
      recognizer = SokoSpeech.createRecognizer({
        onInterim: (text) => {
          heardSomething = true;
          textarea.value = text;
          setAiStatus('listening', 'Listening…');
        },
        onFinal: (text) => {
          heardSomething = true;
          textarea.value = text;
        },
        onEnd: () => {
          stopRecording();
          if (heardSomething && textarea.value.trim()) {
            setAiStatus('thinking', 'Got it, reading your words…');
            document.getElementById('entry-form').requestSubmit();
          } else {
            setAiStatus(null, 'Ready when you are');
          }
        },
        onError: () => {
          stopRecording();
          setAiStatus('error', 'Didn\'t catch that, try again or type it');
        },
      });
      recognizer.start();
      recording = true;
      micBtn.classList.add('recording');
      setAiStatus('listening', 'Listening…');

      visualizer = SokoSpeech.createVisualizer({ onLevel: paintLevel });
      visualizer.start().catch(() => {
        // Mic-permission edge case: transcript still works without the
        // visualizer, so fail silently rather than blocking dictation.
      });
    });
  }

  function setupForm() {
    const form = document.getElementById('entry-form');
    const textarea = document.getElementById('entry-text');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = textarea.value.trim();
      if (text.length < 2) return;

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      setAiStatus('thinking', 'Reading your words…');
      showParsingGhost();
      try {
        const data = await SokoAPI.request('/api/sales/parse', { method: 'POST', body: { text } });
        removeParsingGhost();
        await handleParseResponse(data, text);
        textarea.value = '';
      } catch (err) {
        removeParsingGhost();
        clearBanners();
        setAiStatus('error', 'Something went wrong logging that sale');
        const el = document.getElementById('entry-clarify');
        el.classList.remove('hidden');
        el.textContent = err.message || 'Something went wrong logging that sale.';
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function init() {
    setupMic();
    setupForm();
  }

  return { init, startPendingPolling, stopPendingPolling };
})();
