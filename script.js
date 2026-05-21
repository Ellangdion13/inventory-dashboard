/* ============================================================
   BINTANG TOEDJOE - KCH INVENTORY MONITORING DASHBOARD
   Main JavaScript — Vanilla JS + Chart.js + PapaParse
   ============================================================ */

'use strict';

// ===================== GLOBAL STATE =====================
const App = {
  data: {
    outgoing: [],       // Raw parsed CSV data
    expense: [],        // Raw expense CSV data
    filtered: [],       // After date/filter applied
  },
  settings: {
    lowStockThreshold: 10,
    autoRefresh: true,
    refreshInterval: 60000,
    darkMode: false,
  },
  ui: {
    currentPage: 'dashboard',
    sidebarCollapsed: false,
    currentTrxPage: 1,
    trxPageSize: 25,
    trxSortCol: 'date',
    trxSortDir: 'desc',
    filterFrom: null,
    filterTo: null,
  },
  charts: {},           // Chart.js instances
  intervals: {},        // setInterval references
};

// ===================== CSV FILE PATHS =====================
const CSV_OUTGOING = './data/outgoing.csv';
const CSV_EXPENSE  = './data/outgoingexpense.csv';

// ===================== CHART.JS GLOBAL DEFAULTS =====================
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = 'Inter, sans-serif';
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10,15,30,0.92)';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(30,144,255,0.3)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;

// ===================== UTILITY FUNCTIONS =====================

/** Format date object → dd/mm/yyyy */
function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Parse dd/mm/yyyy → Date object */
function parseDate(str) {
  if (!str) return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
}

/** Format number with thousand separator */
function fmtNum(n) {
  return Number(n).toLocaleString('id-ID');
}

/** Format currency IDR */
function fmtCurrency(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

/** Get today's date as dd/mm/yyyy */
function todayStr() {
  return fmtDate(new Date());
}

/** Get array of last N dates as dd/mm/yyyy */
function lastNDates(n) {
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(fmtDate(d));
  }
  return dates;
}

/** Generate a gradient color array */
function gradColors(n) {
  const palette = [
    '#1e90ff','#00e5a0','#00d4ff','#a855f7','#f59e0b',
    '#ef4444','#06b6d4','#10b981','#f97316','#8b5cf6',
    '#ec4899','#14b8a6','#eab308','#6366f1','#84cc16',
  ];
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}

/** Destroy chart if exists, then recreate */
function destroyChart(key) {
  if (App.charts[key]) {
    App.charts[key].destroy();
    delete App.charts[key];
  }
}

// ===================== LOADING SCREEN =====================

/** Animate loading bar and show app */
function runLoadingSequence() {
  const bar    = document.getElementById('loadingBar');
  const status = document.getElementById('loadingStatus');
  const screen = document.getElementById('loadingScreen');
  const app    = document.getElementById('appWrapper');

  const steps = [
    { pct: 15,  msg: 'Initializing modules...' },
    { pct: 35,  msg: 'Loading CSV data sources...' },
    { pct: 60,  msg: 'Parsing inventory data...' },
    { pct: 80,  msg: 'Building charts...' },
    { pct: 95,  msg: 'Rendering dashboard...' },
    { pct: 100, msg: 'System ready!' },
  ];

  let idx = 0;

  const tick = setInterval(() => {
    if (idx >= steps.length) {
      clearInterval(tick);
      setTimeout(() => {
        screen.classList.add('fade-out');
        app.style.display = 'flex';
        setTimeout(() => screen.style.display = 'none', 800);
      }, 300);
      return;
    }
    const s = steps[idx++];
    bar.style.width = s.pct + '%';
    status.textContent = s.msg;
  }, 380);
}

// ===================== REALTIME CLOCK =====================

function startClock() {
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli',
                  'Agustus','September','Oktober','November','Desember'];

  function tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const ss  = String(now.getSeconds()).padStart(2, '0');

    const el = document.getElementById('clockTime');
    const de = document.getElementById('clockDate');
    if (el) el.textContent = `${hh}:${mm}:${ss}`;
    if (de) de.textContent =
      `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }

  tick();
  App.intervals.clock = setInterval(tick, 1000);
}

// ===================== DATA LOADING =====================

/** Load and parse both CSV files */
async function loadAllData() {
  try {
    const [outgoing, expense] = await Promise.all([
      loadCSV(CSV_OUTGOING),
      loadCSV(CSV_EXPENSE),
    ]);

    App.data.outgoing = outgoing;
    App.data.expense  = expense;
    App.data.filtered = [...outgoing];

    // Mark data source status
    setDsStatus('dsOutgoingStatus', outgoing.length > 0);
    setDsStatus('dsExpenseStatus',  expense.length  > 0);

    return true;
  } catch (err) {
    console.error('Data load error:', err);
    return false;
  }
}

/** Load a single CSV file using PapaParse */
function loadCSV(path) {
  return new Promise((resolve) => {

    Papa.parse(path, {
      download: true,
      header: true,
      skipEmptyLines: true,
      delimiter: ";",

      complete: (results) => {

        const rows = (results.data || []).map(row => ({
          date: row['Tanggal Pengambilan'] || '',
          item_code: row['Kode Item'] || '',
          item_name: row['Deskripsi'] || '',
          machine: row['Mesin (Area)'] || '',
          qty: row['Qty'] || 0,
          requester: row['Pemohon'] || '',
          stock: row['QTY\nActual Stock'] || 0,
          cost_allocation: row['Cost Alocation'] || '',
        }));

        console.log(rows);

        resolve(rows);
      },

      error: (err) => {
        console.error('CSV Error:', err);
        resolve([]);
      }
    });

  });
}
    });
  });
}

function setDsStatus(id, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = ok ? 'Loaded' : 'Error';
  el.style.background = ok
    ? 'rgba(0,229,160,0.12)' : 'rgba(239,68,68,0.12)';
  el.style.color = ok ? 'var(--clr-green)' : 'var(--clr-red)';
}

// ===================== DATE FILTER =====================

/** Apply date range filter to App.data.outgoing → App.data.filtered */
function applyDateFilter() {
  const from = App.ui.filterFrom;
  const to   = App.ui.filterTo;

  App.data.filtered = App.data.outgoing.filter(row => {
    if (!row.date) return false;
    const d = parseDate(row.date);
    if (!d) return false;
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });

  renderCurrentPage();
}

/** Set quick range */
function setQuickRange(range) {
  const today = new Date();
  today.setHours(0,0,0,0);

  document.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.qbtn[data-range="${range}"]`)?.classList.add('active');

  if (range === 'today') {
    App.ui.filterFrom = today;
    App.ui.filterTo   = today;
  } else if (range === 'week') {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() + 1); // Monday
    App.ui.filterFrom = start;
    App.ui.filterTo   = today;
  } else if (range === 'month') {
    App.ui.filterFrom = new Date(today.getFullYear(), today.getMonth(), 1);
    App.ui.filterTo   = today;
  } else {
    App.ui.filterFrom = null;
    App.ui.filterTo   = null;
  }

  // Sync date inputs
  const fromEl = document.getElementById('filterDateFrom');
  const toEl   = document.getElementById('filterDateTo');
  if (fromEl) fromEl.value = App.ui.filterFrom ? App.ui.filterFrom.toISOString().split('T')[0] : '';
  if (toEl)   toEl.value   = App.ui.filterTo   ? App.ui.filterTo.toISOString().split('T')[0]   : '';

  applyDateFilter();
}

// ===================== KPI CALCULATION =====================

function computeKPIs(data) {
  const today = todayStr();
  const todayRows = data.filter(r => r.date === today);
  const machines  = [...new Set(data.map(r => r.machine).filter(Boolean))];
  const requesters = [...new Set(data.map(r => r.requester).filter(Boolean))];

  return {
    totalData:      data.length,
    totalQty:       data.reduce((s, r) => s + (parseInt(r.qty) || 0), 0),
    todayQty:       todayRows.reduce((s, r) => s + (parseInt(r.qty) || 0), 0),
    todayTrx:       todayRows.length,
    activeMachines: machines.length,
    activeRequesters: requesters.length,
  };
}

function renderKPIs(data) {
  const kpi = computeKPIs(data);

  animateCounter('kpiTotalData',      kpi.totalData);
  animateCounter('kpiTotalQty',       kpi.totalQty);
  animateCounter('kpiTodayQty',       kpi.todayQty);
  animateCounter('kpiTodayTrx',       kpi.todayTrx);
  animateCounter('kpiActiveMachine',  kpi.activeMachines);
  animateCounter('kpiActiveRequester', kpi.activeRequesters);

  const todayEl = document.getElementById('kpiTodayDate');
  if (todayEl) todayEl.textContent = todayStr();
}

/** Smooth counter animation */
function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 800;
  const start    = performance.now();
  const from     = parseInt(el.textContent.replace(/[^\d]/g, '')) || 0;

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + (target - from) * ease);
    el.textContent = fmtNum(current);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ===================== CHARTS — DASHBOARD =====================

/** Trend Chart: Qty per day for last 7 days */
function renderTrendChart(data) {
  const dates  = lastNDates(7);
  const labels = dates.map(d => {
    const parts = d.split('/');
    return `${parts[0]}/${parts[1]}`;
  });
  const qtys = dates.map(date =>
    data.filter(r => r.date === date)
        .reduce((s, r) => s + (parseInt(r.qty) || 0), 0)
  );
  const trxs = dates.map(date =>
    data.filter(r => r.date === date).length
  );

  destroyChart('trend');
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;

  App.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Qty',
          data: qtys,
          borderColor: '#1e90ff',
          backgroundColor: 'rgba(30,144,255,0.08)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.45,
          pointBackgroundColor: '#1e90ff',
          pointRadius: 5,
          pointHoverRadius: 7,
          yAxisID: 'y',
        },
        {
          label: 'Transaksi',
          data: trxs,
          borderColor: '#00e5a0',
          backgroundColor: 'rgba(0,229,160,0.06)',
          borderWidth: 2,
          fill: true,
          tension: 0.45,
          pointBackgroundColor: '#00e5a0',
          pointRadius: 4,
          pointHoverRadius: 6,
          yAxisID: 'y1',
          borderDash: [5,4],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, padding: 16, font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
        y: {
          type: 'linear', position: 'left',
          grid: { color: 'rgba(255,255,255,0.05)' },
          border: { display: false },
          ticks: { font: { size: 11 } },
        },
        y1: {
          type: 'linear', position: 'right',
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 11 } },
        },
      },
    },
  });
}

/** Machine Donut Chart */
function renderMachineDonut(data) {
  const machineCounts = {};
  data.forEach(r => {
    if (r.machine) machineCounts[r.machine] = (machineCounts[r.machine] || 0) + 1;
  });

  const labels = Object.keys(machineCounts);
  const values = Object.values(machineCounts);
  const colors = gradColors(labels.length);

  destroyChart('machineDonut');
  const ctx = document.getElementById('machineDonutChart');
  if (!ctx) return;

  App.charts.machineDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + '33'),
        borderColor: colors,
        borderWidth: 2,
        hoverBorderWidth: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, padding: 12, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw} transaksi`,
          },
        },
      },
    },
  });
}

// ===================== LOW STOCK ALERT =====================

function renderLowStock(data) {
  const threshold = App.settings.lowStockThreshold;
  const container = document.getElementById('lowStockList');
  const countEl   = document.getElementById('lowStockCount');
  if (!container) return;

  // Get unique items with their latest stock value
  const itemMap = {};
  data.forEach(r => {
    if (r.item_code && r.stock !== undefined && r.stock !== '') {
      itemMap[r.item_code] = {
        code:  r.item_code,
        name:  r.item_name || r.item_code,
        stock: parseInt(r.stock) || 0,
      };
    }
  });

  const lowItems = Object.values(itemMap)
    .filter(item => item.stock <= threshold * 3)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 10);

  if (countEl) countEl.textContent = lowItems.filter(i => i.stock <= threshold).length;

  if (lowItems.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--clr-text3); padding:20px; font-size:13px;">
      <i class="bi bi-check-circle-fill" style="color:var(--clr-green); font-size:24px;"></i><br>Tidak ada item low stock
    </div>`;
    return;
  }

  container.innerHTML = lowItems.map(item => {
    const pct = Math.min((item.stock / (threshold * 3)) * 100, 100);
    let level = 'low', badge = 'LOW';
    if (item.stock <= threshold * 0.5)  { level = 'critical'; badge = 'CRITICAL'; }
    else if (item.stock <= threshold)    { level = 'warning';  badge = 'WARNING'; }

    return `
      <div class="low-stock-item">
        <div class="ls-header">
          <span class="ls-code">${item.code}</span>
          <span class="ls-badge ${level}">${badge}</span>
        </div>
        <div class="ls-name">${item.name}</div>
        <div class="ls-stock-row">
          <div class="ls-progress-wrap">
            <div class="ls-progress ${level}" style="width:${pct}%"></div>
          </div>
          <span class="ls-stock-val" style="color:var(--clr-${level === 'critical' ? 'red' : level === 'warning' ? 'orange' : 'text'})">
            ${item.stock} unit
          </span>
        </div>
      </div>
    `;
  }).join('');
}

// ===================== RECENT TRANSACTIONS =====================

function renderRecentTransactions(data) {
  const container = document.getElementById('recentTrxList');
  if (!container) return;

  const sorted = [...data].sort((a, b) => {
    const da = parseDate(a.date), db = parseDate(b.date);
    return (db || 0) - (da || 0);
  }).slice(0, 8);

  if (sorted.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--clr-text3); padding:20px; font-size:13px;">Tidak ada data transaksi</div>`;
    return;
  }

  const today = todayStr();

  container.innerHTML = sorted.map((row, idx) => {
    const isLatest = idx < 2;
    const isToday  = row.date === today;
    return `
      <div class="recent-trx-item ${isLatest ? 'latest' : ''}">
        <div class="trx-icon"><i class="bi bi-box-arrow-right"></i></div>
        <div class="trx-body">
          <div class="trx-name">${row.item_name || row.item_code || '-'}</div>
          <div class="trx-meta">
            <span><i class="bi bi-calendar3"></i> ${row.date}</span>
            <span><i class="bi bi-person"></i> ${row.requester || '-'}</span>
            <span><i class="bi bi-cpu"></i> ${row.machine || '-'}</span>
          </div>
        </div>
        <div class="trx-qty">+${row.qty || 0}</div>
        ${isToday ? '<span class="trx-badge-new">NEW</span>' : ''}
      </div>
    `;
  }).join('');
}

// ===================== CHARTS — MACHINE PAGE =====================

function renderMachinePage(data) {
  renderMachineKPIs(data);
  renderMachineBarChart(data);
  renderMachineBreakdownChart(data);
  renderMachineRankingTable(data);
  renderMachineTrendChart(data);
}

function renderMachineKPIs(data) {
  const container = document.getElementById('machineKpiRow');
  if (!container) return;

  const machineData = {};
  data.forEach(r => {
    if (!r.machine) return;
    if (!machineData[r.machine]) machineData[r.machine] = { trx: 0, qty: 0 };
    machineData[r.machine].trx++;
    machineData[r.machine].qty += parseInt(r.qty) || 0;
  });

  container.innerHTML = Object.entries(machineData)
    .sort((a, b) => b[1].trx - a[1].trx)
    .map(([machine, info]) => `
      <div class="machine-kpi-card">
        <div class="mkpi-icon"><i class="bi bi-cpu-fill"></i></div>
        <div class="mkpi-body">
          <div class="mkpi-name">${machine}</div>
          <div class="mkpi-val">${fmtNum(info.qty)}</div>
          <div class="mkpi-sub">${info.trx} transaksi</div>
        </div>
      </div>
    `).join('');
}

function renderMachineBarChart(data) {
  const machineQty = {};
  data.forEach(r => {
    if (!r.machine) return;
    machineQty[r.machine] = (machineQty[r.machine] || 0) + (parseInt(r.qty) || 0);
  });

  const sorted = Object.entries(machineQty).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);
  const colors = gradColors(labels.length);

  destroyChart('machineBar');
  const ctx = document.getElementById('machineBarChart');
  if (!ctx) return;

  App.charts.machineBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Qty',
        data: values,
        backgroundColor: colors.map(c => c + '44'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` Qty: ${fmtNum(c.raw)}` } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
      },
    },
  });
}

function renderMachineBreakdownChart(data) {
  // Frekuensi = jumlah transaksi per mesin (indikator kerusakan)
  const machineTrx = {};
  data.forEach(r => {
    if (!r.machine) return;
    machineTrx[r.machine] = (machineTrx[r.machine] || 0) + 1;
  });

  const sorted = Object.entries(machineTrx).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);
  const max    = Math.max(...values);
  const colors = values.map(v =>
    v >= max * 0.7 ? '#ef4444' : v >= max * 0.4 ? '#f59e0b' : '#00e5a0'
  );

  destroyChart('machineBreakdown');
  const ctx = document.getElementById('machineBreakdownChart');
  if (!ctx) return;

  App.charts.machineBreakdown = new Chart(ctx, {
    type: 'polarArea',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + '44'),
        borderColor: colors,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} transaksi` } },
      },
      scales: {
        r: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { display: false } },
      },
    },
  });
}

function renderMachineRankingTable(data) {
  const tbody = document.getElementById('machineRankingBody');
  if (!tbody) return;

  const machineData = {};
  data.forEach(r => {
    if (!r.machine) return;
    if (!machineData[r.machine]) machineData[r.machine] = { trx: 0, qty: 0, items: new Set() };
    machineData[r.machine].trx++;
    machineData[r.machine].qty  += parseInt(r.qty) || 0;
    machineData[r.machine].items.add(r.item_code);
  });

  const sorted = Object.entries(machineData).sort((a, b) => b[1].trx - a[1].trx);
  const maxTrx = sorted[0]?.[1].trx || 1;

  tbody.innerHTML = sorted.map(([machine, info], i) => {
    const rank  = i + 1;
    const pct   = (info.trx / maxTrx) * 100;
    const level = pct >= 70 ? 'high' : pct >= 40 ? 'medium' : 'low';
    const status = pct >= 70
      ? '<span class="status-badge pending"><i class="bi bi-exclamation-triangle-fill"></i> Perlu Perhatian</span>'
      : '<span class="status-badge completed"><i class="bi bi-check-circle-fill"></i> Normal</span>';
    const rankCls = rank <= 3 ? `rank-${rank}` : '';

    return `
      <tr class="${info.date === todayStr() ? 'row-latest' : ''}">
        <td class="${rankCls}">${rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <i class="bi bi-cpu-fill" style="color:var(--clr-blue)"></i>
            <strong>${machine}</strong>
          </div>
        </td>
        <td><span style="font-family:'JetBrains Mono',monospace;color:var(--clr-cyan)">${info.trx}</span></td>
        <td><span style="font-family:'JetBrains Mono',monospace">${fmtNum(info.qty)}</span></td>
        <td><span style="color:var(--clr-purple)">${info.items.size}</span></td>
        <td>
          <div class="damage-indicator">
            <div class="damage-bar">
              <div class="damage-fill ${level}" style="width:${pct}%"></div>
            </div>
            <span style="font-size:11px;color:var(--clr-text3)">${Math.round(pct)}%</span>
          </div>
        </td>
        <td>${status}</td>
      </tr>
    `;
  }).join('');
}

function renderMachineTrendChart(data) {
  const dates   = lastNDates(7);
  const machines = [...new Set(data.map(r => r.machine).filter(Boolean))].slice(0, 5);
  const labels  = dates.map(d => { const p = d.split('/'); return `${p[0]}/${p[1]}`; });
  const colors  = gradColors(machines.length);

  const datasets = machines.map((m, i) => ({
    label: m,
    data: dates.map(date =>
      data.filter(r => r.machine === m && r.date === date)
          .reduce((s, r) => s + (parseInt(r.qty) || 0), 0)
    ),
    borderColor: colors[i],
    backgroundColor: 'transparent',
    borderWidth: 2,
    tension: 0.4,
    pointRadius: 4,
  }));

  destroyChart('machineTrend');
  const ctx = document.getElementById('machineTrendChart');
  if (!ctx) return;

  App.charts.machineTrend = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
      },
    },
  });
}

// ===================== CHARTS — ANALYTIC PAGE =====================

function renderAnalyticPage(data) {
  renderTop10Chart(data);
  renderRequesterChart(data);
  renderCostAllocChart(data);
  renderItemTrendChart(data);
  renderMachineBreakdownAnalytic(data);
  renderSparepartPerMachine(data);
}

/** Top 10 items by frequency (transaction count) */
function renderTop10Chart(data) {
  const itemCounts = {};
  data.forEach(r => {
    const key = r.item_code || r.item_name;
    if (key) {
      if (!itemCounts[key]) itemCounts[key] = { name: r.item_name || key, count: 0, qty: 0 };
      itemCounts[key].count++;
      itemCounts[key].qty += parseInt(r.qty) || 0;
    }
  });

  const top10 = Object.values(itemCounts)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const labels = top10.map(i => i.name.length > 20 ? i.name.substring(0, 18) + '…' : i.name);
  const values = top10.map(i => i.qty);
  const colors = gradColors(10);

  destroyChart('top10');
  const ctx = document.getElementById('top10Chart');
  if (!ctx) return;

  App.charts.top10 = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Qty Keluar',
        data: values,
        backgroundColor: colors.map(c => c + '44'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` Qty: ${fmtNum(c.raw)}` } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
        y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

function renderRequesterChart(data) {
  const reqMap = {};
  data.forEach(r => {
    if (r.requester) {
      reqMap[r.requester] = (reqMap[r.requester] || 0) + 1;
    }
  });

  const sorted = Object.entries(reqMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const labels = sorted.map(e => e[0].split(' ')[0]);
  const values = sorted.map(e => e[1]);
  const colors = gradColors(labels.length);

  destroyChart('requester');
  const ctx = document.getElementById('requesterChart');
  if (!ctx) return;

  App.charts.requester = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(e => e[0]),
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + '44'),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} transaksi` } },
      },
    },
  });
}

function renderCostAllocChart(data) {
  const costMap = {};
  data.forEach(r => {
    if (r.cost_allocation) {
      costMap[r.cost_allocation] = (costMap[r.cost_allocation] || 0) + 1;
    }
  });

  const sorted = Object.entries(costMap).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);
  const colors = ['#1e90ff','#00e5a0','#a855f7','#f59e0b','#ef4444'];

  destroyChart('costAlloc');
  const ctx = document.getElementById('costAllocChart');
  if (!ctx) return;

  App.charts.costAlloc = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + '55'),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} transaksi` } },
      },
    },
  });
}

function renderItemTrendChart(data) {
  // Top 5 items by qty, trend over 7 days
  const itemQty = {};
  data.forEach(r => {
    if (r.item_name) itemQty[r.item_name] = (itemQty[r.item_name] || 0) + (parseInt(r.qty) || 0);
  });

  const top5 = Object.entries(itemQty).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
  const dates = lastNDates(7);
  const labels = dates.map(d => { const p = d.split('/'); return `${p[0]}/${p[1]}`; });
  const colors = gradColors(5);

  const datasets = top5.map((item, i) => ({
    label: item.length > 18 ? item.substring(0, 16) + '…' : item,
    data: dates.map(date =>
      data.filter(r => r.item_name === item && r.date === date)
          .reduce((s, r) => s + (parseInt(r.qty) || 0), 0)
    ),
    borderColor: colors[i],
    backgroundColor: colors[i] + '22',
    borderWidth: 2,
    tension: 0.4,
    fill: false,
    pointRadius: 3,
  }));

  destroyChart('itemTrend');
  const ctx = document.getElementById('itemTrendChart');
  if (!ctx) return;

  App.charts.itemTrend = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
      },
    },
  });
}

function renderMachineBreakdownAnalytic(data) {
  const machineTrx = {};
  data.forEach(r => {
    if (!r.machine) return;
    machineTrx[r.machine] = (machineTrx[r.machine] || 0) + 1;
  });

  const sorted = Object.entries(machineTrx).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const values = sorted.map(e => e[1]);
  const max    = Math.max(...values);
  const colors = values.map(v =>
    v >= max * 0.7 ? '#ef4444' : v >= max * 0.4 ? '#f59e0b' : '#00e5a0'
  );

  destroyChart('machineBreakdownAnalytic');
  const ctx = document.getElementById('machineBreakdownAnalytic');
  if (!ctx) return;

  App.charts.machineBreakdownAnalytic = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Frekuensi Pengambilan',
        data: values,
        backgroundColor: colors.map(c => c + '44'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => ` ${c.raw} transaksi`,
            afterLabel: c => {
              const pct = Math.round((c.raw / max) * 100);
              return `Indikasi kerusakan: ${pct >= 70 ? '⚠️ Tinggi' : pct >= 40 ? '⚡ Sedang' : '✅ Rendah'}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false },
          title: { display: true, text: 'Frekuensi Transaksi', font: { size: 11 } },
        },
      },
    },
  });
}

function renderSparepartPerMachine(data) {
  const container = document.getElementById('sparepartPerMachine');
  if (!container) return;

  const machineItems = {};
  data.forEach(r => {
    if (!r.machine || !r.item_name) return;
    if (!machineItems[r.machine]) machineItems[r.machine] = {};
    machineItems[r.machine][r.item_name] = (machineItems[r.machine][r.item_name] || 0) + 1;
  });

  container.innerHTML = Object.entries(machineItems)
    .sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length)
    .map(([machine, items]) => {
      const topItems = Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return `
        <div class="sparepart-machine-item">
          <div class="spm-header">
            <div class="spm-machine">
              <i class="bi bi-cpu-fill"></i> ${machine}
              <span style="font-size:10px; color:var(--clr-text3); font-weight:400; margin-left:4px">
                (${Object.keys(items).length} jenis item)
              </span>
            </div>
          </div>
          <div class="spm-items">
            ${topItems.map(([item, cnt]) => `
              <span class="spm-tag">
                ${item.length > 22 ? item.substring(0,20)+'…' : item}
                <span class="spm-tag-count">${cnt}×</span>
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
}

// ===================== TRANSACTION TABLE =====================

/** Render transaction monitoring page */
function renderTransactionPage() {
  const data      = App.data.outgoing;
  const search    = (document.getElementById('trxSearch')?.value || '').toLowerCase();
  const machine   = document.getElementById('trxFilterMachine')?.value   || '';
  const requester = document.getElementById('trxFilterRequester')?.value || '';

  // Populate filter dropdowns (once)
  populateFilterDropdowns(data);

  // Filter rows
  let rows = data.filter(r => {
    if (machine   && r.machine !== machine)     return false;
    if (requester && r.requester !== requester) return false;
    if (search) {
      const haystack = [r.item_code, r.item_name, r.requester, r.machine, r.cost_allocation, r.date]
        .join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // Sort
  const col = App.ui.trxSortCol;
  const dir = App.ui.trxSortDir;
  rows.sort((a, b) => {
    let va = a[col] || '', vb = b[col] || '';
    if (col === 'qty') { va = parseInt(va) || 0; vb = parseInt(vb) || 0; }
    else if (col === 'date') { va = parseDate(va) || 0; vb = parseDate(vb) || 0; }
    if (va < vb) return dir === 'asc' ? -1 :  1;
    if (va > vb) return dir === 'asc' ?  1 : -1;
    return 0;
  });

  const total    = rows.length;
  const pageSize = App.ui.trxPageSize;
  const pages    = Math.ceil(total / pageSize) || 1;
  let   page     = Math.min(App.ui.currentTrxPage, pages);
  App.ui.currentTrxPage = page;

  const startIdx = (page - 1) * pageSize;
  const pageRows = rows.slice(startIdx, startIdx + pageSize);

  // Update row count
  const countEl = document.getElementById('trxRowCount');
  if (countEl) countEl.textContent = `${fmtNum(total)} data`;

  // Render table body
  const today = todayStr();
  const tbody = document.getElementById('trxTableBody');
  if (!tbody) return;

  if (pageRows.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8" style="text-align:center; color:var(--clr-text3); padding:30px">
        <i class="bi bi-inbox" style="font-size:28px; display:block; margin-bottom:8px"></i>
        Tidak ada data ditemukan
      </td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map((row, i) => {
      const isToday  = row.date === today;
      const isLatest = i < 2 && page === 1;
      const status = isToday
        ? '<span class="status-badge today"><i class="bi bi-circle-fill" style="font-size:7px"></i> Today</span>'
        : '<span class="status-badge completed"><i class="bi bi-check-circle-fill" style="font-size:9px"></i> Done</span>';

      return `
        <tr class="${isLatest ? 'row-latest' : ''}">
          <td style="white-space:nowrap; color:var(--clr-text2); font-size:12px">${row.date || '-'}</td>
          <td><span class="item-code-badge">${row.item_code || '-'}</span></td>
          <td style="font-weight:500; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">
            ${row.item_name || '-'}
          </td>
          <td>
            <strong style="color:var(--clr-green); font-family:'JetBrains Mono',monospace">
              ${row.qty || 0}
            </strong>
          </td>
          <td style="font-size:12px">${row.requester || '-'}</td>
          <td><span class="machine-tag"><i class="bi bi-cpu"></i> ${row.machine || '-'}</span></td>
          <td><span class="cost-tag">${row.cost_allocation || '-'}</span></td>
          <td>${status}</td>
        </tr>
      `;
    }).join('');
  }

  renderPagination(total, page, pageSize, pages);
  App.trxFilteredData = rows; // Store for export
}

function populateFilterDropdowns(data) {
  const mEl = document.getElementById('trxFilterMachine');
  const rEl = document.getElementById('trxFilterRequester');

  if (mEl && mEl.options.length <= 1) {
    const machines = [...new Set(data.map(r => r.machine).filter(Boolean))].sort();
    machines.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      mEl.appendChild(opt);
    });
  }

  if (rEl && rEl.options.length <= 1) {
    const reqs = [...new Set(data.map(r => r.requester).filter(Boolean))].sort();
    reqs.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r; opt.textContent = r;
      rEl.appendChild(opt);
    });
  }
}

function renderPagination(total, page, pageSize, pages) {
  const info = document.getElementById('paginationInfo');
  const ctrl = document.getElementById('paginationControls');
  if (!info || !ctrl) return;

  const from = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const to   = Math.min(page * pageSize, total);
  info.textContent = `Menampilkan ${fmtNum(from)}-${fmtNum(to)} dari ${fmtNum(total)}`;

  const maxButtons = 7;
  let startPage = Math.max(1, page - 3);
  let endPage   = Math.min(pages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

  let html = `
    <button class="page-btn" onclick="goToPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>
      <i class="bi bi-chevron-left"></i>
    </button>
  `;

  if (startPage > 1) {
    html += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
    if (startPage > 2) html += `<button class="page-btn" disabled>…</button>`;
  }

  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="page-btn ${p === page ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
  }

  if (endPage < pages) {
    if (endPage < pages - 1) html += `<button class="page-btn" disabled>…</button>`;
    html += `<button class="page-btn" onclick="goToPage(${pages})">${pages}</button>`;
  }

  html += `
    <button class="page-btn" onclick="goToPage(${page + 1})" ${page >= pages ? 'disabled' : ''}>
      <i class="bi bi-chevron-right"></i>
    </button>
  `;

  ctrl.innerHTML = html;
}

window.goToPage = function(p) {
  App.ui.currentTrxPage = p;
  renderTransactionPage();
};

// ===================== EXPORT EXCEL (CSV) =====================

function exportToExcel() {
  const rows = App.trxFilteredData || App.data.outgoing;
  if (!rows || rows.length === 0) return;

  const headers = ['date','item_code','item_name','qty','requester','machine','cost_allocation','stock'];
  const csvRows = [headers.join(',')];

  rows.forEach(r => {
    csvRows.push(headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
  });

  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `inventory_outgoing_${todayStr().replace(/\//g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===================== SORTING =====================

function initSortableTable() {
  document.querySelectorAll('.sortable-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (App.ui.trxSortCol === col) {
        App.ui.trxSortDir = App.ui.trxSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        App.ui.trxSortCol = col;
        App.ui.trxSortDir = 'asc';
      }

      // Update header classes
      document.querySelectorAll('.sortable-table th.sortable').forEach(t => {
        t.classList.remove('sort-asc','sort-desc');
      });
      th.classList.add(App.ui.trxSortDir === 'asc' ? 'sort-asc' : 'sort-desc');

      App.ui.currentTrxPage = 1;
      renderTransactionPage();
    });
  });
}

// ===================== PAGE NAVIGATION =====================

function navigateTo(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));

  // Show target page
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.remove('hidden');

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  // Update breadcrumb
  const titles = {
    dashboard:   'Dashboard Overview',
    machine:     'Machine Distribution',
    analytic:    'Analytic',
    transaction: 'Transaction Monitoring',
    setting:     'Setting',
  };
  const icons = {
    dashboard:   'bi-speedometer2',
    machine:     'bi-gear-wide-connected',
    analytic:    'bi-bar-chart-line-fill',
    transaction: 'bi-table',
    setting:     'bi-sliders2',
  };

  const titleEl = document.getElementById('pageTitle');
  const iconEl  = document.querySelector('.breadcrumb-icon i');
  if (titleEl) titleEl.textContent = titles[page] || page;
  if (iconEl)  { iconEl.className = 'bi ' + (icons[page] || 'bi-grid'); }

  App.ui.currentPage = page;

  // Render page-specific content
  renderCurrentPage();

  // Close mobile sidebar
  document.getElementById('sidebar')?.classList.remove('mobile-open');
}

function renderCurrentPage() {
  const data = App.data.filtered;
  switch (App.ui.currentPage) {
    case 'dashboard':
      renderKPIs(data);
      renderTrendChart(data);
      renderMachineDonut(data);
      renderLowStock(data);
      renderRecentTransactions(data);
      break;
    case 'machine':
      renderMachinePage(data);
      break;
    case 'analytic':
      renderAnalyticPage(data);
      break;
    case 'transaction':
      renderTransactionPage();
      break;
  }
}

// ===================== SIDEBAR TOGGLE =====================

function initSidebar() {
  const sidebar     = document.getElementById('sidebar');
  const mainArea    = document.getElementById('mainArea');
  const toggleBtn   = document.getElementById('sidebarToggle');
  const mobileBtn   = document.getElementById('mobileMenuBtn');

  toggleBtn?.addEventListener('click', () => {
    App.ui.sidebarCollapsed = !App.ui.sidebarCollapsed;
    sidebar.classList.toggle('collapsed', App.ui.sidebarCollapsed);
    mainArea.classList.toggle('sidebar-collapsed', App.ui.sidebarCollapsed);
    // Redraw charts after sidebar animation
    setTimeout(() => {
      Object.values(App.charts).forEach(c => c.resize?.());
    }, 380);
  });

  mobileBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('mobile-open');
  });

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
      if (!sidebar.contains(e.target) && !mobileBtn?.contains(e.target)) {
        sidebar.classList.remove('mobile-open');
      }
    }
  });
}

// ===================== NAV ITEMS =====================

function initNavItems() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (page) navigateTo(page);
    });
  });

  // View all link in recent transactions
  document.querySelectorAll('.view-all-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.page || 'transaction');
    });
  });
}

// ===================== FILTER CONTROLS =====================

function initFilterControls() {
  // Quick filter buttons
  document.querySelectorAll('.qbtn').forEach(btn => {
    btn.addEventListener('click', () => setQuickRange(btn.dataset.range));
  });

  // Apply filter button
  document.getElementById('applyFilter')?.addEventListener('click', () => {
    const fromVal = document.getElementById('filterDateFrom')?.value;
    const toVal   = document.getElementById('filterDateTo')?.value;
    App.ui.filterFrom = fromVal ? new Date(fromVal) : null;
    App.ui.filterTo   = toVal   ? new Date(toVal)   : null;
    applyDateFilter();
  });

  // Reset filter
  document.getElementById('resetFilter')?.addEventListener('click', () => {
    App.ui.filterFrom = null;
    App.ui.filterTo   = null;
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value   = '';
    App.data.filtered = [...App.data.outgoing];
    document.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
    document.querySelector('.qbtn[data-range="all"]')?.classList.add('active');
    renderCurrentPage();
  });
}

// ===================== TRANSACTION SEARCH/FILTER =====================

function initTransactionControls() {
  document.getElementById('trxSearch')?.addEventListener('input', () => {
    App.ui.currentTrxPage = 1;
    renderTransactionPage();
  });

  document.getElementById('trxFilterMachine')?.addEventListener('change', () => {
    App.ui.currentTrxPage = 1;
    renderTransactionPage();
  });

  document.getElementById('trxFilterRequester')?.addEventListener('change', () => {
    App.ui.currentTrxPage = 1;
    renderTransactionPage();
  });

  document.getElementById('pageSize')?.addEventListener('change', (e) => {
    App.ui.trxPageSize    = parseInt(e.target.value);
    App.ui.currentTrxPage = 1;
    renderTransactionPage();
  });

  document.getElementById('exportExcel')?.addEventListener('click', exportToExcel);
}

// ===================== DARK MODE =====================

function initDarkMode() {
  const btn       = document.getElementById('darkmodeBtn');
  const icon      = document.getElementById('darkmodeIcon');
  const settingCb = document.getElementById('darkModeToggleSetting');

  function apply(dark) {
    document.body.classList.toggle('light-mode', !dark);
    App.settings.darkMode = dark;
    if (icon) icon.className = dark ? 'bi bi-moon-stars-fill' : 'bi bi-sun-fill';
    if (settingCb) settingCb.checked = dark;
  }

  btn?.addEventListener('click', () => apply(!App.settings.darkMode));
  settingCb?.addEventListener('change', (e) => apply(e.target.checked));

  apply(true); // Start in dark mode
}

// ===================== SETTINGS PAGE =====================

function initSettings() {
  // Auto refresh toggle
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  const refreshIntervalEl = document.getElementById('refreshInterval');

  autoRefreshToggle?.addEventListener('change', (e) => {
    App.settings.autoRefresh = e.target.checked;
    if (e.target.checked) {
      startAutoRefresh();
    } else {
      clearInterval(App.intervals.refresh);
    }
  });

  refreshIntervalEl?.addEventListener('change', (e) => {
    App.settings.refreshInterval = parseInt(e.target.value);
    if (App.settings.autoRefresh) {
      clearInterval(App.intervals.refresh);
      startAutoRefresh();
    }
  });

  // Low stock threshold
  document.getElementById('saveLowStock')?.addEventListener('click', () => {
    const val = parseInt(document.getElementById('lowStockThreshold')?.value || '10');
    App.settings.lowStockThreshold = Math.max(1, val);
    renderLowStock(App.data.filtered);
    // Visual feedback
    const btn = document.getElementById('saveLowStock');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Tersimpan!';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.style.background = '';
    }, 2000);
  });

  // Sync dark mode toggle in settings
  const darkSettingToggle = document.getElementById('darkModeToggleSetting');
  darkSettingToggle?.addEventListener('change', (e) => {
    document.getElementById('darkmodeBtn')?.click();
  });
}

// ===================== AUTO REFRESH =====================

function startAutoRefresh() {
  clearInterval(App.intervals.refresh);
  if (!App.settings.autoRefresh) return;

  App.intervals.refresh = setInterval(async () => {
    const icon = document.getElementById('refreshIcon');
    if (icon) icon.classList.add('spinning');

    await loadAllData();
    applyDateFilter();

    setTimeout(() => {
      if (icon) icon.classList.remove('spinning');
    }, 1000);
  }, App.settings.refreshInterval);
}

// ===================== MAIN INIT =====================

async function init() {
  // 1. Start loading animation
  runLoadingSequence();

  // 2. Start realtime clock immediately
  startClock();

  // 3. Init UI components
  initSidebar();
  initNavItems();
  initDarkMode();
  initFilterControls();
  initTransactionControls();
  initSortableTable();
  initSettings();

  // 4. Load CSV data
  await loadAllData();

  // 5. Initial render after loading completes
  setTimeout(() => {
    App.data.filtered = [...App.data.outgoing];
    navigateTo('dashboard');
    startAutoRefresh();
  }, 2400); // Sync with loading animation
}

// ===================== BOOT =====================
document.addEventListener('DOMContentLoaded', init);
