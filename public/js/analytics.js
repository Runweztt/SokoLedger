// Financial blueprint view: aggregates from GET /api/analytics/summary,
// rendered as hand-rolled CSS bars rather than pulling in a charting
// library for what's a handful of bars and a sparkline-scale dataset.
const SokoAnalytics = (() => {
  let currentBucket = 'byDay';
  let lastSummary = null;
  let dirty = true;

  function money(n) {
    return Number(n || 0).toFixed(2);
  }

  function bucketLabel(bucket, isoDate) {
    const date = new Date(isoDate);
    if (bucket === 'byMonth') return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    if (bucket === 'byWeek') return `wk of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderChart() {
    const chart = document.getElementById('revenue-chart');
    chart.innerHTML = '';
    const series = lastSummary[currentBucket];
    if (!series || series.length === 0) return;
    const max = Math.max(...series.map((d) => d.revenue), 1);
    for (const point of series) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${Math.max((point.revenue / max) * 100, 1)}%`;
      bar.dataset.label = `${bucketLabel(currentBucket, point.bucket)}: ${money(point.revenue)}`;
      chart.appendChild(bar);
    }
  }

  function renderStats() {
    document.getElementById('stat-total').textContent = money(lastSummary.totalRevenue);
    document.getElementById('stat-avg-daily').textContent = money(lastSummary.avgDailyRevenue);

    const momEl = document.getElementById('stat-mom');
    momEl.className = 'value';
    if (!lastSummary.momTrend || lastSummary.momTrend.pctChange === null) {
      momEl.textContent = 'Not enough history yet';
    } else {
      const pct = lastSummary.momTrend.pctChange;
      momEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
      momEl.classList.add(pct >= 0 ? 'trend-up' : 'trend-down');
    }
  }

  function renderTopItems() {
    const list = document.getElementById('top-items-list');
    list.innerHTML = '';
    const items = lastSummary.topItems;
    document.getElementById('blueprint-empty').classList.toggle('hidden', items.length > 0);
    if (items.length === 0) return;
    const max = Math.max(...items.map((i) => i.revenue), 1);
    for (const item of items) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span style="min-width:110px">${item.item}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(item.revenue / max) * 100}%"></span></span>
        <span>${money(item.revenue)}</span>
      `;
      list.appendChild(li);
    }
  }

  async function refresh() {
    lastSummary = await SokoAPI.request('/api/analytics/summary');
    renderStats();
    renderChart();
    renderTopItems();
    dirty = false;
  }

  function bind() {
    document.getElementById('bucket-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-bucket]');
      if (!btn) return;
      currentBucket = btn.dataset.bucket;
      document.querySelectorAll('#bucket-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
      if (lastSummary) renderChart();
    });

    document.getElementById('export-csv').addEventListener('click', () => {
      SokoAPI.download('/api/analytics/export?format=csv', 'sokoledger-statement.csv').catch((err) => alert(err.message));
    });
    document.getElementById('export-pdf').addEventListener('click', () => {
      SokoAPI.download('/api/analytics/export?format=pdf', 'sokoledger-statement.pdf').catch((err) => alert(err.message));
    });

    window.addEventListener('sokoledger:entry-added', () => {
      dirty = true;
    });
  }

  function onShow() {
    if (dirty) refresh();
  }

  return { bind, refresh, onShow };
})();
