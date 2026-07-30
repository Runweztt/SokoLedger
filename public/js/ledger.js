// Sortable/filterable ledger table, backed by real query params against
// GET /api/sales, not a client-side filter over a preloaded array (the
// trader's whole history won't fit in one page, and the backend already
// does the filtering/sorting via the shared query layer).
const SokoLedger = (() => {
  const state = { page: 1, pageSize: 25, sort: 'date', order: 'desc', q: '', item: '', from: '', to: '' };
  let debounceTimer = null;
  let dirty = true;

  function money(n) {
    return n === null || n === undefined ? '—' : Number(n).toFixed(2);
  }

  function buildQuery() {
    const params = new URLSearchParams({
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      order: state.order,
    });
    if (state.q) params.set('q', state.q);
    if (state.item) params.set('item', state.item);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
    return params.toString();
  }

  function renderRows(rows) {
    const tbody = document.getElementById('ledger-rows');
    tbody.innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      const date = new Date(row.occurred_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      tr.innerHTML = `
        <td>${date}</td>
        <td>${escapeHtml(row.item)}</td>
        <td>${row.quantity}</td>
        <td>${money(row.unit_price)}${row.is_estimated ? ' <span class="est">est.</span>' : ''}</td>
        <td>${money(row.total_amount)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function updateSortHeaders() {
    document.querySelectorAll('.ledger-table th[data-sort]').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === state.sort);
      th.classList.toggle('asc', th.dataset.sort === state.sort && state.order === 'asc');
    });
  }

  async function refresh() {
    const data = await SokoAPI.request(`/api/sales?${buildQuery()}`);
    renderRows(data.rows);
    document.getElementById('ledger-empty').classList.toggle('hidden', data.total > 0);
    const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1);
    document.getElementById('ledger-page-label').textContent = `Page ${data.page} of ${totalPages} (${data.total} sale${data.total === 1 ? '' : 's'})`;
    document.getElementById('ledger-prev').disabled = data.page <= 1;
    document.getElementById('ledger-next').disabled = data.page >= totalPages;
    dirty = false;
  }

  function scheduleRefresh() {
    state.page = 1;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 300);
  }

  function bind() {
    document.getElementById('ledger-search').addEventListener('input', (e) => {
      state.q = e.target.value.trim();
      scheduleRefresh();
    });
    document.getElementById('ledger-item').addEventListener('input', (e) => {
      state.item = e.target.value.trim();
      scheduleRefresh();
    });
    document.getElementById('ledger-from').addEventListener('change', (e) => {
      state.from = e.target.value;
      scheduleRefresh();
    });
    document.getElementById('ledger-to').addEventListener('change', (e) => {
      state.to = e.target.value;
      scheduleRefresh();
    });
    document.querySelectorAll('.ledger-table th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        if (state.sort === th.dataset.sort) {
          state.order = state.order === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = th.dataset.sort;
          state.order = 'desc';
        }
        updateSortHeaders();
        refresh();
      });
    });
    document.getElementById('ledger-prev').addEventListener('click', () => {
      if (state.page > 1) {
        state.page -= 1;
        refresh();
      }
    });
    document.getElementById('ledger-next').addEventListener('click', () => {
      state.page += 1;
      refresh();
    });
    window.addEventListener('sokoledger:entry-added', () => {
      dirty = true;
    });
    updateSortHeaders();
  }

  function onShow() {
    if (dirty) refresh();
  }

  return { bind, refresh, onShow };
})();
