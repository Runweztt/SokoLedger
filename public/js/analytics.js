// Financial blueprint view: aggregates from GET /api/analytics/summary,
// rendered as hand-rolled CSS bars rather than pulling in a charting
// library for what's a handful of bars and a sparkline-scale dataset.
const SokoAnalytics = (() => {
  let currentBucket = 'byDay';
  let currentPeriodDays = 30;
  let lastSummary = null;
  let dirty = true;

  function money(n) {
    return Number(n || 0).toFixed(2);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function bucketLabel(bucket, isoDate) {
    const date = new Date(isoDate);
    if (bucket === 'byMonth') return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    if (bucket === 'byWeek') return `wk of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fromDateForPeriod(days) {
    if (days === 'all') return undefined;
    const d = new Date();
    d.setDate(d.getDate() - Number(days));
    return d.toISOString().slice(0, 10);
  }

  function renderChart() {
    const chart = document.getElementById('revenue-chart');
    const scaleLabel = document.getElementById('chart-scale');
    chart.innerHTML = '';
    const series = lastSummary[currentBucket];
    document.getElementById('chart-empty').classList.toggle('hidden', series && series.length > 0);
    if (!series || series.length === 0) {
      scaleLabel.textContent = '';
      return;
    }
    const max = Math.max(...series.map((d) => d.revenue), 1);
    scaleLabel.textContent = `peak: ${money(max)}`;
    for (const point of series) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      const targetPct = Math.max((point.revenue / max) * 100, 1);
      bar.style.height = '0%';
      bar.dataset.label = `${bucketLabel(currentBucket, point.bucket)}: ${money(point.revenue)}`;
      chart.appendChild(bar);
      // Set the real height a frame later so the 0% -> target change is
      // actually a transition, not a bar that just appears full-grown.
      requestAnimationFrame(() => {
        bar.style.height = `${targetPct}%`;
      });
    }
  }

  function renderStats() {
    document.getElementById('stat-total').textContent = money(lastSummary.totalRevenue);
    document.getElementById('stat-avg-daily').textContent = money(lastSummary.avgDailyRevenue);
    const salesCount = lastSummary.byDay.reduce((sum, d) => sum + (d.entryCount || 0), 0);
    document.getElementById('stat-count').textContent = String(salesCount);

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
    items.forEach((item, i) => {
      const targetPct = (item.revenue / max) * 100;
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="rank">${i + 1}</span>
        <span class="top-item-name">${escapeHtml(item.item)}<span class="top-item-units">${item.unitsSold} sold</span></span>
        <span class="bar-track"><span class="bar-fill" style="width:0%"></span></span>
        <span class="top-item-revenue">${money(item.revenue)}</span>
      `;
      list.appendChild(li);
      const fill = li.querySelector('.bar-fill');
      requestAnimationFrame(() => {
        fill.style.width = `${targetPct}%`;
      });
    });
  }

  async function refresh() {
    const params = new URLSearchParams();
    const from = fromDateForPeriod(currentPeriodDays);
    if (from) params.set('from', from);
    const qs = params.toString();
    lastSummary = await SokoAPI.request(`/api/analytics/summary${qs ? `?${qs}` : ''}`);
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

    document.getElementById('period-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-days]');
      if (!btn) return;
      currentPeriodDays = btn.dataset.days === 'all' ? 'all' : Number(btn.dataset.days);
      document.querySelectorAll('#period-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
      refresh();
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
