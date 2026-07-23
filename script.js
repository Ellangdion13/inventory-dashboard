/* ============================================================
   BINTANG TOEDJOE - KCH INVENTORY MONITORING DASHBOARD
   Main JavaScript — Vanilla JS + Chart.js + PapaParse
   ============================================================ */

'use strict'; // Aktifkan strict mode: mencegah penggunaan variabel yang tidak dideklarasi

// ===================== GLOBAL STATE =====================
const App = { // Objek utama penyimpan seluruh state aplikasi
  data: {
    outgoing: [],         // Data CSV outgoing mentah hasil parse PapaParse
    expense: [],          // Data CSV expense mentah hasil parse PapaParse
    master: [],           // Data stok master dari datamaster.csv (kode, nama, lokasi, stok, UOM)
    machineList: [],       // Daftar master mesin dari sheet MACHINE (nama + grup kategori)
    filtered: [],         // Gabungan outgoing+expense setelah difilter tanggal (untuk machine & analytic)
    filteredOutgoing: [], // Hanya outgoing setelah filter (untuk dashboard & transaction tab outgoing)
    filteredExpense: [],  // Hanya expense setelah filter (untuk transaction tab expense)
    stockMaster: [],      // Data stock master final yang sudah di-enrich dengan histori outgoing
  },
  settings: {
    lowStockThreshold: 10,
    autoRefresh: true,
    refreshInterval: 60000,
    darkMode: false,
    // ── Stockout forecast ──
    // Ambang batas konservatif untuk SEMUA item (lokal & impor belum bisa dibedakan
    // karena datamaster.csv belum punya kolom kategori sumber barang). Nilai ini
    // sengaja dipakai sebagai pendekatan aman: dihitung dari estimasi lead time
    // pengadaan sparepart LOKAL (approval 3-5 hari + pengiriman 14 hari + penerimaan
    // 1-2 hari ≈ 18-21 hari), dibulatkan ke 21 hari. Item impor (biasanya lebih lama)
    // akan tetap tertangkap di kategori Perhatian sebelum kritis karena ambang
    // Perhatian diset cukup tinggi (30 hari). Sesuaikan di halaman Setting begitu
    // proses procurement berubah atau kategori lokal/impor sudah bisa dibedakan.
    forecastWindowDays: 30,      // berapa hari histori dipakai sbg basis rata-rata konsumsi
    forecastCriticalDays: 21,    // di bawah ini = Kritis (≈ lead time lokal maksimum)
    forecastWarningDays: 30,     // di bawah ini (dan >= kritis) = Perhatian
  },
  stock: {
    sortCol: 'stock',
    sortDir: 'asc',
    currentPage: 1,
    pageSize: 25,
    lastAlertCount: 0,   // untuk deteksi perubahan alert
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
    currentTrxTab: 'outgoing', // 'outgoing' | 'expense'
    trendRange: 7, // 3 | 7 | 30 | 'all' — untuk chart Trend Penggunaan Harian di dashboard
    // Badge "Stock Master" di sidebar: sengaja TIDAK disimpan ke localStorage,
    // supaya reload/refresh browser otomatis mengembalikan badge (sesuai keputusan:
    // hilang permanen setelah dibuka dalam sesi ini, tapi muncul lagi setelah reload).
    stockBadgeDismissed: false,
    // Sama seperti stockBadgeDismissed: badge "NEW" di menu Analytic hilang
    // permanen untuk sesi ini setelah dibuka, dan kembali muncul setelah reload.
    analyticBadgeDismissed: false,
    // Daftar item_code yang kritis terakhir kali badge dihitung — dipakai untuk
    // mendeteksi item BARU yang baru saja jadi kritis, agar badge tetap muncul lagi
    // walau sebelumnya sudah di-dismiss (peringatan baru tidak boleh ter-mute selamanya).
    lastSeenCriticalCodes: new Set(),
  },
  charts: {},           // Chart.js instances
  intervals: {},        // setInterval references
  dataHealth: {
    lastRowCounts: null,   // { outgoing, expense, master } dari load sebelumnya, utk deteksi anomali
    lastLoadOk: true,
    lastLoadError: null,
    latestDataDate: null,  // Date object — tanggal transaksi terbaru di CSV
  },
};


// ===================== AUTH SYSTEM =====================

const AUTH_KEY = 'btkch_auth_session'; // Key localStorage untuk menyimpan sesi login

const USERS = [
  { username: 'Widyan',    password: 'Alfarabiku@12',  role: 'admin', name: 'Widyan', dept: 'Sparepart' },
  { username: 'user',      password: 'user123',    role: 'user',  name: 'USER',             dept: 'General' },
];

const PERMISSIONS = {
  admin: { pages: ['dashboard','machine','analytic','transaction','stock','setting'], canExport: true,  canSetting: true,  label: 'Admin Sparepart' },
  user:  { pages: ['dashboard','machine'],                                            canExport: false, canSetting: false, label: 'User' },
};

let currentUser = null; // Menyimpan data user yang sedang login (null = belum login)

// Simpan data sesi user ke localStorage agar bisa direstorasi saat reload
function saveSession(user) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify({ username: user.username, role: user.role, name: user.name, dept: user.dept })); } catch(e) {}
}
// Baca data sesi user dari localStorage; kembalikan null jika tidak ada
function loadSession() {
  try { const s = localStorage.getItem(AUTH_KEY); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}
// Hapus sesi user dari localStorage (dipanggil saat logout)
function clearSession() {
  try { localStorage.removeItem(AUTH_KEY); } catch(e) {}
}

// Validasi kredensial; jika cocok simpan sesi dan kembalikan true
function login(username, password) {
  const user = USERS.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
  if (!user) return false;
  currentUser = user; // Simpan user yang login ke variabel global
  saveSession(user); // Persisten sesi ke localStorage
  return true; // Kembalikan true sebagai tanda login berhasil
}

// Hapus sesi, reset currentUser, dan tampilkan layar login kembali
function logout() {
  currentUser = null; // Hapus referensi user yang login
  clearSession(); // Hapus sesi dari localStorage
  showLoginScreen(); // Kembali ke halaman login
}

// Tampilkan/sembunyikan elemen UI sesuai role user yang sedang login
function applyRoleUI() {
  if (!currentUser) return;
  const perm = PERMISSIONS[currentUser.role] || PERMISSIONS.user;

  // Update topnav user info
  const nameEl   = document.getElementById('topnavUserName');
  const roleEl   = document.getElementById('topnavUserRole');
  const avatarEl = document.getElementById('userAvatar');
  if (nameEl)   nameEl.textContent = currentUser.name;
  if (roleEl)   roleEl.textContent = perm.label + ' — ' + currentUser.dept;
  if (avatarEl) avatarEl.style.background = currentUser.role === 'admin'
    ? 'linear-gradient(135deg,#1e90ff,#00d4ff)'
    : 'linear-gradient(135deg,#a855f7,#6366f1)';

  // Sembunyikan/tampilkan nav items berdasarkan role
  const allNavPages = ['dashboard','machine','analytic','transaction','stock','setting'];
  allNavPages.forEach(p => {
    const navEl = document.querySelector(`.nav-item[data-page="${p}"]`);
    if (!navEl) return;
    const allowed = perm.pages.includes(p);
    navEl.style.display    = allowed ? '' : 'none';
    navEl.style.pointerEvents = allowed ? '' : 'none';
  });

  // Sembunyikan export button untuk non-admin
  const exportBtn = document.getElementById('exportExcel');
  if (exportBtn) exportBtn.style.display = perm.canExport ? '' : 'none';
}

// Tampilkan layar login dan sembunyikan wrapper aplikasi utama
function showLoginScreen() {
  const ls = document.getElementById('loginScreen');
  const aw = document.getElementById('appWrapper');
  const ld = document.getElementById('loadingScreen');
  if (ls) ls.style.display = 'flex';
  if (aw) aw.style.display = 'none';
  if (ld) ld.style.display = 'none';
}
// Sembunyikan layar login setelah berhasil login
function hideLoginScreen() {
  const ls = document.getElementById('loginScreen');
  if (ls) ls.style.display = 'none';
}

// Pasang semua event listener pada form login (tombol, keyboard, toggle password)
function initLogin() {
  const loginBtn    = document.getElementById('loginBtn');
  const usernameEl  = document.getElementById('loginUsername');
  const passwordEl  = document.getElementById('loginPassword');
  const errorEl     = document.getElementById('loginError');
  const togglePwBtn = document.getElementById('togglePwBtn');
  const togglePwIcon= document.getElementById('togglePwIcon');

  // ── Toggle panel quick login saat klik tombol "Login User" ──
  const btnUserLogin = document.getElementById('btnUserLogin');
  const quickLoginPanel = document.getElementById('quickLoginPanel');
  if (btnUserLogin && quickLoginPanel) {
    btnUserLogin.addEventListener('click', () => {
      const isVisible = quickLoginPanel.style.display !== 'none';
      quickLoginPanel.style.display = isVisible ? 'none' : 'block';
      btnUserLogin.classList.toggle('active', !isVisible);
    });
  }

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
      const card = document.querySelector('.login-card'); // Kelas yang benar sesuai HTML
      card?.classList.add('shake');
      setTimeout(() => card?.classList.remove('shake'), 500);
    }
  }

  loginBtn?.addEventListener('click', doLogin);
  passwordEl?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  usernameEl?.addEventListener('keydown', e => { if (e.key === 'Enter') passwordEl?.focus(); });
  document.getElementById('logoutBtn')?.addEventListener('click', () => { if (confirm('Yakin ingin logout?')) logout(); });
}

// ===================== GOOGLE SHEETS DATA SOURCE =====================
// Data dibaca langsung dari Google Sheets — tidak perlu CSV lokal / git push lagi.
// Pastikan Spreadsheet di-share "Anyone with the link" (Viewer).
const SPREADSHEET_ID = '1el2QFS_6yPop7BI_Gj58hecn1_vMmW8uBcGKbC13q0A';

const SHEET_NAMES = {
  outgoing:   'OUTGOINGEDIT',
  expense:    'OUTGOINGEXPENSEEDIT',
  datamaster: 'DATAMASTEREDIT',
  machine:    'MACHINE', // Sheet master daftar mesin + kategori grupnya (diisi otomatis oleh Apps Script)
};

// Build URL export CSV langsung dari Google Sheets (gviz endpoint, no auth needed)
function sheetCSVUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

const CSV_OUTGOING   = sheetCSVUrl(SHEET_NAMES.outgoing);   // Sheet OUTGOING
const CSV_EXPENSE    = sheetCSVUrl(SHEET_NAMES.expense);    // Sheet OUTGOING EXPENSE
const CSV_DATAMASTER = sheetCSVUrl(SHEET_NAMES.datamaster); // Sheet DATA MASTER
const CSV_MACHINE    = sheetCSVUrl(SHEET_NAMES.machine);    // Sheet MACHINE (master daftar mesin)

// ===================== CHART.JS GLOBAL DEFAULTS =====================
Chart.defaults.color = '#94a3b8'; // Warna teks default semua chart (abu-abu terang)
Chart.defaults.font.family = 'Inter, sans-serif'; // Font default semua label chart
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10,15,30,0.92)';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(30,144,255,0.3)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;

// ===================== UTILITY FUNCTIONS =====================

/** Format date object → dd/mm/yyyy */
function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, '0'); // Ambil tanggal, padding 0 di depan jika perlu
  const mm = String(d.getMonth() + 1).padStart(2, '0'); // Bulan dimulai dari 0, tambah 1 agar jadi 1-12
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Parse tanggal dari berbagai format → Date object
 *  Support: Excel serial number, dd/mm/yyyy, M/D/YYYY, yyyy-mm-dd, dd-mm-yyyy */
function parseDate(str) {
  if (!str) return null;

  // ── Excel serial number (misal 46184, 46185) ──
  // Excel menyimpan tanggal sebagai integer hari sejak 1 Jan 1900
  // Angka murni tanpa separator = serial number Excel
  if (typeof str === 'number' || (typeof str === 'string' && /^\d{5}$/.test(str.trim()))) {
    const serial = parseInt(str, 10);
    if (serial > 40000 && serial < 60000) { // range wajar 2009-2064
      // Excel epoch: 1 Jan 1900 = serial 1
      // Koreksi bug Excel (menganggap 1900 adalah leap year): kurangi 1
      const excelEpoch = new Date(1900, 0, 1);
      const dt = new Date(excelEpoch.getTime() + (serial - 2) * 86400000);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  if (typeof str !== 'string') return null;
  str = str.trim();
  if (!str) return null;

  // ── Format dengan slash: dd/mm/yyyy atau M/D/YYYY ──
  const slashParts = str.split('/');
  if (slashParts.length === 3) {
    const [a, b, c] = slashParts.map(s => parseInt(s, 10));
    let y = c < 100 ? c + 2000 : c;

    if (a > 12) {
      // Pasti dd/mm/yyyy karena hari tidak mungkin > 12 kalau bulan
      const dt = new Date(y, b - 1, a);
      if (!isNaN(dt.getTime())) return dt;
    } else if (b > 12) {
      // Pasti M/D/YYYY karena bulan tidak mungkin > 12
      const dt = new Date(y, a - 1, b);
      if (!isNaN(dt.getTime())) return dt;
    } else {
      // Ambigu — default dd/mm/yyyy (format Indonesia)
      const dt = new Date(y, b - 1, a);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  // ── Format yyyy-mm-dd (ISO) atau dd-mm-yyyy ──
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

  // ── Fallback native ──
  const dt = new Date(str);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Format number with thousand separator */
function fmtNum(n) {
  return Number(n).toLocaleString('id-ID'); // Format angka dengan separator ribuan gaya Indonesia (1.000)
}

/** Format currency IDR */
function fmtCurrency(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID'); // Format ke rupiah: Rp 1.000.000
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
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]); // Pilih warna secara siklus dari palet jika n > panjang palet
}

/** Destroy chart if exists, then recreate */
function destroyChart(key) {
  if (App.charts[key]) { // Cek apakah chart dengan key ini sudah pernah dibuat
    App.charts[key].destroy(); // Hancurkan instance chart lama agar tidak tumpang tindih
    delete App.charts[key]; // Hapus referensi dari objek App.charts
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
  const steps = [ // Daftar tahap animasi loading bar beserta persentase dan pesan status
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
    const [outgoing, expense, master, machineList] = await Promise.all([
      loadCSV(CSV_OUTGOING),
      loadCSV(CSV_EXPENSE),
      loadMasterCSV(CSV_DATAMASTER),
      loadMachineListCSV(CSV_MACHINE),
    ]);

    App.data.outgoing = outgoing;
    App.data.expense  = expense;
    App.data.master   = master;
    App.data.machineList = machineList;

    // Gabungkan mesin dari sheet MACHINE ke MACHINE_GROUPS, lalu bangun ulang
    // tombol filter grup mesin (halaman Machine) & sub-menu sidebar supaya
    // mesin/grup baru yang ditambahkan di sheet langsung muncul di dashboard.
    mergeMachineListIntoGroups(machineList);
    rebuildMachineGroupUI();

    setDsStatus('dsOutgoingStatus', outgoing.length > 0);
    setDsStatus('dsExpenseStatus',  expense.length  > 0);
    setDsStatus('dsMasterStatus',   master.length   > 0);

    console.log('Outgoing:', outgoing.length, '| Expense:', expense.length, '| Master:', master.length, '| Machine list:', machineList.length);

    // ── Validasi dasar + deteksi anomali, lalu tampilkan status ke pengguna ──
    App.dataHealth.lastLoadOk = true;
    App.dataHealth.lastLoadError = null;
    App.dataHealth.latestDataDate = computeLatestDataDate(outgoing, expense);
    evaluateDataHealth({ outgoing, expense, master });

    return true;
  } catch (err) {
    console.error('Data load error:', err);
    App.dataHealth.lastLoadOk = false;
    App.dataHealth.lastLoadError = (err && err.message) ? err.message : String(err);
    showDataStatusBanner('error', 'Gagal memuat data', 'Terjadi kesalahan saat mengambil berkas CSV. Dashboard menampilkan data terakhir yang berhasil dimuat sebelumnya (jika ada).');
    return false;
  }
}

/** Cari tanggal transaksi terbaru di antara outgoing + expense (sumber kebenaran "data per tanggal berapa") */
function computeLatestDataDate(outgoing, expense) {
  let latest = null;
  [...outgoing, ...expense].forEach(row => {
    const d = parseDate(row.date);
    if (d && (!latest || d > latest)) latest = d;
  });
  return latest;
}

/**
 * Validasi dasar & deteksi anomali setelah data CSV dimuat.
 * Tidak menghentikan aplikasi — hanya menampilkan peringatan yang jelas ke pengguna,
 * supaya kesalahan pada proses macro/export tidak diteruskan secara diam-diam ke dashboard.
 */
function evaluateDataHealth({ outgoing, expense, master }) {
  const prev = App.dataHealth.lastRowCounts;
  const curr = { outgoing: outgoing.length, expense: expense.length, master: master.length };

  // 1) Data kosong total — kemungkinan CSV gagal/rusak
  if (curr.outgoing === 0 && curr.expense === 0) {
    showDataStatusBanner('error', 'Data outgoing kosong',
      'Berkas outgoing.csv dan outgoingexpense.csv tidak memuat data sama sekali. Periksa apakah proses export macro berjalan dengan benar.');
    App.dataHealth.lastRowCounts = curr;
    return;
  }

  if (curr.master === 0) {
    showDataStatusBanner('warning', 'Data master stok tidak terbaca',
      'datamaster.csv kosong atau gagal dibaca. Status Stock Master mungkin tidak akurat sampai berkas ini diperbaiki.');
    App.dataHealth.lastRowCounts = curr;
    return;
  }

  // 2) Penurunan jumlah baris yang drastis dibanding load sebelumnya (indikasi CSV terpotong/rusak)
  if (prev) {
    const dropRatio = (key) => prev[key] > 0 ? (prev[key] - curr[key]) / prev[key] : 0;
    const flagged = ['outgoing', 'expense', 'master'].filter(key => dropRatio(key) >= 0.5 && prev[key] >= 10);
    if (flagged.length > 0) {
      const label = { outgoing: 'outgoing.csv', expense: 'outgoingexpense.csv', master: 'datamaster.csv' };
      const names = flagged.map(k => label[k]).join(', ');
      showDataStatusBanner('warning', 'Jumlah data turun drastis',
        `Jumlah baris pada ${names} turun lebih dari 50% dibanding pemuatan sebelumnya. Ini bisa jadi normal (mis. reset periode), tapi sebaiknya dicek agar bukan akibat data terpotong.`);
      App.dataHealth.lastRowCounts = curr;
      return;
    }
  }

  // 3) Semua aman — tampilkan status normal dengan tanggal data terbaru
  const dateLabel = App.dataHealth.latestDataDate ? fmtDate(App.dataHealth.latestDataDate) : 'tidak terdeteksi';
  showDataStatusBanner('ok', 'Data sinkron',
    `Data terbaru tercatat per ${dateLabel}. ${fmtNum(curr.outgoing + curr.expense)} transaksi termuat dari repository.`);

  App.dataHealth.lastRowCounts = curr;
}

/** Tampilkan banner status data di bagian atas halaman (persisten di semua tab) */
function showDataStatusBanner(type, title, desc) {
  const banner = document.getElementById('dataStatusBanner');
  const iconEl = document.getElementById('dsbIcon');
  const titleEl = document.getElementById('dsbTitle');
  const descEl = document.getElementById('dsbDesc');
  if (!banner) return;

  banner.classList.remove('dsb-ok', 'dsb-warning', 'dsb-error');
  banner.classList.add('dsb-' + type, 'show');

  const icons = {
    ok:      'bi-check-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    error:   'bi-x-octagon-fill',
  };
  if (iconEl) iconEl.innerHTML = `<i class="bi ${icons[type] || icons.ok}"></i>`;
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;

  // Banner "ok" otomatis hilang setelah beberapa saat agar tidak mengganggu;
  // banner warning/error tetap tampil sampai pengguna menutup atau status berubah.
  clearTimeout(App.intervals.bannerAutoHide);
  if (type === 'ok') {
    App.intervals.bannerAutoHide = setTimeout(() => {
      banner.classList.remove('show');
    }, 6000);
  }
}

function initDataStatusBanner() {
  document.getElementById('dsbDismiss')?.addEventListener('click', () => {
    document.getElementById('dataStatusBanner')?.classList.remove('show');
  });
}

/** Load DATA MASTER CSV — kolom: Kode Item, Deskripsi, Lokasi, Stock, UOM */
function loadMasterCSV(path) {
  return new Promise((resolve) => {
    Papa.parse(path, {
      download:       true,
      header:         true,
      skipEmptyLines: true,
      delimiter:      ',',
      complete: (results) => {
        const rows = results.data
          .map(row => {
            const clean = {};
            Object.keys(row).forEach(k => {
              clean[k.replace(/^﻿/, '').replace(/[\r\n]+/g, ' ').trim()] =
                (row[k] || '').toString().trim();
            });
            return clean;
          })
          // Cari field secara case-insensitive + dukung beberapa alias nama kolom,
          // karena header datamaster.csv asli pakai "New Code" / "Item Name" / "STOCK"
          // (bukan "Kode Item" / "Deskripsi" / "Stock")
          .map(row => {
            const findField = (...names) => {
              const keys = Object.keys(row);
              for (const name of names) {
                const k = keys.find(kk => kk.toLowerCase() === name.toLowerCase());
                if (k && row[k] !== '') return row[k];
              }
              return '';
            };
            return {
              item_code: findField('New Code', 'Kode Item', 'Item Code', 'Kode'),
              item_name: findField('Item Name', 'Deskripsi', 'Description'),
              lokasi:    findField('Lokasi', 'Location'),
              rawStock:  findField('STOCK', 'Stock', 'QTY', 'Stok'),
              uom:       findField('UOM', 'Satuan'),
            };
          })
          .filter(row => row.item_code.trim() !== '')
          .map(row => {
            const stockNum = parseFloat(row.rawStock);
            return {
              item_code: row.item_code,
              item_name: row.item_name,
              lokasi:    row.lokasi,
              stock:     isNaN(stockNum) ? 0 : stockNum,
              uom:       row.uom,
            };
          });
        console.log('MASTER loaded:', rows.length);
        resolve(rows);
      },
      error: (err) => {
        console.warn('datamaster.csv error:', err);
        resolve([]);
      },
    });
  });
}


/** Load MACHINE master sheet — kolom: Machine Name (nama mesin), Group (kategori grup) */
function loadMachineListCSV(path) {
  return new Promise((resolve) => {
    Papa.parse(path, {
      download:       true,
      header:         true,
      skipEmptyLines: true,
      delimiter:      ',',
      complete: (results) => {
        const rows = results.data
          .map(row => {
            const clean = {};
            Object.keys(row).forEach(k => {
              clean[k.replace(/^﻿/, '').replace(/[\r\n]+/g, ' ').trim()] =
                (row[k] || '').toString().trim();
            });
            return clean;
          })
          .map(row => {
            const findField = (...names) => {
              const keys = Object.keys(row);
              for (const name of names) {
                const k = keys.find(kk => kk.toLowerCase() === name.toLowerCase());
                if (k && row[k] !== '') return row[k];
              }
              return '';
            };
            return {
              name:  findField('Machine Name', 'Nama Mesin', 'Mesin', 'Machine'),
              group: findField('Group', 'Grup', 'Kategori', 'Category'),
            };
          })
          .filter(row => row.name.trim() !== '');
        console.log('MACHINE list loaded:', rows.length);
        resolve(rows);
      },
      error: (err) => {
        console.warn('MACHINE sheet error:', err);
        resolve([]);
      },
    });
  });
}

/**
 * Gabungkan daftar mesin dari sheet MACHINE ke dalam MACHINE_GROUPS (runtime).
 * Kalau grup di sheet belum ada di MACHINE_GROUPS, otomatis dibuat grup baru.
 * Kalau kolom Group kosong / tidak dikenali, mesin masuk ke grup 'LAINNYA'.
 */
function mergeMachineListIntoGroups(machineList) {
  machineList.forEach(({ name, group }) => {
    if (!name) return;
    const g = (group || 'LAINNYA').trim().toUpperCase() || 'LAINNYA';
    if (!MACHINE_GROUPS[g]) MACHINE_GROUPS[g] = [];
    const upper = name.trim().toUpperCase();
    if (!MACHINE_GROUPS[g].some(m => m.toUpperCase() === upper)) {
      MACHINE_GROUPS[g].push(name.trim());
    }
  });
}


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

// Update badge status sumber data di halaman Setting (Loaded / Error)
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

  function inRange(row) {
    if (!row.date) return false;
    const d = parseDate(row.date);
    if (!d) return false;
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  }

  // Gabungan untuk analytic & machine
  App.data.filtered         = getAllData().filter(inRange);
  // Terpisah untuk dashboard (outgoing only) & transaction tabs
  App.data.filteredOutgoing = App.data.outgoing.filter(inRange);
  App.data.filteredExpense  = App.data.expense.filter(inRange);

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

// Hitung nilai KPI (total data, qty, transaksi hari ini, dll.) dari array data
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

// Render kartu KPI di dashboard dengan animasi counter
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

/** Trend Chart: Qty per day, range dipilih via tombol (3 / 7 / 30 / Semua) */
function renderTrendChart(data) {
  const range = App.ui.trendRange;
  let dates;

  if (range === 'all') {
    // Ambil semua tanggal unik yang ada di data, urut dari lama ke baru
    dates = [...new Set(data.map(r => r.date).filter(Boolean))]
      .sort((a, b) => parseDate(a) - parseDate(b));
  } else {
    dates = lastNDates(parseInt(range) || 7);
  }

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
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          border: { display: false },
          ticks: { font: { size: 11 }, precision: 0 },
        },
        y1: {
          type: 'linear', position: 'right',
          beginAtZero: true,
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 11 }, precision: 0 },
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

// Render daftar item mendekati batas stok minimum di widget dashboard
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

// Render daftar 8 transaksi terbaru di widget dashboard
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
  'JINSUNG':       ['JINSUNG','JINSUNG 1','JINSUNG 2','JINSUNG 3','JINSUNG 4','JINSUNG 5'],
  'FBD':          ['FBD','FBD GLATT','FBD 2','FBD 3','FBD 4','FBD 6','TEMACH','MIXING TANK','SILVERSON'],
  'STORAGE TANK': ['STORAGE TANK','STORAGE TANK 1','STORAGE TANK 2','STORAGE TANK 3','STORAGE TANK 4','STORAGE TANK 5','STORAGE TANK 6','STORAGE TANK 7','STORAGE TANK 8','STORAGE TANK 9','STORAGE TANK 10','STORAGE TANK 11','STORAGE TANK 12','TETRA 1','TETRA 2','TETRA 3','IPAL','AQUADEMIN','AQUADEMIN 1','AQUADEMIN 2','AQUADEMIN 3'],
  'BOILER':       ['BOILER','BOILER 1','BOILER 2','BOILER MIURA (3)'],
  'CHILLER':      ['CHILLER','CHILLER 1','CHILLER 2','CHILLER 3','CHILLER 4','CHILLER 5'],
  'KOMPRESOR':    ['KOMPRESOR','KOMPRESOR 1','KOMPRESOR 2','KOMPRESOR 3','KOMPRESOR 4','KOMPRESOR 5'],
  'AHU':          ['AHU','AHU 101','AHU 102','AHU 103','AHU 104','AHU 105','AHU 106','AHU 107','AHU 108','AHU 109','AHU 110','AHU 111','AHU 112','AHU 113','AHU 114','AHU 115','AHU 116','AHU 201','AHU 202','AHU 203','AHU 204','AHU 205','AHU 206','AHU 207','AHU 208','AHU 209','AHU 210','AHU 211','AHU 212','AHU 213','AHU 214','AHU 215','AHU 216','AHU 217','AHU 218','AHU 219','AHU 220','AHU 221','AHU 301','AHU 302','AHU 303','AHU 304','AHU 305','AHU 306','AHU 307','AHU 308'],
};

let currentMachineGroup = 'ALL'; // Grup mesin yang sedang aktif di filter halaman Machine

// Cek apakah sebuah nama mesin cocok dengan salah satu grup yang sudah didefinisikan di MACHINE_GROUPS
// (excludeGroup: nama grup yang dilewati saat pengecekan, dipakai untuk grup 'LAINNYA')
function isMachineInDefinedGroups(machineName, excludeGroup) {
  if (!machineName) return false;
  const m = machineName.trim().toUpperCase();
  return Object.keys(MACHINE_GROUPS).some(group => {
    if (group === excludeGroup) return false;
    const machines = MACHINE_GROUPS[group];
    return machines.some(mg => m === mg.toUpperCase()) || m.startsWith(group.toUpperCase());
  });
}

// Filter data berdasarkan grup mesin (ILAPAK, SIG, dll.), 'LAINNYA' untuk mesin yang belum terdaftar di grup manapun, atau 'ALL' untuk semua
function filterByMachineGroup(data, group) {
  if (!group || group === 'ALL') return data;
  if (group === 'LAINNYA') {
    // Grup "Lainnya": mesin yang di-set eksplisit ke LAINNYA di sheet, ATAU
    // mesin yang tidak cocok dengan grup manapun (belum dikategorikan sama sekali)
    const explicit = MACHINE_GROUPS['LAINNYA'] || [];
    return data.filter(r => {
      if (!r.machine) return false;
      const m = r.machine.trim().toUpperCase();
      if (explicit.some(mg => m === mg.toUpperCase())) return true;
      return !isMachineInDefinedGroups(r.machine, 'LAINNYA');
    });
  }
  const machines = MACHINE_GROUPS[group] || [];
  return data.filter(r => {
    if (!r.machine) return false;
    const m = r.machine.trim().toUpperCase();
    return machines.some(mg => m === mg.toUpperCase()) || m.startsWith(group.toUpperCase());
  });
}

// Label tampilan yang lebih rapi untuk grup tertentu (selain itu pakai nama grup apa adanya)
const MACHINE_GROUP_LABELS = {
  'STORAGE TANK': 'Storage Tank',
  'BOILER': 'Boiler',
  'CHILLER': 'Chiller',
  'KOMPRESOR': 'Kompresor',
  'LAINNYA': 'Lainnya',
};
function machineGroupLabel(g) {
  return MACHINE_GROUP_LABELS[g] || (g.charAt(0) + g.slice(1).toLowerCase());
}

/**
 * Bangun ulang tombol filter grup mesin (halaman Machine) & sub-menu sidebar
 * berdasarkan isi MACHINE_GROUPS saat ini (termasuk grup baru dari sheet MACHINE).
 * Dipanggil setiap kali data selesai dimuat/direfresh.
 */
function rebuildMachineGroupUI() {
  const groupKeys = Object.keys(MACHINE_GROUPS).filter(g => g !== 'LAINNYA');
  groupKeys.push('LAINNYA'); // "Lainnya" selalu ditampilkan di posisi akhir, menampung mesin baru/tak dikenal

  // --- Tombol filter di halaman Machine ---
  const btnContainer = document.getElementById('machineGroupBtns');
  if (btnContainer) {
    const prevActive = currentMachineGroup;
    btnContainer.innerHTML = `<button class="mgf-btn" data-group="ALL">Semua</button>` +
      groupKeys.map(g => `<button class="mgf-btn" data-group="${g}">${machineGroupLabel(g)}</button>`).join('');
    btnContainer.querySelectorAll('.mgf-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.group === prevActive);
    });
  }

  // --- Sub-menu sidebar ---
  const subGroup = document.getElementById('machineSubGroup');
  if (subGroup) {
    subGroup.innerHTML = groupKeys.map(g =>
      `<a href="#" class="nav-sub-item" data-machine-group="${g}"><i class="bi bi-cpu"></i> ${machineGroupLabel(g)}</a>`
    ).join('') + `<a href="#" class="nav-sub-item" data-machine-group="ALL"><i class="bi bi-grid-3x3-gap"></i> Semua Mesin</a>`;
  }

  // Pasang ulang event listener karena elemen tombol baru dibuat
  initMachineGroupFilter();
}


// Pasang listener tombol filter grup mesin dan nav sub-item sidebar
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

// Pasang listener toggle/expand sub-navigasi mesin di sidebar
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

// Render seluruh konten halaman Machine (KPI, chart, tabel ranking)
function renderMachinePage(data) {
  // Apply group filter jika ada
  const groupData = filterByMachineGroup(data, currentMachineGroup);
  renderMachineKPIs(groupData);
  renderMachineBarChart(groupData);
  renderMachineBreakdownChart(groupData);
  renderMachineRankingTable(groupData);
  renderMachineTrendChart(groupData);
}

// Render kartu mini KPI per mesin berdasarkan jumlah transaksi
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

// Render bar chart total qty keluar per mesin
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
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          border: { display: false },
          ticks: { precision: 0 },
        },
      },
    },
  });
}

// Render polar area chart frekuensi breakdown per mesin
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

// Render tabel ranking mesin berdasarkan jumlah transaksi
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

// Render line chart tren qty per mesin (top 5) selama 7 hari
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
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          border: { display: false },
          ticks: { precision: 0 },
        },
      },
    },
  });
}

// ===================== CHARTS — ANALYTIC PAGE =====================

// Render seluruh konten halaman Analytic (semua chart analitik)
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
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { display: false },
          ticks: { precision: 0 },
        },
        y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

// Render doughnut chart distribusi transaksi per requester
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

// Render pie chart distribusi transaksi per cost allocation
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
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          border: { display: false },
          ticks: { precision: 0 },
        },
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


// ===================== STOCK MASTER =====================

/** Bangun stock master dari DATA MASTER CSV + enrichment dari outgoing history */
function buildStockMaster(outgoing) {
  // Kalau datamaster.csv sudah ter-load, pakai itu sebagai sumber utama
  const masterSource = App.data.master && App.data.master.length > 0
    ? App.data.master
    : null;

  // Build lookup total_out & last_out dari outgoing history
  const histMap = {};
  outgoing.forEach(r => {
    if (!r.item_code || r.item_code.trim() === '') return;
    const code = r.item_code.trim();
    if (!histMap[code]) histMap[code] = { total_out: 0, last_out: '', _lastDate: null };
    histMap[code].total_out += (parseInt(r.qty) || 0);
    const d = parseDate(r.date);
    if (d && (!histMap[code]._lastDate || d >= histMap[code]._lastDate)) {
      histMap[code]._lastDate = d;
      histMap[code].last_out  = r.date;
    }
  });

  if (masterSource) {
    // ── Sumber utama: DATA MASTER CSV ──
    return masterSource.map(item => {
      const code = item.item_code.trim();
      const hist = histMap[code] || { total_out: 0, last_out: '-' };
      return {
        item_code:  code,
        item_name:  item.item_name || code,
        lokasi:     item.lokasi    || '-',
        uom:        item.uom       || '',
        stock:      item.stock,          // sudah 0 kalau kosong dari VBA
        total_out:  hist.total_out,
        last_out:   hist.last_out && parseDate(hist.last_out)
                      ? hist.last_out : '-',
      };
    });
  } else {
    // ── Fallback: derive dari outgoing kalau datamaster.csv belum ada ──
    const itemMap = {};
    outgoing.forEach(r => {
      if (!r.item_code || r.item_code.trim() === '') return;
      const code = r.item_code.trim();
      const d    = parseDate(r.date);
      if (!itemMap[code]) {
        itemMap[code] = {
          item_code: code,
          item_name: r.item_name || code,
          lokasi:    '-',
          uom:       '',
          stock:     parseInt(r.stock) || 0,
          total_out: 0,
          last_out:  d ? r.date : '-',
          _lastDate: d || null,
        };
      }
      itemMap[code].total_out += (parseInt(r.qty) || 0);
      if (d && (!itemMap[code]._lastDate || d >= itemMap[code]._lastDate)) {
        itemMap[code]._lastDate = d;
        itemMap[code].last_out  = r.date;
        if (r.stock !== '' && r.stock !== undefined) {
          const s = parseInt(r.stock);
          if (!isNaN(s)) itemMap[code].stock = s;
        }
      }
    });
    return Object.values(itemMap).map(({ _lastDate, ...rest }) => ({
      ...rest,
      stock:    parseInt(rest.stock) || 0,
      last_out: rest.last_out && parseDate(rest.last_out) ? rest.last_out : '-',
    }));
  }
}

/** Tentukan status item berdasarkan threshold */
function getStockStatus(stock, threshold) {
  if (stock <= 0)                   return { level: 'empty',    label: 'Habis',      color: '#64748b' };
  if (stock <= threshold * 0.5)     return { level: 'critical', label: 'Critical',   color: '#ef4444' };
  if (stock <= threshold)           return { level: 'low',      label: 'Low Stock',  color: '#f59e0b' };
  return                                   { level: 'ok',       label: 'Aman',       color: '#00e5a0' };
}

/**
 * Hitung prediksi stockout (perkiraan habis stok) untuk setiap item di stock master.
 *
 * Logika inti: rata-rata konsumsi harian dihitung dari TOTAL qty keluar dibagi
 * JUMLAH HARI AKTIF (hari yang benar-benar ada transaksi) dalam window N hari
 * terakhir — bukan dibagi N hari kalender mentah. Ini penting supaya item yang
 * jarang keluar (misal cuma 2-3 kali sebulan) tidak under-estimate rata-rata
 * konsumsinya hanya karena banyak hari kosong di antaranya.
 *
 * Ambang batas Kritis/Perhatian SENGAJA dibuat satu angka konservatif untuk
 * semua item (lihat catatan di App.settings.forecastCriticalDays), karena
 * datamaster.csv saat ini belum membedakan item lokal vs impor yang punya
 * lead time pengadaan jauh berbeda. Begitu kolom kategori tersedia, fungsi
 * ini bisa dikembangkan untuk memilih ambang berbeda per kategori.
 *
 * @param {Array} outgoing - App.data.outgoing, SEMUA transaksi (belum difilter tanggal UI)
 * @param {Array} stockMaster - hasil buildStockMaster(), sumber stok terkini
 * @returns {Array} stockMaster dengan field tambahan: dailyAvg, daysLeft, forecastLevel
 */
function calculateStockoutForecast(outgoing, stockMaster) {
  const windowDays    = App.settings.forecastWindowDays;
  const criticalDays  = App.settings.forecastCriticalDays;
  const warningDays   = App.settings.forecastWarningDays;

  const today = new Date();
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - windowDays);

  // 1) Kelompokkan qty keluar per item HANYA dalam window N hari terakhir,
  //    sekaligus catat tanggal-tanggal unik yang punya transaksi (hari aktif).
  const windowMap = {}; // { item_code: { totalQty, activeDates: Set<string> } }

  outgoing.forEach(r => {
    if (!r.item_code) return;
    const d = parseDate(r.date);
    if (!d || d < windowStart || d > today) return; // di luar window, skip

    const code = r.item_code.trim();
    if (!windowMap[code]) windowMap[code] = { totalQty: 0, activeDates: new Set() };
    windowMap[code].totalQty += (parseInt(r.qty) || 0);
    windowMap[code].activeDates.add(r.date);
  });

  // 2) Untuk setiap item, hitung rata-rata harian, hari tersisa, dan level risiko
  return stockMaster.map(item => {
    const w = windowMap[item.item_code];

    // Tidak ada transaksi sama sekali dalam window → tidak bisa diprediksi, anggap stabil
    if (!w || w.activeDates.size === 0) {
      return { ...item, dailyAvg: 0, daysLeft: null, forecastLevel: 'stable' };
    }

    const activeDayCount = w.activeDates.size;
    const dailyAvg = w.totalQty / activeDayCount;

    if (dailyAvg <= 0) {
      return { ...item, dailyAvg: 0, daysLeft: null, forecastLevel: 'stable' };
    }

    const daysLeft = item.stock / dailyAvg;

    let forecastLevel;
    if (daysLeft < criticalDays)      forecastLevel = 'critical';
    else if (daysLeft <= warningDays) forecastLevel = 'warning';
    else                              forecastLevel = 'safe';

    return {
      ...item,
      dailyAvg:  Math.round(dailyAvg * 100) / 100,
      daysLeft:  Math.round(daysLeft * 10) / 10,
      forecastLevel,
    };
  });
}

/** Label & warna untuk tiap level forecast — dipakai di tabel Stock Master */
function getForecastBadge(level, daysLeft) {
  switch (level) {
    case 'critical':
      return { label: `Kritis · ${daysLeft} hari`, className: 'forecast-critical' };
    case 'warning':
      return { label: `Perhatian · ${daysLeft} hari`, className: 'forecast-warning' };
    case 'safe':
      return { label: `Aman · ${daysLeft} hari`, className: 'forecast-safe' };
    default:
      return { label: 'Tidak ada pergerakan', className: 'forecast-stable' };
  }
}

/** Update badge "data per tanggal berapa" di halaman Stock Master.
 *  Sebelumnya menampilkan jam render browser — sekarang menampilkan tanggal
 *  transaksi terbaru yang benar-benar ada di CSV, agar tidak menyesatkan
 *  (jam render browser tidak mencerminkan kapan data sebenarnya terakhir diperbarui). */
// Update badge 'data per tanggal' di header halaman Stock Master
function updateStockSyncBadge() {
  const badge = document.getElementById('stockSyncBadge');
  const timeEl = document.getElementById('stockSyncTime');
  if (!timeEl) return;

  const latest = App.dataHealth.latestDataDate;
  timeEl.textContent = latest
    ? `Data per: ${fmtDate(latest)}`
    : 'Tanggal data tidak terdeteksi';

  // Kasih efek visual sebentar biar terlihat baru "berkedip"
  if (badge) {
    badge.classList.add('syncing');
    setTimeout(() => badge.classList.remove('syncing'), 600);
  }
}

/** Render halaman Stock Master */
function renderStockMasterPage() {
  const threshold = App.settings.lowStockThreshold;
  let master      = buildStockMaster(App.data.outgoing);
  // Tambahkan prediksi stockout (dailyAvg, daysLeft, forecastLevel) ke setiap item.
  // Dihitung dari App.data.outgoing (semua histori, TIDAK terbatas filter tanggal UI)
  // supaya window 30 hari forecast tidak ikut terpotong oleh filter dashboard.
  master = calculateStockoutForecast(App.data.outgoing, master);
  App.data.stockMaster = master;
  updateStockSyncBadge();

  // ── KPI ──
  const total    = master.length;
  const critical = master.filter(i => i.stock > 0 && i.stock <= threshold * 0.5).length;
  const low      = master.filter(i => i.stock > threshold * 0.5 && i.stock <= threshold).length;
  const empty    = master.filter(i => i.stock <= 0).length;
  const ok       = total - critical - low - empty;

  animateCounter('skpiTotalItem',    total);
  animateCounter('skpiOkItem',       ok);
  animateCounter('skpiLowItem',      low);
  animateCounter('skpiCriticalItem', critical);
  animateCounter('skpiEmptyItem',    empty);

  // ── Filter + Search ──
  const search    = (document.getElementById('stockSearch')?.value    || '').toLowerCase();
  const statusFilter = document.getElementById('stockFilterStatus')?.value || '';

  let rows = master.filter(item => {
    const st = getStockStatus(item.stock, threshold);
    if (statusFilter && st.level !== statusFilter) return false;
    if (search) {
      const hay = (item.item_code + ' ' + item.item_name).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // ── Sort ──
  const col = App.stock.sortCol;
  const dir = App.stock.sortDir;
  rows.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (col === 'stock' || col === 'total_out') {
      va = Number(va) || 0; vb = Number(vb) || 0;
    } else if (col === 'daysLeft') {
      // Item "stable" (tidak ada pergerakan, daysLeft = null) selalu ditaruh di
      // akhir urutan saat sort ascending — karena tidak ada urgensi sama sekali,
      // bukan diperlakukan seolah daysLeft = 0 (yang akan keliru dianggap kritis).
      const aNull = va === null || va === undefined;
      const bNull = vb === null || vb === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      va = Number(va); vb = Number(vb);
    } else if (col === 'last_out') {
      va = parseDate(va) || new Date(0);
      vb = parseDate(vb) || new Date(0);
    } else {
      va = String(va || '').toLowerCase();
      vb = String(vb || '').toLowerCase();
    }
    if (va < vb) return dir === 'asc' ? -1 :  1;
    if (va > vb) return dir === 'asc' ?  1 : -1;
    return 0;
  });

  // ── Pagination ──
  const pageSize  = App.stock.pageSize;
  const totalRows = rows.length;
  const pages     = Math.ceil(totalRows / pageSize) || 1;
  let   page      = Math.min(App.stock.currentPage, pages);
  App.stock.currentPage = page;

  const startIdx  = (page - 1) * pageSize;
  const pageRows  = rows.slice(startIdx, startIdx + pageSize);

  const countEl = document.getElementById('stockRowCount');
  if (countEl) countEl.textContent = `${fmtNum(totalRows)} item`;

  // ── Render table ──
  const tbody = document.getElementById('stockTableBody');
  if (!tbody) return;

  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--clr-text3);padding:30px">
      <i class="bi bi-inbox" style="font-size:28px;display:block;margin-bottom:8px"></i>Tidak ada data
    </td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map((item, i) => {
      const st       = getStockStatus(item.stock, threshold);
      const fc        = getForecastBadge(item.forecastLevel, item.daysLeft);
      const rowNum   = startIdx + i + 1;
      const pct      = threshold > 0
        ? Math.min((item.stock / (threshold * 3)) * 100, 100) : 0;

      return `
        <tr class="${st.level === 'critical' || st.level === 'empty' ? 'row-alert' : ''}">
          <td style="color:var(--clr-text3);font-size:11px">${rowNum}</td>
          <td><span class="item-code-badge">${item.item_code}</span></td>
          <td style="font-weight:500;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${item.item_name}
          </td>
          <td style="font-size:12px;color:var(--clr-text3)">${item.lokasi || '-'}</td>
          <td>
            <div class="stock-cell">
              <div class="stock-bar-wrap">
                <div class="stock-bar-fill ${st.level}" style="width:${pct}%"></div>
              </div>
              <span class="stock-val" style="color:${st.color}">
                <strong>${fmtNum(item.stock)}</strong>
              </span>
            </div>
          </td>
          <td style="font-size:12px;color:var(--clr-text3)">${item.uom || '-'}</td>
          <td style="font-family:'JetBrains Mono',monospace;color:var(--clr-text2)">
            ${fmtNum(item.total_out)}
          </td>
          <td style="font-size:12px;color:var(--clr-text3)">${item.last_out || '-'}</td>
          <td><span class="forecast-badge ${fc.className}">${fc.label}</span></td>
          <td>
            <span class="stock-status-badge ${st.level}">
              ${st.level === 'empty'    ? '<i class="bi bi-slash-circle-fill"></i>' :
                st.level === 'critical' ? '<i class="bi bi-x-octagon-fill"></i>' :
                st.level === 'low'      ? '<i class="bi bi-exclamation-triangle-fill"></i>' :
                                          '<i class="bi bi-check-circle-fill"></i>'}
              ${st.label}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Pagination
  renderStockPagination(totalRows, page, pageSize, pages);

  // Update sortable headers
  document.querySelectorAll('#stockTable th.sortable').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === col) {
      th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// Render kontrol pagination untuk tabel Stock Master
function renderStockPagination(total, page, pageSize, pages) {
  const info = document.getElementById('stockPaginationInfo');
  const ctrl = document.getElementById('stockPaginationControls');
  if (!info || !ctrl) return;

  const from = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const to   = Math.min(page * pageSize, total);
  info.textContent = `Menampilkan ${fmtNum(from)}-${fmtNum(to)} dari ${fmtNum(total)}`;

  let html = `<button class="page-btn" onclick="goToStockPage(${page-1})" ${page<=1?'disabled':''}>
    <i class="bi bi-chevron-left"></i></button>`;

  const maxBtn = 5;
  let startP = Math.max(1, page - 2);
  let endP   = Math.min(pages, startP + maxBtn - 1);
  if (endP - startP < maxBtn - 1) startP = Math.max(1, endP - maxBtn + 1);

  if (startP > 1) html += `<button class="page-btn" onclick="goToStockPage(1)">1</button>`;
  if (startP > 2) html += `<button class="page-btn" disabled>…</button>`;
  for (let p = startP; p <= endP; p++) {
    html += `<button class="page-btn ${p===page?'active':''}" onclick="goToStockPage(${p})">${p}</button>`;
  }
  if (endP < pages - 1) html += `<button class="page-btn" disabled>…</button>`;
  if (endP < pages) html += `<button class="page-btn" onclick="goToStockPage(${pages})">${pages}</button>`;

  html += `<button class="page-btn" onclick="goToStockPage(${page+1})" ${page>=pages?'disabled':''}>
    <i class="bi bi-chevron-right"></i></button>`;

  ctrl.innerHTML = html;
}

window.goToStockPage = function(p) {
  App.stock.currentPage = p;
  renderStockMasterPage();
};

// Pasang listener search, filter status, page size, dan sortable header Stock Master
function initStockMasterControls() {
  document.getElementById('stockSearch')?.addEventListener('input', () => {
    App.stock.currentPage = 1;
    renderStockMasterPage();
  });

  document.getElementById('stockFilterStatus')?.addEventListener('change', () => {
    App.stock.currentPage = 1;
    renderStockMasterPage();
  });

  document.getElementById('stockPageSize')?.addEventListener('change', (e) => {
    App.stock.pageSize    = parseInt(e.target.value);
    App.stock.currentPage = 1;
    renderStockMasterPage();
  });

  // Sortable headers untuk stock table
  document.querySelectorAll('#stockTable th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (App.stock.sortCol === col) {
        App.stock.sortDir = App.stock.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        App.stock.sortCol = col;
        App.stock.sortDir = col === 'stock' ? 'asc' : 'desc';
      }
      App.stock.currentPage = 1;
      renderStockMasterPage();
    });
  });
}

// ===================== ALERT SYSTEM =====================

/** Hitung semua item yang perlu alert */
function computeAlerts() {
  const threshold = App.settings.lowStockThreshold;
  const master    = buildStockMaster(App.data.outgoing);

  return master
    .map(item => ({ ...item, status: getStockStatus(item.stock, threshold) }))
    .filter(item => item.status.level === 'critical' ||
                    item.status.level === 'empty'    ||
                    item.status.level === 'low')
    .sort((a, b) => a.stock - b.stock);
}

/** Update badge alert di sidebar.
 *
 * Perilaku yang diinginkan: badge hilang permanen (untuk sesi ini) setelah
 * halaman Stock Master dibuka, TAPI kalau ada item kritis BARU yang sebelumnya
 * belum pernah kritis (dibanding terakhir kali badge dihitung), badge muncul
 * lagi otomatis — supaya peringatan baru tidak ter-mute selamanya hanya karena
 * pernah dibuka sebelumnya. Setelah reload/refresh browser, App.ui dibuat ulang
 * dari awal sehingga stockBadgeDismissed otomatis kembali false. */
// Update badge angka di nav Stock Master; deteksi item kritis baru
function updateAlertBadge() {
  const alerts   = computeAlerts();
  const critical = alerts.filter(a => a.status.level === 'critical' || a.status.level === 'empty');
  const badge    = document.getElementById('stockAlertBadge');

  const currentCriticalCodes = new Set(critical.map(a => a.item_code));

  // Cek apakah ada item kritis baru yang TIDAK ada di set terakhir yang sudah "dilihat"
  let hasNewCritical = false;
  currentCriticalCodes.forEach(code => {
    if (!App.ui.lastSeenCriticalCodes.has(code)) hasNewCritical = true;
  });

  // Item kritis baru → batalkan status "sudah dilihat", badge wajib muncul lagi
  if (hasNewCritical) {
    App.ui.stockBadgeDismissed = false;
  }

  if (badge) {
    if (App.ui.stockBadgeDismissed) {
      badge.style.display = 'none';
    } else if (critical.length > 0) {
      badge.textContent = critical.length;
      badge.style.display = '';
      badge.className = 'nav-alert-badge critical';
    } else if (alerts.length > 0) {
      badge.textContent = alerts.length;
      badge.style.display = '';
      badge.className = 'nav-alert-badge warning';
    } else {
      badge.style.display = 'none';
    }
  }

  // Simpan snapshot kode item kritis SAAT INI, agar pemanggilan berikutnya bisa
  // membandingkan dan mendeteksi item baru yang baru saja menjadi kritis.
  App.ui.lastSeenCriticalCodes = currentCriticalCodes;

  return alerts;
}

/** Tampilkan toast notification */
function showAlertToast(alerts) {
  const container = document.getElementById('alertToastContainer');
  if (!container) return;

  const critical = alerts.filter(a => a.status.level === 'critical' || a.status.level === 'empty');
  const low      = alerts.filter(a => a.status.level === 'low');

  // Jangan spam — hanya tampilkan kalau jumlah berubah
  const totalNow = alerts.length;
  if (totalNow === App.stock.lastAlertCount && App.stock.lastAlertCount > 0) return;
  App.stock.lastAlertCount = totalNow;

  if (totalNow === 0) return;

  const toastId = 'toast_' + Date.now();
  const toast   = document.createElement('div');
  toast.className = 'alert-toast' + (critical.length > 0 ? ' critical' : ' warning');
  toast.id = toastId;

  toast.innerHTML = `
    <div class="toast-header">
      <i class="bi bi-${critical.length > 0 ? 'exclamation-octagon-fill' : 'exclamation-triangle-fill'}"></i>
      <strong>${critical.length > 0 ? 'Stok Critical!' : 'Low Stock Alert'}</strong>
      <button class="toast-close" onclick="document.getElementById('${toastId}')?.remove()">
        <i class="bi bi-x"></i>
      </button>
    </div>
    <div class="toast-body">
      ${critical.length > 0 ? `<div class="toast-line critical">
        <i class="bi bi-x-octagon-fill"></i>
        <span>${critical.length} item Critical/Habis</span>
      </div>` : ''}
      ${low.length > 0 ? `<div class="toast-line warning">
        <i class="bi bi-exclamation-triangle-fill"></i>
        <span>${low.length} item Low Stock</span>
      </div>` : ''}
      <div class="toast-items">
        ${alerts.slice(0, 3).map(a =>
          `<span class="toast-item-tag ${a.status.level}">${a.item_code} (${a.stock})</span>`
        ).join('')}
        ${alerts.length > 3 ? `<span class="toast-item-tag more">+${alerts.length - 3} lainnya</span>` : ''}
      </div>
    </div>
    <button class="toast-action" onclick="navigateTo('stock'); document.getElementById('${toastId}')?.remove()">
      <i class="bi bi-arrow-right-circle"></i> Lihat Stock Master
    </button>
  `;

  container.appendChild(toast);

  // Auto dismiss setelah 8 detik
  setTimeout(() => {
    toast.classList.add('dismissing');
    setTimeout(() => toast.remove(), 400);
  }, 8000);
}

/** Jalankan alert check — dipanggil setelah data load & setiap auto refresh */
function runAlertCheck() {
  const alerts = updateAlertBadge();
  // Tampilkan toast hanya kalau ada alert
  if (alerts.length > 0) {
    showAlertToast(alerts);
  }
}

// ===================== TRANSACTION TABLE =====================

/** Render transaction monitoring page */
function renderTransactionPage() {
  // Sumber data sesuai tab aktif
  const tab  = App.ui.currentTrxTab || 'outgoing';
  const data = tab === 'expense'
    ? (App.data.filteredExpense.length > 0 ? App.data.filteredExpense : App.data.expense)
    : (App.data.filteredOutgoing.length > 0 ? App.data.filteredOutgoing : App.data.outgoing);

  // Sync active tab UI
  document.querySelectorAll('.trx-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const search    = (document.getElementById('trxSearch')?.value || '').toLowerCase();
  const machine   = document.getElementById('trxFilterMachine')?.value   || '';
  const requester = document.getElementById('trxFilterRequester')?.value || '';

  // Reset dropdown saat tab ganti supaya terisi ulang sesuai data tab
  populateFilterDropdowns(data, true);

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

// Isi dropdown filter mesin & requester dari data yang sedang ditampilkan
function populateFilterDropdowns(data, forceReset = false) {
  const mEl = document.getElementById('trxFilterMachine');
  const rEl = document.getElementById('trxFilterRequester');

  // Reset dropdown kalau forceReset (saat ganti tab)
  if (forceReset) {
    if (mEl) { while (mEl.options.length > 1) mEl.remove(1); }
    if (rEl) { while (rEl.options.length > 1) rEl.remove(1); }
  }

  if (mEl && mEl.options.length <= 1) {
    const fromData = data.map(r => r.machine).filter(Boolean);
    const fromSheet = (App.data.machineList || []).map(m => m.name).filter(Boolean);
    const machines = [...new Set([...fromData, ...fromSheet])].sort();
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

// Render kontrol pagination untuk tabel transaksi
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

// Export data transaksi yang sedang terfilter ke file CSV berformat Excel
function exportToExcel() {
  const rows = App.trxFilteredData || App.data.outgoing;
  if (!rows || rows.length === 0) return;

  const headers = ['date','item_code','item_name','qty','requester','machine','cost_allocation','stock'];
  const csvRows = [headers.join(',')];

  rows.forEach(r => {
    csvRows.push(headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','));
  });

  // Buat Blob CSV dengan BOM (\uFEFF) agar Excel bisa membaca encoding UTF-8 dengan benar
  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `inventory_outgoing_${todayStr().replace(/\//g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url); // Bebaskan memori URL sementara setelah download dipicu
}

// ===================== SORTING =====================

// Pasang listener klik header kolom sortable di tabel transaksi
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

// Navigasi ke halaman tertentu: cek izin role, tampilkan page, update breadcrumb
function navigateTo(page) {
  // Cek akses berdasarkan role — redirect ke dashboard kalau tidak boleh
  if (currentUser) {
    const perm = PERMISSIONS[currentUser.role] || PERMISSIONS.user;
    if (!perm.pages.includes(page)) {
      page = 'dashboard';
    }
  }

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
    stock:       'Stock Master',
    setting:     'Setting',
  };
  const icons = {
    dashboard:   'bi-speedometer2',
    machine:     'bi-gear-wide-connected',
    analytic:    'bi-bar-chart-line-fill',
    transaction: 'bi-table',
    stock:       'bi-box-seam-fill',
    setting:     'bi-sliders2',
  };

  const titleEl = document.getElementById('pageTitle');
  const iconEl  = document.querySelector('.breadcrumb-icon i');
  if (titleEl) titleEl.textContent = titles[page] || page;
  if (iconEl)  { iconEl.className = 'bi ' + (icons[page] || 'bi-grid'); }

  App.ui.currentPage = page;

  // Badge "Stock Master" di sidebar: tandai sudah dilihat begitu halaman ini
  // dibuka, lalu langsung sembunyikan tanpa menunggu siklus refresh berikutnya.
  if (page === 'stock' && !App.ui.stockBadgeDismissed) {
    App.ui.stockBadgeDismissed = true;
    const badge = document.getElementById('stockAlertBadge');
    if (badge) badge.style.display = 'none';
  }

  // Badge "NEW" di menu Analytic: sama, hilang permanen untuk sesi ini setelah dibuka.
  if (page === 'analytic' && !App.ui.analyticBadgeDismissed) {
    App.ui.analyticBadgeDismissed = true;
    const analyticBadge = document.getElementById('analyticBadge');
    if (analyticBadge) analyticBadge.style.display = 'none';
  }

  // Render page-specific content
  renderCurrentPage();

  // Close mobile sidebar
  document.getElementById('sidebar')?.classList.remove('mobile-open');
}

// Re-render konten halaman yang sedang aktif (dipanggil setelah filter/refresh)
function renderCurrentPage() {
  const data         = App.data.filtered;          // gabungan (machine, analytic)
  const dataOutgoing = App.data.filteredOutgoing;  // outgoing only (dashboard)

  switch (App.ui.currentPage) {
    case 'dashboard':
      // Dashboard HANYA pakai data outgoing — expense tidak masuk
      renderKPIs(dataOutgoing);
      renderTrendChart(dataOutgoing);
      renderMachineDonut(dataOutgoing);
      renderLowStock(dataOutgoing);
      renderRecentTransactions(dataOutgoing);
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
    case 'stock':
      renderStockMasterPage();
      break;
  }
}

// ===================== SIDEBAR TOGGLE =====================

// Pasang listener toggle sidebar (desktop collapse & mobile open/close)
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

// Pasang listener klik pada setiap item navigasi sidebar
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

// Pasang listener tombol filter tanggal di dashboard (apply, reset, quick range)
function initFilterControls() {
  // Quick filter buttons (rentang tanggal dashboard: Today/Week/Month/All)
  document.querySelectorAll('.qbtn:not(.trend-range-btn)').forEach(btn => {
    btn.addEventListener('click', () => setQuickRange(btn.dataset.range));
  });

  // Trend chart range buttons (3 / 7 / 30 / Semua) — khusus chart Trend Penggunaan Harian
  document.querySelectorAll('.trend-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      App.ui.trendRange = btn.dataset.trendRange === 'all' ? 'all' : parseInt(btn.dataset.trendRange);
      document.querySelectorAll('.trend-range-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderTrendChart(App.data.filteredOutgoing);
    });
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
    App.data.filteredOutgoing = [...App.data.outgoing];
    App.data.filteredExpense  = [...App.data.expense];
    document.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
    document.querySelector('.qbtn[data-range="all"]')?.classList.add('active');
    renderCurrentPage();
  });
}

// ===================== TRANSACTION SEARCH/FILTER =====================

// Pasang listener semua kontrol di halaman transaksi (tab, search, filter, export)
function initTransactionControls() {
  // Tab switch — Outgoing vs Expense
  document.querySelectorAll('.trx-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      App.ui.currentTrxTab  = btn.dataset.tab;
      App.ui.currentTrxPage = 1;
      // Reset search & filter saat ganti tab
      const searchEl = document.getElementById('trxSearch');
      const machineEl = document.getElementById('trxFilterMachine');
      const requesterEl = document.getElementById('trxFilterRequester');
      if (searchEl) searchEl.value = '';
      if (machineEl) machineEl.value = '';
      if (requesterEl) requesterEl.value = '';
      renderTransactionPage();
    });
  });

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

// Inisialisasi toggle dark/light mode dari navbar dan halaman Setting
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

const SETTINGS_KEY = 'btkch_dashboard_settings'; // Key localStorage untuk menyimpan pengaturan aplikasi

/** Simpan semua settings ke localStorage */
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      lowStockThreshold:    App.settings.lowStockThreshold,
      autoRefresh:          App.settings.autoRefresh,
      refreshInterval:      App.settings.refreshInterval,
      darkMode:             App.settings.darkMode,
      forecastWindowDays:   App.settings.forecastWindowDays,
      forecastCriticalDays: App.settings.forecastCriticalDays,
      forecastWarningDays:  App.settings.forecastWarningDays,
    }));
  } catch(e) { console.warn('saveSettings failed:', e); }
}

/** Load settings dari localStorage, apply ke App.settings & UI */
function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;
    const s = JSON.parse(saved);

    if (s.lowStockThreshold    != null) App.settings.lowStockThreshold    = s.lowStockThreshold;
    if (s.autoRefresh          != null) App.settings.autoRefresh          = s.autoRefresh;
    if (s.refreshInterval      != null) App.settings.refreshInterval      = s.refreshInterval;
    if (s.darkMode             != null) App.settings.darkMode             = s.darkMode;
    if (s.forecastWindowDays   != null) App.settings.forecastWindowDays   = s.forecastWindowDays;
    if (s.forecastCriticalDays != null) App.settings.forecastCriticalDays = s.forecastCriticalDays;
    if (s.forecastWarningDays  != null) App.settings.forecastWarningDays  = s.forecastWarningDays;
  } catch(e) { console.warn('loadSettings failed:', e); }
}

/** Sinkronkan nilai App.settings ke elemen-elemen UI di halaman Setting */
function syncSettingsUI() {
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  const refreshIntervalEl = document.getElementById('refreshInterval');
  const lowStockInput     = document.getElementById('lowStockThreshold');
  const darkModeToggle    = document.getElementById('darkModeToggleSetting');
  const forecastWindowEl    = document.getElementById('forecastWindowDays');
  const forecastCriticalEl  = document.getElementById('forecastCriticalDays');
  const forecastWarningEl   = document.getElementById('forecastWarningDays');

  if (autoRefreshToggle) autoRefreshToggle.checked = App.settings.autoRefresh;
  if (refreshIntervalEl) refreshIntervalEl.value   = String(App.settings.refreshInterval);
  if (lowStockInput)     lowStockInput.value        = String(App.settings.lowStockThreshold);
  if (darkModeToggle)    darkModeToggle.checked     = App.settings.darkMode;
  if (forecastWindowEl)   forecastWindowEl.value   = String(App.settings.forecastWindowDays);
  if (forecastCriticalEl) forecastCriticalEl.value = String(App.settings.forecastCriticalDays);
  if (forecastWarningEl)  forecastWarningEl.value  = String(App.settings.forecastWarningDays);
}

// ===================== SETTINGS PAGE =====================

// Inisialisasi semua listener di halaman Setting (auto refresh, threshold, dll.)
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
      clearInterval(App.intervals.refresh); // Hentikan interval refresh lama sebelum membuat yang baru
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
    renderLowStock(App.data.filteredOutgoing);
    runAlertCheck();
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

  // Stockout forecast settings
  document.getElementById('saveForecastSettings')?.addEventListener('click', () => {
    const windowVal   = Math.max(7, parseInt(document.getElementById('forecastWindowDays')?.value || '30'));
    let   criticalVal = Math.max(1, parseInt(document.getElementById('forecastCriticalDays')?.value || '21'));
    let   warningVal  = Math.max(1, parseInt(document.getElementById('forecastWarningDays')?.value || '30'));

    // Validasi: ambang Perhatian harus >= ambang Kritis, kalau tidak logikanya
    // terbalik (item yang seharusnya "lebih aman" malah dianggap kritis).
    // Daripada menolak diam-diam, kita perbaiki otomatis & beri tahu pengguna.
    let adjusted = false;
    if (warningVal < criticalVal) {
      warningVal = criticalVal;
      adjusted = true;
    }

    App.settings.forecastWindowDays   = windowVal;
    App.settings.forecastCriticalDays = criticalVal;
    App.settings.forecastWarningDays  = warningVal;
    saveSettings();

    // Sinkronkan kembali ke input (terutama kalau warningVal sempat dikoreksi)
    syncSettingsUI();

    // Re-render Stock Master kalau halaman itu sedang aktif, supaya forecast
    // langsung kelihatan pakai ambang batas yang baru tanpa perlu reload.
    if (App.ui.currentPage === 'stock') renderStockMasterPage();

    const btn = document.getElementById('saveForecastSettings');
    const orig = btn.innerHTML;
    btn.innerHTML = adjusted
      ? '<i class="bi bi-info-circle-fill"></i> Disesuaikan & disimpan'
      : '<i class="bi bi-check-circle-fill"></i> Tersimpan!';
    btn.style.background = adjusted
      ? 'linear-gradient(135deg, #f59e0b, #d97706)'
      : 'linear-gradient(135deg, #10b981, #059669)';
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.style.background = '';
    }, 2500);
  });

  // Catatan: listener untuk darkModeToggleSetting SUDAH dipasang di initDarkMode().
  // Sebelumnya ada listener kedua di sini yang mensimulasikan klik ke darkmodeBtn,
  // dan itu menyebabkan toggle langsung berbalik lagi setelah diklik (dua listener
  // saling timpa dalam satu siklus event). Sengaja tidak dipasang ulang di sini.
}

// ===================== AUTO REFRESH =====================

// Mulai interval auto refresh data CSV sesuai App.settings.refreshInterval
function startAutoRefresh() {
  clearInterval(App.intervals.refresh);
  if (!App.settings.autoRefresh) return;

  App.intervals.refresh = setInterval(async () => {
    const icon = document.getElementById('refreshIcon');
    if (icon) icon.classList.add('spinning');

    await loadAllData();
    applyDateFilter();
    runAlertCheck();  // Update alert badge & toast setelah refresh

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
  initStockMasterControls();
  initDataStatusBanner();

  // 5. Run animation AND load data in parallel
  await Promise.all([
    runLoadingSequence(),
    loadAllData(),
  ]);

  // 6. Both done — finish animation, then render
  App.data.filtered         = getAllData();
  App.data.filteredOutgoing = [...App.data.outgoing];
  App.data.filteredExpense  = [...App.data.expense];
  finishLoading();

  setTimeout(() => {
    navigateTo('dashboard');
    startAutoRefresh();
    // Alert check setelah data pertama kali load
    setTimeout(runAlertCheck, 600);
  }, 400);
}

// Entry point aplikasi: clear session lama, init login, tampilkan layar login
async function init() {
  // Selalu tampilkan login screen — tidak ada auto-login dari session
  clearSession();
  initLogin();
  showLoginScreen();
}

// ===================== BOOT =====================
document.addEventListener('DOMContentLoaded', init); // Jalankan init() saat DOM selesai dimuat browser