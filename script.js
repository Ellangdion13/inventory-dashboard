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


// ===================== AUTH SYSTEM =====================

const AUTH_KEY = 'btkch_auth_session';

const USERS = [
  { username: 'admin',    password: 'admin123',  role: 'admin', name: 'Admin Sparepart', dept: 'Maintenance' },
  { username: 'mra',      password: 'mra123',    role: 'user',  name: 'MRA',             dept: 'Produksi' },
  { username: 'sigit',    password: 'sigit123',  role: 'user',  name: 'SIGIT',           dept: 'Utility' },
  { username: 'twn',      password: 'twn123',    role: 'user',  name: 'TWN',             dept: 'Produksi' },
  { username: 'nasikin',  password: 'nasikin123',role: 'user',  name: 'NASIKIN',         dept: 'Produksi' },
  { username: 'ardifan',  password: 'ardifan123',role: 'user',  name: 'Ardifan',         dept: 'Produksi' },
];

const PERMISSIONS = {
  admin: { pages: ['dashboard','machine','analytic','transaction','setting'], canExport: true,  canSetting: true,  label: 'Admin Sparepart' },
  user:  { pages: ['dashboard','machine','analytic','transaction'],           canExport: false, canSetting: false, label: 'User' },
};

let currentUser = null;

function saveSession(user) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify({ username: user.username, role: user.role, name: user.name, dept: user.dept })); } catch(e) {}
}
function loadSession() {
  try { const s = localStorage.getItem(AUTH_KEY); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}
function clearSession() {
  try { localStorage.removeItem(AUTH_KEY); } catch(e) {}
}

function login(username, password) {
  const user = USERS.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
  if (!user) return false;
  currentUser = user;
  saveSession(user);
  return true;
}

function logout() {
  currentUser = null;
  clearSession();
  showLoginScreen();
}

function applyRoleUI() {
  if (!currentUser) return;
  const perm = PERMISSIONS[currentUser.role] || PERMISSIONS.user;
  const nameEl   = document.getElementById('topnavUserName');
  const roleEl   = document.getElementById('topnavUserRole');
  const avatarEl = document.getElementById('userAvatar');
  if (nameEl)   nameEl.textContent = currentUser.name;
  if (roleEl)   roleEl.textContent = perm.label + ' — ' + currentUser.dept;
  if (avatarEl) avatarEl.style.background = currentUser.role === 'admin'
    ? 'linear-gradient(135deg,#1e90ff,#00d4ff)'
    : 'linear-gradient(135deg,#a855f7,#6366f1)';
  const settingNav = document.getElementById('settingNavItem');
  if (settingNav) settingNav.style.display = perm.canSetting ? '' : 'none';
  const exportBtn = document.getElementById('exportExcel');
  if (exportBtn) exportBtn.style.display = perm.canExport ? '' : 'none';
}

function showLoginScreen() {
  const ls = document.getElementById('loginScreen');
  const aw = document.getElementById('appWrapper');
  const ld = document.getElementById('loadingScreen');
  if (ls) ls.style.display = 'flex';
  if (aw) aw.style.display = 'none';
  if (ld) ld.style.display = 'none';
}
function hideLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) ls.style.display = 'none';
}

function initLogin() {
  const loginBtn    = document.getElementById('loginBtn');
  const usernameEl  = document.getElementById('loginUsername');
  const passwordEl  = document.getElementById('loginPassword');
  const errorEl     = document.getElementById('loginError');
  const togglePwBtn = document.getElementById('togglePwBtn');
  const togglePwIcon= document.getElementById('togglePwIcon');

  // ── Build quick login buttons dari USERS (role=user saja) ──
  const quickGrid = document.getElementById('quickLoginGrid');
  if (quickGrid) {
    const userList = USERS.filter(u => u.role === 'user');
    quickGrid.innerHTML = userList.map(u => `
      <button class="quick-login-btn" data-username="${u.username}" data-password="${u.password}">
        <div class="qlb-avatar">${u.name.charAt(0).toUpperCase()}</div>
        <div class="qlb-info">
          <div class="qlb-name">${u.name}</div>
          <div class="qlb-dept">${u.dept}</div>
        </div>
        <i class="bi bi-arrow-right-circle-fill qlb-arrow"></i>
      </button>
    `).join('');

    // Attach click handlers untuk quick login
    quickGrid.querySelectorAll('.quick-login-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = btn.dataset.username;
        const p = btn.dataset.password;

        // Animasi: loading state
        btn.classList.add('loading');
        btn.querySelector('.qlb-arrow').className = 'bi bi-arrow-repeat qlb-arrow spinning';

        setTimeout(() => {
          if (login(u, p)) {
            hideLoginScreen();
            startApp();
          }
        }, 400);
      });
    });
  }

  // ── Toggle password visibility ──
  togglePwBtn?.addEventListener('click', () => {
    const isText = passwordEl.type === 'text';
    passwordEl.type = isText ? 'password' : 'text';
    if (togglePwIcon) togglePwIcon.className = isText ? 'bi bi-eye-fill' : 'bi bi-eye-slash-fill';
  });

  // ── Admin login form ──
  function doLogin() {
    const u = (usernameEl?.value || '').trim();
    const p = passwordEl?.value || '';
    if (!u || !p) {
      if (errorEl) errorEl.textContent = 'Username dan password wajib diisi.';
      return;
    }
    if (login(u, p)) {
      if (errorEl) errorEl.textContent = '';
      hideLoginScreen();
      startApp();
    } else {
      if (errorEl) errorEl.textContent = 'Username atau password salah.';
      if (passwordEl) { passwordEl.value = ''; passwordEl.focus(); }
      // Shake animation
      const card = document.querySelector('.login-panel-right');
      card?.classList.add('shake');
      setTimeout(() => card?.classList.remove('shake'), 500);
    }
  }

  loginBtn?.addEventListener('click', doLogin);
  passwordEl?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  usernameEl?.addEventListener('keydown', e => { if (e.key === 'Enter') passwordEl?.focus(); });
  document.getElementById('logoutBtn')?.addEventListener('click', () => { if (confirm('Yakin ingin logout?')) logout(); });
}

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

/** Parse tanggal dari berbagai format → Date object
 *  Support: dd/mm/yyyy, M/D/YYYY (Excel US), yyyy-mm-dd, dd-mm-yyyy */
function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  str = str.trim();
  if (!str) return null;

  const slashParts = str.split('/');
  if (slashParts.length === 3) {
    const [a, b, c] = slashParts.map(s => parseInt(s, 10));
    let y = c < 100 ? c + 2000 : c;

    // Deteksi otomatis: kalau part pertama > 12, pasti dd/mm/yyyy
    // Kalau part kedua > 12, pasti M/D/YYYY (bulan/hari/tahun = format Excel)
    if (a > 12) {
      // dd/mm/yyyy
      const dt = new Date(y, b - 1, a);
      if (!isNaN(dt.getTime())) return dt;
    } else if (b > 12) {
      // M/D/YYYY — format Excel/US
      const dt = new Date(y, a - 1, b);
      if (!isNaN(dt.getTime())) return dt;
    } else {
      // Ambigu (misal 5/6/2026) — asumsikan M/D/YYYY karena CSV dari Excel Indonesia
      // seringnya export ke M/D/YYYY
      const dtUS = new Date(y, a - 1, b); // M/D/YYYY
      if (!isNaN(dtUS.getTime())) return dtUS;
    }
  }

  // Format: yyyy-mm-dd (ISO)
  const dashParts = str.split('-');
  if (dashParts.length === 3) {
    const first = parseInt(dashParts[0], 10);
    if (first > 100) {
      const dt = new Date(str);
      if (!isNaN(dt.getTime())) return dt;
    } else {
      const [d, m, y] = dashParts.map(s => parseInt(s, 10));
      const dt = new Date(y, m - 1, d);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  // Fallback native
  const dt = new Date(str);
  return isNaN(dt.getTime()) ? null : dt;
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
/** Animate loading bar — returns Promise that resolves when animation reaches 95%,
 *  then exposes finishLoading() to complete the final step after data is ready. */
function runLoadingSequence() {
  const bar    = document.getElementById('loadingBar');
  const status = document.getElementById('loadingStatus');

  // Animate to 95% automatically, then stop and wait
  const steps = [
    { pct: 15,  msg: 'Initializing modules...' },
    { pct: 35,  msg: 'Loading CSV data sources...' },
    { pct: 60,  msg: 'Parsing inventory data...' },
    { pct: 80,  msg: 'Building charts...' },
    { pct: 95,  msg: 'Rendering dashboard...' },
  ];

  return new Promise((resolve) => {
    let idx = 0;
    const tick = setInterval(() => {
      if (idx >= steps.length) {
        clearInterval(tick);
        resolve(); // ← signal: animation at 95%, data loading can proceed
        return;
      }
      const s = steps[idx++];
      if (bar)    bar.style.width    = s.pct + '%';
      if (status) status.textContent = s.msg;
    }, 380);
  });
}

/** Call this after data is loaded to finish the loading screen */
function finishLoading() {
  const bar    = document.getElementById('loadingBar');
  const status = document.getElementById('loadingStatus');
  const screen = document.getElementById('loadingScreen');
  const app    = document.getElementById('appWrapper');

  if (bar)    bar.style.width    = '100%';
  if (status) status.textContent = 'System ready!';

  setTimeout(() => {
    if (screen) screen.classList.add('fade-out');
    if (app)    app.style.display = 'flex';
    setTimeout(() => { if (screen) screen.style.display = 'none'; }, 800);
  }, 300);
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
    // filtered set setelah init via getAllData()

    // Mark data source status
    setDsStatus('dsOutgoingStatus', outgoing.length > 0);
    setDsStatus('dsExpenseStatus',  expense.length  > 0);

    return true;
  } catch (err) {
    console.error('Data load error:', err);
    return false;
  }
}

// ===================== FIX: loadCSV — struktur Promise & callback diperbaiki =====================
/** Load a single CSV file using PapaParse */
function loadCSV(path) {
  return new Promise((resolve) => {

    Papa.parse(path, {
      download: true,
      header: true,
      skipEmptyLines: true,
      delimiter: ",",

      complete: (results) => {
        console.log("FIELDS:", results.meta.fields);
        console.log("RAW:", results.data);

        // Bersihkan BOM di header key
        const cleanedData = results.data.map(row => {
          const cleanRow = {};
          Object.keys(row).forEach(key => {
            const cleanKey = key
              .replace(/^\uFEFF/, '')
              .replace(/[\r\n]+/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            cleanRow[cleanKey] = (row[key] || '').toString().trim();
          });
          return cleanRow;
        });

        console.log("CLEANED:", cleanedData);

        // Cari kolom Actual Stock secara dinamis
        const sampleRow = cleanedData[0] || {};
        const stockKey = Object.keys(sampleRow).find(k =>
          k.toLowerCase().includes('actual stock') ||
          (k.toLowerCase().includes('actual') && k.toLowerCase().includes('qty'))
        ) || '';
        console.log("All header keys:", Object.keys(sampleRow));
        console.log("Stock key found:", JSON.stringify(stockKey));

        // Helper: cari nilai dari row dengan beberapa kemungkinan nama key
        const getField = (row, ...keys) => {
          for (const k of keys) {
            const val = row[k];
            if (val !== undefined && val !== null && val !== '') return val;
          }
          return '';
        };

        const rows = cleanedData.map(row => {
          // Normalisasi tanggal ke dd/mm/yyyy apapun format aslinya
          const rawDate = getField(row,
            'Tanggal Pengambilan', 'Tanggal', 'Date', 'TGL', 'tgl'
          );
          const parsedDt = parseDate(rawDate);
          const normalDate = parsedDt ? fmtDate(parsedDt) : rawDate;

          // Qty — bisa kosong di CSV, default 1 kalau ada transaksi
          const rawQty = getField(row, 'Qty', 'QTY', 'qty', 'Quantity');
          const qty = rawQty !== '' ? (parseInt(rawQty) || 0) : 0;

          // Cost Allocation — ada typo "Cost Alocation" di CSV asli
          const costAlloc = getField(row,
            'Cost Allocation', 'Cost Alocation', 'Cost Alloc',
            'CostAllocation', 'cost_allocation', 'COST ALLOCATION'
          );

          return {
            date:            normalDate,
            item_code:       getField(row, 'Kode Item', 'Item Code', 'Kode'),
            item_name:       getField(row, 'Deskripsi', 'Description', 'Item Name', 'Nama Item'),
            machine:         getField(row, 'Mesin (Area)', 'Mesin', 'Machine', 'Area'),
            qty,
            requester:       getField(row, 'Pemohon', 'Requester', 'Pemohon/Requester'),
            stock:           parseInt(row[stockKey] || '0') || 0,
            cost_allocation: costAlloc,
          };
        });

        console.log("PARSED:", rows);
        resolve(rows);   // ← satu-satunya resolve, di akhir complete
      },

      error: (err) => {
        console.error("CSV ERROR:", err);
        resolve([]);
      },
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

/** Single source of truth — gabungan outgoing + expense */
function getAllData() {
  return [...App.data.outgoing, ...App.data.expense];
}

// ===================== DATE FILTER =====================

/** Apply date range filter to App.data.outgoing → App.data.filtered */
function applyDateFilter() {
  const from = App.ui.filterFrom;
  const to   = App.ui.filterTo;

  App.data.filtered = getAllData().filter(row => {
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


// ===================== MACHINE GROUP SYSTEM =====================

const MACHINE_GROUPS = {
  'ILAPAK':       ['ILAPAK','ILAPAK 1','ILAPAK 2','ILAPAK 3','ILAPAK 4','ILAPAK 5','ILAPAK 6','ILAPAK 7','ILAPAK 8','ILAPAK 9','ILAPAK 10','ILAPAK 11','ILAPAK 12'],
  'SIG':          ['SIG A','SIG B','SIG 5','SIG 6','SIG'],
  'UNIFIL':       ['UNIFIL','UNIFIL A','UNIFIL B'],
  'CHIMEI':       ['CHIMEI','CHIMEI 1','CHIMEI 3A','CHIMEI 4B','CHIMEI 5','CHIMEI 5B','CHIMEI 8A','CHIMEI 9A','CHIMEI 10','CHIMEI 11','CHIMEI 12'],
  'JINSUG':       ['JINSUG','JINSUG 1','JINSUG 2','JINSUG 3','JINSUG 4','JINSUG 5'],
  'FBD':          ['FBD','FBD GLATT','FBD 2','FBD 3','FBD 4','FBD 6','TEMACH','MIXING TANK','SILVERSON'],
  'STORAGE TANK': ['STORAGE TANK','STORAGE TANK 1','STORAGE TANK 2','STORAGE TANK 3','STORAGE TANK 4','STORAGE TANK 5','STORAGE TANK 6','STORAGE TANK 7','STORAGE TANK 8','STORAGE TANK 9','STORAGE TANK 10','STORAGE TANK 11','STORAGE TANK 12','TETRA 1','TETRA 2','TETRA 3','IPAL','AQUADEMIN','AQUADEMIN 1','AQUADEMIN 2','AQUADEMIN 3'],
  'BOILER':       ['BOILER','BOILER 1','BOILER 2','BOILER MIURA (3)'],
  'CHILLER':      ['CHILLER','CHILLER 1','CHILLER 2','CHILLER 3','CHILLER 4','CHILLER 5'],
  'KOMPRESOR':    ['KOMPRESOR','KOMPRESOR 1','KOMPRESOR 2','KOMPRESOR 3','KOMPRESOR 4','KOMPRESOR 5'],
  'AHU':          ['AHU','AHU 101','AHU 102','AHU 103','AHU 104','AHU 105','AHU 106','AHU 107','AHU 108','AHU 109','AHU 110','AHU 111','AHU 112','AHU 113','AHU 114','AHU 115','AHU 116','AHU 201','AHU 202','AHU 203','AHU 204','AHU 205','AHU 206','AHU 207','AHU 208','AHU 209','AHU 210','AHU 211','AHU 212','AHU 213','AHU 214','AHU 215','AHU 216','AHU 217','AHU 218','AHU 219','AHU 220','AHU 221','AHU 301','AHU 302','AHU 303','AHU 304','AHU 305','AHU 306','AHU 307','AHU 308'],
};

let currentMachineGroup = 'ALL';

function filterByMachineGroup(data, group) {
  if (!group || group === 'ALL') return data;
  const machines = MACHINE_GROUPS[group] || [];
  return data.filter(r => {
    if (!r.machine) return false;
    const m = r.machine.trim().toUpperCase();
    return machines.some(mg => m === mg.toUpperCase()) || m.startsWith(group.toUpperCase());
  });
}

function initMachineGroupFilter() {
  document.querySelectorAll('.mgf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mgf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMachineGroup = btn.dataset.group;
      const labelEl = document.getElementById('machineGroupLabelText');
      if (labelEl) labelEl.textContent = currentMachineGroup === 'ALL' ? 'Semua Mesin' : 'Grup: ' + currentMachineGroup;
      renderMachinePage(App.data.filtered);
    });
  });

  document.querySelectorAll('.nav-sub-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      currentMachineGroup = item.dataset.machineGroup;
      document.querySelectorAll('.mgf-btn').forEach(b => b.classList.toggle('active', b.dataset.group === currentMachineGroup));
      const labelEl = document.getElementById('machineGroupLabelText');
      if (labelEl) labelEl.textContent = currentMachineGroup === 'ALL' ? 'Semua Mesin' : 'Grup: ' + currentMachineGroup;
      navigateTo('machine');
    });
  });
}

function initMachineSubNav() {
  const machineNavItem = document.getElementById('machineNavItem');
  const subGroup = document.getElementById('machineSubGroup');
  const chevron  = document.getElementById('machineChevron');
  if (!machineNavItem || !subGroup) return;
  machineNavItem.addEventListener('click', e => {
    const isExp = subGroup.classList.contains('expanded');
    subGroup.classList.toggle('expanded', !isExp);
    chevron?.classList.toggle('rotated', !isExp);
  });
}

// ===================== CHARTS — MACHINE PAGE =====================

function renderMachinePage(data) {
  // Apply group filter jika ada
  const groupData = filterByMachineGroup(data, currentMachineGroup);
  renderMachineKPIs(groupData);
  renderMachineBarChart(groupData);
  renderMachineBreakdownChart(groupData);
  renderMachineRankingTable(groupData);
  renderMachineTrendChart(groupData);
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
  const data      = App.data.filtered.length > 0 ? App.data.filtered : App.data.outgoing;
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
  // Pakai ALL data (outgoing + expense) supaya dropdown lengkap
  const allData = getAllData();

  if (mEl && mEl.options.length <= 1) {
    const machines = [...new Set(allData.map(r => r.machine).filter(Boolean))].sort();
    machines.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      mEl.appendChild(opt);
    });
  }

  if (rEl && rEl.options.length <= 1) {
    const reqs = [...new Set(allData.map(r => r.requester).filter(Boolean))].sort();
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
    App.data.filtered = getAllData();
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
    saveSettings();
  }

  btn?.addEventListener('click', () => apply(!App.settings.darkMode));
  settingCb?.addEventListener('change', (e) => apply(e.target.checked));

  // Pakai nilai dari localStorage kalau ada, default dark mode
  apply(App.settings.darkMode !== false ? App.settings.darkMode : true);
}

// ===================== SETTINGS PERSISTENCE =====================

const SETTINGS_KEY = 'btkch_dashboard_settings';

/** Simpan semua settings ke localStorage */
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      lowStockThreshold: App.settings.lowStockThreshold,
      autoRefresh:       App.settings.autoRefresh,
      refreshInterval:   App.settings.refreshInterval,
      darkMode:          App.settings.darkMode,
    }));
  } catch(e) { console.warn('saveSettings failed:', e); }
}

/** Load settings dari localStorage, apply ke App.settings & UI */
function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;
    const s = JSON.parse(saved);

    if (s.lowStockThreshold != null) App.settings.lowStockThreshold = s.lowStockThreshold;
    if (s.autoRefresh       != null) App.settings.autoRefresh       = s.autoRefresh;
    if (s.refreshInterval   != null) App.settings.refreshInterval   = s.refreshInterval;
    if (s.darkMode          != null) App.settings.darkMode          = s.darkMode;
  } catch(e) { console.warn('loadSettings failed:', e); }
}

/** Sinkronkan nilai App.settings ke elemen-elemen UI di halaman Setting */
function syncSettingsUI() {
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  const refreshIntervalEl = document.getElementById('refreshInterval');
  const lowStockInput     = document.getElementById('lowStockThreshold');
  const darkModeToggle    = document.getElementById('darkModeToggleSetting');

  if (autoRefreshToggle) autoRefreshToggle.checked = App.settings.autoRefresh;
  if (refreshIntervalEl) refreshIntervalEl.value   = String(App.settings.refreshInterval);
  if (lowStockInput)     lowStockInput.value        = String(App.settings.lowStockThreshold);
  if (darkModeToggle)    darkModeToggle.checked     = App.settings.darkMode;
}

// ===================== SETTINGS PAGE =====================

function initSettings() {
  // syncSettingsUI dipanggil di sini agar UI ter-update setelah DOM ready
  syncSettingsUI();

  // Auto refresh toggle
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  const refreshIntervalEl = document.getElementById('refreshInterval');

  autoRefreshToggle?.addEventListener('change', (e) => {
    App.settings.autoRefresh = e.target.checked;
    saveSettings();
    if (e.target.checked) {
      startAutoRefresh();
    } else {
      clearInterval(App.intervals.refresh);
    }
  });

  refreshIntervalEl?.addEventListener('change', (e) => {
    App.settings.refreshInterval = parseInt(e.target.value);
    saveSettings();
    if (App.settings.autoRefresh) {
      clearInterval(App.intervals.refresh);
      startAutoRefresh();
    }
  });

  // Low stock threshold
  document.getElementById('saveLowStock')?.addEventListener('click', () => {
    const val = parseInt(document.getElementById('lowStockThreshold')?.value || '10');
    App.settings.lowStockThreshold = Math.max(1, val);
    saveSettings();
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
  darkSettingToggle?.addEventListener('change', () => {
    document.getElementById('darkmodeBtn')?.click();
    saveSettings();
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

/** startApp — dipanggil setelah login berhasil */
async function startApp() {
  // 1. Load saved settings
  loadSettings();

  // 2. Apply role restrictions to UI
  applyRoleUI();

  // 3. Start clock immediately
  startClock();

  // 4. Init UI components
  initSidebar();
  initNavItems();
  initDarkMode();
  initFilterControls();
  initTransactionControls();
  initSortableTable();
  initSettings();
  initMachineGroupFilter();
  initMachineSubNav();

  // 5. Run animation AND load data in parallel
  await Promise.all([
    runLoadingSequence(),
    loadAllData(),
  ]);

  // 6. Both done — finish animation, then render
  App.data.filtered = getAllData();
  finishLoading();

  setTimeout(() => {
    navigateTo('dashboard');
    startAutoRefresh();
  }, 400);
}

async function init() {
  // Init login UI dulu
  initLogin();

  // Cek kalau sudah ada session tersimpan
  const session = loadSession();
  if (session) {
    currentUser = session;
    hideLoginScreen();
    await startApp();
  } else {
    showLoginScreen();
  }
}

// ===================== BOOT =====================
document.addEventListener('DOMContentLoaded', init);
