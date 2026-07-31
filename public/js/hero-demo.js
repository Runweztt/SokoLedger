// Purely cosmetic loop on the landing page: canned examples, no network
// calls, just replaying the same "sentence resolves into a tally row"
// moment from the entry view so a logged-out visitor can see what the
// AI step actually feels like before creating an account.
const SokoHeroDemo = (() => {
  const examples = [
    { text: 'sold 10 eggs today by 12pm', item: 'eggs', quantity: 10, total: 250, confidence: 0.96 },
    { text: '3 loaves this morning, 500 each', item: 'loaves', quantity: 3, total: 1500, confidence: 0.91 },
    { text: 'sold two bags of rice, not sure the price', item: 'bags of rice', quantity: 2, total: 900, confidence: 0.58, estimated: true },
  ];
  let idx = 0;
  let timer = null;

  function money(n) {
    return Number(n).toFixed(2);
  }

  function run() {
    const lineEl = document.getElementById('hero-demo-line');
    const resultEl = document.getElementById('hero-demo-result');
    if (!lineEl || !resultEl) return;

    const ex = examples[idx % examples.length];
    idx++;

    resultEl.innerHTML = '';
    lineEl.textContent = `“${ex.text}”`;

    const ghost = document.createElement('div');
    ghost.className = 'parsing-ghost';
    ghost.innerHTML = '<span class="ghost-bar item"></span><span class="ghost-bar amount"></span>';
    resultEl.appendChild(ghost);

    setTimeout(() => {
      ghost.remove();
      const tier = ex.confidence >= 0.8 ? 'high' : ex.confidence >= 0.5 ? 'medium' : 'low';
      const pct = Math.round(ex.confidence * 100);
      const row = document.createElement('div');
      row.className = 'tally-row';
      row.innerHTML = `
        <span class="item">${ex.quantity} &times; ${ex.item}</span>
        <span class="amount${ex.estimated ? ' estimated' : ''}">
          ${money(ex.total)}
          ${ex.estimated ? '<span class="estimated-flag">estimated price</span>' : ''}
          <span class="confidence-chip ${tier}"><span class="spark"></span>heard ${pct}% clearly</span>
        </span>
      `;
      resultEl.appendChild(row);
    }, 850);
  }

  function init() {
    clearInterval(timer);
    run();
    timer = setInterval(run, 4400);
  }

  function stop() {
    clearInterval(timer);
  }

  return { init, stop };
})();
