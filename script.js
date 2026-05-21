/* ============================================================
   BINTANG TOEDJOE - KCH INVENTORY MONITORING DASHBOARD
   CLEAN VERSION — Main Script
   Vanilla JS + Chart.js + PapaParse
============================================================ */

'use strict';

/* ============================================================
   GLOBAL APP STATE
============================================================ */

const App = {
  data: {
    outgoing: [],
    expense: [],
    filtered: [],
  },

  settings: {
    lowStockThreshold: 10,
    autoRefresh: true,
    refreshInterval: 60000,
    darkMode: true,
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

  charts: {},
  intervals: {},
};

/* ============================================================
   CSV PATH
============================================================ */

const CSV = {
  outgoing: 'data/outgoing.csv',
  expense: 'data/outgoingexpense.csv',
};

/* ============================================================
   CHART GLOBAL CONFIG
============================================================ */

Chart.defaults.color = '#94a3b8';

Chart.defaults.font.family =
  'Inter, sans-serif';

Chart.defaults.plugins.tooltip.backgroundColor =
  'rgba(10,15,30,0.92)';

Chart.defaults.plugins.tooltip.borderColor =
  'rgba(30,144,255,0.3)';

Chart.defaults.plugins.tooltip.borderWidth = 1;

Chart.defaults.plugins.tooltip.padding = 10;

Chart.defaults.plugins.tooltip.cornerRadius = 8;

/* ============================================================
   UTILITIES
============================================================ */

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  document.querySelectorAll(selector);

function fmtNum(value = 0) {

  return Number(value)
    .toLocaleString('id-ID');
}

function fmtCurrency(value = 0) {

  return 'Rp ' +
    Number(value)
      .toLocaleString('id-ID');
}

function fmtDate(date) {

  const dd =
    String(date.getDate())
      .padStart(2, '0');

  const mm =
    String(date.getMonth() + 1)
      .padStart(2, '0');

  const yy =
    date.getFullYear();

  return `${dd}/${mm}/${yy}`;
}

function todayStr() {

  return fmtDate(new Date());
}

function parseDate(str) {

  if (!str) return null;

  if (str.includes('/')) {

    const parts = str.split('/');

    if (parts.length !== 3)
      return null;

    return new Date(
      `${parts[2]}-${parts[1]}-${parts[0]}`
    );
  }

  return new Date(str);
}

function lastNDates(n) {

  const dates = [];

  for (let i = n - 1; i >= 0; i--) {

    const d = new Date();

    d.setDate(
      d.getDate() - i
    );

    dates.push(fmtDate(d));
  }

  return dates;
}

function gradColors(n) {

  const palette = [
    '#1e90ff',
    '#00e5a0',
    '#00d4ff',
    '#a855f7',
    '#f59e0b',
    '#ef4444',
    '#06b6d4',
    '#10b981',
    '#f97316',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#eab308',
    '#6366f1',
    '#84cc16',
  ];

  return Array.from(
    { length: n },
    (_, i) =>
      palette[i % palette.length]
  );
}

function destroyChart(key) {

  if (App.charts[key]) {

    App.charts[key].destroy();

    delete App.charts[key];
  }
}

/* ============================================================
   LOADING SCREEN
============================================================ */

function runLoadingSequence() {

  const bar =
    $('#loadingBar');

  const status =
    $('#loadingStatus');

  const screen =
    $('#loadingScreen');

  const app =
    $('#appWrapper');

  const steps = [
    [15, 'Initializing modules...'],
    [35, 'Loading CSV data...'],
    [60, 'Parsing inventory data...'],
    [80, 'Building charts...'],
    [95, 'Rendering dashboard...'],
    [100, 'System ready!'],
  ];

  let idx = 0;

  const tick =
    setInterval(() => {

      if (idx >= steps.length) {

        clearInterval(tick);

        setTimeout(() => {

          screen.classList.add(
            'fade-out'
          );

          app.style.display = 'flex';

          setTimeout(() => {

            screen.style.display =
              'none';

          }, 800);

        }, 300);

        return;
      }

      const [pct, msg] =
        steps[idx++];

      bar.style.width =
        pct + '%';

      status.textContent =
        msg;

    }, 380);
}

/* ============================================================
   REALTIME CLOCK
============================================================ */

function startClock() {

  const days = [
    'Minggu',
    'Senin',
    'Selasa',
    'Rabu',
    'Kamis',
    'Jumat',
    'Sabtu',
  ];

  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];

  function updateClock() {

    const now = new Date();

    const hh =
      String(now.getHours())
        .padStart(2, '0');

    const mm =
      String(now.getMinutes())
        .padStart(2, '0');

    const ss =
      String(now.getSeconds())
        .padStart(2, '0');

    $('#clockTime').textContent =
      `${hh}:${mm}:${ss}`;

    $('#clockDate').textContent =
      `${days[now.getDay()]}, ` +
      `${now.getDate()} ` +
      `${months[now.getMonth()]} ` +
      `${now.getFullYear()}`;
  }

  updateClock();

  App.intervals.clock =
    setInterval(updateClock, 1000);
}

/* ============================================================
   CSV LOADER
============================================================ */

async function loadAllData() {

  try {

    const [outgoing, expense] =
      await Promise.all([
        loadCSV(CSV.outgoing),
        loadCSV(CSV.expense),
      ]);

    App.data.outgoing =
      outgoing;

    App.data.expense =
      expense;

    App.data.filtered =
      [...outgoing];

    setDsStatus(
      'dsOutgoingStatus',
      outgoing.length > 0
    );

    setDsStatus(
      'dsExpenseStatus',
      expense.length > 0
    );

    console.log(
      'OUTGOING ROWS:',
      outgoing.length
    );

    console.log(
      'EXPENSE ROWS:',
      expense.length
    );

    return true;

  } catch (err) {

    console.error(
      'LOAD ERROR:',
      err
    );

    return false;
  }
}

function loadCSV(path) {

  return new Promise((resolve) => {

    Papa.parse(path, {

      download: true,

      header: true,

      skipEmptyLines: true,

      trimHeaders: true,

      dynamicTyping: false,

      complete: (results) => {

        console.log(
          'RAW CSV:',
          path,
          results.data.length
        );

        const cleaned =
          (results.data || []).map(row => ({

            /* =========================
               MAIN FIELD MAPPING
            ========================= */

            date:
              String(
                row["Tanggal Pengambilan"] ||
                row["Tanggal_Pengambilan"] ||
                ''
              ).trim(),

            lokasi:
              String(
                row["Lokasi"] || ''
              ).trim(),

            kodeItem:
              String(
                row["Kode Item"] ||
                row["Kode_Item"] ||
                ''
              ).trim(),

            description:
              String(
                row["Deskripsi"] || ''
              ).trim(),

            machine:
              String(
                row["Mesin (Area)"] ||
                row["Mesin_(Area)"] ||
                ''
              ).trim(),

            qty:
              Number(
                String(
                  row["Qty"] || '0'
                )
                .replace(/,/g, '')
                .trim()
              ) || 0,

            uom:
              String(
                row["UOM"] || ''
              ).trim(),

            requester:
              String(
                row["Pemohon"] || ''
              ).trim(),

            status:
              String(
                row["Status"] || ''
              ).trim(),

            wr:
              String(
                row["WR"] || ''
              ).trim(),

            wo:
              String(
                row["WO"] || ''
              ).trim(),

            actualStock:
              String(
                row["QTY Actual Stock"] ||
                row["QTY_Actual_Stock"] ||
                ''
              ).trim(),

            noForm:
              String(
                row["No Form"] ||
                row["No_Form"] ||
                ''
              ).trim(),

            costAllocation:
              String(
                row["Cost Alocation"] ||
                row["Cost_Alocation"] ||
                ''
              ).trim(),

            giver:
              String(
                row["Yang Menyerahkan"] ||
                row["Yang_Menyerahkan"] ||
                ''
              ).trim(),

          }));

        console.log(
          'CLEANED CSV:',
          path,
          cleaned.length
        );

        resolve(cleaned);
      },

      error: (err) => {

        console.error(
          'CSV ERROR:',
          path,
          err
        );

        resolve([]);
      },
    });

  });
}

function setDsStatus(id, ok) {

  const el =
    document.getElementById(id);

  if (!el) return;

  el.textContent =
    ok ? 'Loaded' : 'Error';

  el.style.background = ok
    ? 'rgba(0,229,160,0.12)'
    : 'rgba(239,68,68,0.12)';

  el.style.color = ok
    ? 'var(--clr-green)'
    : 'var(--clr-red)';
}

/* ============================================================
   FILTER
============================================================ */

function applyDateFilter() {

  const from =
    App.ui.filterFrom;

  const to =
    App.ui.filterTo;

  App.data.filtered =
    App.data.outgoing.filter((row) => {

      if (!row.date)
        return true;

      const d =
        parseDate(row.date);

      if (!d)
        return true;

      if (from && d < from)
        return false;

      if (to && d > to)
        return false;

      return true;
    });

  renderCurrentPage();
}

function syncFilterInput() {

  const from =
    $('#filterDateFrom');

  const to =
    $('#filterDateTo');

  from.value =
    App.ui.filterFrom
      ? App.ui.filterFrom
          .toISOString()
          .split('T')[0]
      : '';

  to.value =
    App.ui.filterTo
      ? App.ui.filterTo
          .toISOString()
          .split('T')[0]
      : '';
}

/* ============================================================
   KPI
============================================================ */

function computeKPIs(data) {

  const today =
    todayStr();

  const todayRows =
    data.filter(
      (r) => r.date === today
    );

  const machines =
    [...new Set(
      data.map(
        (r) => r.machine
      ).filter(Boolean)
    )];

  const requesters =
    [...new Set(
      data.map(
        (r) => r.requester
      ).filter(Boolean)
    )];

  return {

    totalData:
      data.length,

    totalQty:
      data.reduce(
        (sum, r) =>
          sum +
          (parseInt(r.qty) || 0),
        0
      ),

    todayQty:
      todayRows.reduce(
        (sum, r) =>
          sum +
          (parseInt(r.qty) || 0),
        0
      ),

    todayTrx:
      todayRows.length,

    activeMachines:
      machines.length,

    activeRequesters:
      requesters.length,
  };
}

function renderKPIs(data) {

  const kpi =
    computeKPIs(data);

  animateCounter(
    'kpiTotalData',
    kpi.totalData
  );

  animateCounter(
    'kpiTotalQty',
    kpi.totalQty
  );

  animateCounter(
    'kpiTodayQty',
    kpi.todayQty
  );

  animateCounter(
    'kpiTodayTrx',
    kpi.todayTrx
  );

  animateCounter(
    'kpiActiveMachine',
    kpi.activeMachines
  );

  animateCounter(
    'kpiActiveRequester',
    kpi.activeRequesters
  );

  $('#kpiTodayDate').textContent =
    todayStr();
}

function animateCounter(id, target) {

  const el =
    document.getElementById(id);

  if (!el) return;

  const start =
    parseInt(
      el.textContent.replace(/[^\d]/g, '')
    ) || 0;

  const duration = 800;

  const startTime =
    performance.now();

  function update(now) {

    const progress =
      Math.min(
        (now - startTime) /
        duration,
        1
      );

    const ease =
      1 - Math.pow(
        1 - progress,
        3
      );

    const value =
      Math.round(
        start +
        (target - start) * ease
      );

    el.textContent =
      fmtNum(value);

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

/* ============================================================
   MAIN INIT
============================================================ */

async function init() {

  runLoadingSequence();

  startClock();

  await loadAllData();

  setTimeout(() => {

    App.data.filtered =
      [...App.data.outgoing];

    renderKPIs(
      App.data.filtered
    );

  }, 2400);
}

/* ============================================================
   BOOT
============================================================ */

document.addEventListener(
  'DOMContentLoaded',
  init
);
