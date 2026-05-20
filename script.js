let rawData = [];
let filteredData = [];

let charts = {};

async function loadCSV() {
  const response = await fetch("outgoing.csv?t=" + new Date().getTime());
  const csvText = await response.text();

  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      rawData = results.data;
      filteredData = [...rawData];

      updateDashboard();

      document.getElementById("loadingScreen").style.display = "none";
    }
  });
}

function updateDashboard() {
  updateKPI();
  renderCharts();
  renderTable();
  renderAnalysis();
  renderRecentActivity();
}

function updateKPI() {

  const totalTransaksi = filteredData.length;

  const totalQty = filteredData.reduce((sum, row) => {
    return sum + Number(row.Qty || 0);
  }, 0);

  const uniqueItems = new Set(filteredData.map(d => d["Kode Item"]));

  const today = new Date().toISOString().split("T")[0];

  const todayData = filteredData.filter(d =>
    d.Tanggal?.includes(today)
  );

  const todayQty = todayData.reduce((sum, row) =>
    sum + Number(row.Qty || 0), 0);

  const itemCount = {};

  filteredData.forEach(row => {
    const item = row["Kode Item"];
    itemCount[item] = (itemCount[item] || 0) + Number(row.Qty || 0);
  });

  const topItem = Object.keys(itemCount).sort((a,b)=>itemCount[b]-itemCount[a])[0] || "-";

  const lowStock = filteredData.filter(d =>
    Number(d["Actual Stock"]) <= 5
  ).length;

  animateValue("totalTransaksi", totalTransaksi);
  animateValue("totalQty", totalQty);
  animateValue("jenisItem", uniqueItems.size);
  animateValue("todayTransaction", todayData.length);
  animateValue("todayQty", todayQty);

  document.getElementById("topItem").innerText = topItem;
  document.getElementById("criticalPart").innerText = topItem;
  document.getElementById("lowStock").innerText = lowStock;
}

function animateValue(id, end) {
  const obj = document.getElementById(id);
  let start = 0;

  const duration = 800;
  const increment = end / (duration / 16);

  const timer = setInterval(() => {
    start += increment;

    if(start >= end){
      start = end;
      clearInterval(timer);
    }

    obj.innerText = Math.floor(start).toLocaleString();
  },16);
}

function renderCharts() {

  Object.values(charts).forEach(chart => chart.destroy());

  // TOP ITEMS
  const itemMap = {};

  filteredData.forEach(d => {
    const item = d["Kode Item"];
    itemMap[item] = (itemMap[item] || 0) + Number(d.Qty || 0);
  });

  const sortedItems = Object.entries(itemMap)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);

  charts.topItems = new Chart(
    document.getElementById("topItemsChart"),
    {
      type:'bar',
      data:{
        labels:sortedItems.map(i=>i[0]),
        datasets:[{
          label:'Qty',
          data:sortedItems.map(i=>i[1]),
          backgroundColor:'#00b4ff'
        }]
      }
    }
  );

  // DAILY TREND
  const dailyMap = {};

  filteredData.forEach(d=>{
    const date = d.Tanggal;
    dailyMap[date] = (dailyMap[date] || 0) + 1;
  });

  charts.daily = new Chart(
    document.getElementById("dailyTrendChart"),
    {
      type:'line',
      data:{
        labels:Object.keys(dailyMap),
        datasets:[{
          label:'Transaction',
          data:Object.values(dailyMap),
          borderColor:'#00e5ff',
          fill:false,
          tension:.4
        }]
      }
    }
  );

  // AREA
  const areaMap = {};

  filteredData.forEach(d=>{
    const area = d["Mesin/Area"];
    areaMap[area] = (areaMap[area] || 0) + 1;
  });

  charts.area = new Chart(
    document.getElementById("areaChart"),
    {
      type:'doughnut',
      data:{
        labels:Object.keys(areaMap),
        datasets:[{
          data:Object.values(areaMap)
        }]
      }
    }
  );

  // REQUESTER
  const reqMap = {};

  filteredData.forEach(d=>{
    const req = d["Pemohon"];
    reqMap[req] = (reqMap[req] || 0) + 1;
  });

  const sortedReq = Object.entries(reqMap)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);

  charts.req = new Chart(
    document.getElementById("requesterChart"),
    {
      type:'bar',
      data:{
        labels:sortedReq.map(i=>i[0]),
        datasets:[{
          label:'Request',
          data:sortedReq.map(i=>i[1]),
          backgroundColor:'#ff9800'
        }]
      },
      options:{
        indexAxis:'y'
      }
    }
  );

  // COST
  const costMap = {};

  filteredData.forEach(d=>{
    const cost = d["Cost Allocation"];
    costMap[cost] = (costMap[cost] || 0) + Number(d.Qty || 0);
  });

  charts.cost = new Chart(
    document.getElementById("costChart"),
    {
      type:'bar',
      data:{
        labels:Object.keys(costMap),
        datasets:[{
          label:'Qty',
          data:Object.values(costMap),
          backgroundColor:'#7c4dff'
        }]
      }
    }
  );
}

function renderTable() {

  const tbody = document.getElementById("tableBody");

  tbody.innerHTML = "";

  filteredData.forEach(row => {

    tbody.innerHTML += `
      <tr>
        <td>${row.Tanggal || '-'}</td>
        <td>${row["Kode Item"] || '-'}</td>
        <td>${row.Deskripsi || '-'}</td>
        <td>${row.Qty || 0}</td>
        <td>${row.UOM || '-'}</td>
        <td>${row["Mesin/Area"] || '-'}</td>
        <td>${row.Pemohon || '-'}</td>
        <td>${row["Actual Stock"] || 0}</td>
      </tr>
    `;

  });

}

function renderAnalysis() {

  const map = {};

  filteredData.forEach(d=>{

    const item = d["Kode Item"];
    const qty = Number(d.Qty || 0);

    map[item] = (map[item] || 0) + qty;

  });

  const total = Object.values(map).reduce((a,b)=>a+b,0);

  const tbody = document.getElementById("analysisTable");

  tbody.innerHTML = "";

  Object.entries(map)
    .sort((a,b)=>b[1]-a[1])
    .forEach(([item,qty])=>{

      let category = "SLOW MOVING";

      if(qty > 100){
        category = "CRITICAL PART";
      } else if(qty > 40){
        category = "ROUTINE PART";
      }

      const percent = ((qty/total)*100).toFixed(1);

      tbody.innerHTML += `
        <tr>
          <td>${item}</td>
          <td>${qty}</td>
          <td>${category}</td>
          <td>
            <div class="progress-bar">
              <div class="progress" style="width:${percent}%"></div>
            </div>
            ${percent}%
          </td>
        </tr>
      `;

    });

}

function renderRecentActivity(){

  const recent = [...filteredData].reverse().slice(0,10);

  const container = document.getElementById("recentActivity");

  container.innerHTML = "";

  recent.forEach(r=>{

    container.innerHTML += `
      <div class="activity-item">
        <strong>${r["Kode Item"]}</strong><br>
        Qty: ${r.Qty} |
        ${r["Mesin/Area"]}
      </div>
    `;

  });

}

function applyFilters(){

  const date = document.getElementById("filterDate").value;
  const item = document.getElementById("filterItem").value.toLowerCase();
  const area = document.getElementById("filterArea").value.toLowerCase();
  const requester = document.getElementById("filterRequester").value.toLowerCase();

  filteredData = rawData.filter(row=>{

    return (
      (!date || row.Tanggal?.includes(date)) &&
      (!item || row["Kode Item"]?.toLowerCase().includes(item)) &&
      (!area || row["Mesin/Area"]?.toLowerCase().includes(area)) &&
      (!requester || row.Pemohon?.toLowerCase().includes(requester))
    );

  });

  updateDashboard();

}

function resetFilters(){

  document.getElementById("filterDate").value = "";
  document.getElementById("filterItem").value = "";
  document.getElementById("filterArea").value = "";
  document.getElementById("filterRequester").value = "";

  filteredData = [...rawData];

  updateDashboard();

}

document.getElementById("searchInput")
.addEventListener("keyup", function(){

  const keyword = this.value.toLowerCase();

  const rows = document.querySelectorAll("#tableBody tr");

  rows.forEach(row=>{
    row.style.display =
      row.innerText.toLowerCase().includes(keyword)
      ? ""
      : "none";
  });

});

function exportExcel(){

  const ws = XLSX.utils.json_to_sheet(filteredData);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, "Inventory");

  XLSX.writeFile(wb, "inventory_dashboard.xlsx");

}

function exportPDF(){

  const element = document.body;

  html2pdf()
    .from(element)
    .save("inventory_dashboard.pdf");

}

function updateClock(){

  const now = new Date();

  document.getElementById("clock").innerText =
    now.toLocaleTimeString();

  document.getElementById("date").innerText =
    now.toDateString();

}

setInterval(updateClock,1000);

updateClock();

loadCSV();

// AUTO REFRESH
setInterval(loadCSV,30000);