// =========================
// script.js
// =========================

let rawData = [];
let filteredData = [];

let charts = {};

// =========================
// LOAD CSV
// =========================

async function loadCSV(){

  try{

    const response = await fetch(
      `outgoing.csv?v=${Date.now()}`,
      {
        cache:"no-store"
      }
    );

    const csvText = await response.text();

    Papa.parse(csvText,{

      header:true,
      skipEmptyLines:true,

      complete:function(results){

        rawData = results.data.filter(row =>
          row["Kode Item"] &&
          row["Kode Item"].trim() !== ""
        );

        filteredData = [...rawData];

        updateDashboard();

      }

    });

  }

  catch(err){

    console.error("CSV Load Error:",err);

  }

}

// =========================
// UPDATE DASHBOARD
// =========================

function updateDashboard(){

  updateKPI();
  renderCharts();
  renderTable();

}

// =========================
// KPI
// =========================

function updateKPI(){

  document.getElementById("totalTransaction")
  .innerText =
  filteredData.length.toLocaleString();

  const totalQty = filteredData.reduce(
    (sum,row)=>
    sum + Number(row.Qty || 0),
    0
  );

  document.getElementById("totalQty")
  .innerText =
  totalQty.toLocaleString();

  const unique = new Set(
    filteredData.map(d=>d["Kode Item"])
  );

  document.getElementById("totalItem")
  .innerText =
  unique.size;

  const lowStock =
    filteredData.filter(d =>
      Number(d["Actual Stock"]) <= 5
    );

  document.getElementById("lowStock")
  .innerText =
  lowStock.length;

}

// =========================
// RENDER CHARTS
// =========================

function renderCharts(){

  // DESTROY OLD CHARTS

  Object.values(charts).forEach(chart => {

    if(chart){
      chart.destroy();
    }

  });

  // =========================
  // TOP ITEM
  // =========================

  const itemMap = {};

  filteredData.forEach(d=>{

    const item =
    d["Kode Item"] || "UNKNOWN";

    itemMap[item] =
    (itemMap[item] || 0)
    + Number(d.Qty || 0);

  });

  const sortedItems =
    Object.entries(itemMap)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);

  charts.top = new Chart(

    document.getElementById("topItemChart"),

    {

      type:'bar',

      data:{

        labels:sortedItems.map(i=>i[0]),

        datasets:[{

          data:sortedItems.map(i=>i[1]),

          backgroundColor:[
            '#00c2ff',
            '#009dff',
            '#0077ff',
            '#5c6cff',
            '#00ffe1'
          ],

          borderRadius:12,
          borderSkipped:false

        }]

      },

      options:chartStyle()

    }

  );

  // =========================
  // DAILY TREND
  // =========================

  const dailyMap = {};

  filteredData.forEach(d=>{

    const date =
    d.Tanggal || "UNKNOWN";

    dailyMap[date] =
    (dailyMap[date] || 0) + 1;

  });

  charts.daily = new Chart(

    document.getElementById("dailyTrendChart"),

    {

      type:'line',

      data:{

        labels:Object.keys(dailyMap),

        datasets:[{

          data:Object.values(dailyMap),

          borderColor:'#00c2ff',

          backgroundColor:
          'rgba(0,194,255,.15)',

          fill:true,

          tension:.4,

          pointRadius:4,

          pointBackgroundColor:'#00c2ff'

        }]

      },

      options:chartStyle()

    }

  );

  // =========================
  // AREA
  // =========================

  const areaMap = {};

  filteredData.forEach(d=>{

    const area =
    d["Mesin/Area"] || "UNKNOWN";

    areaMap[area] =
    (areaMap[area] || 0) + 1;

  });

  charts.area = new Chart(

    document.getElementById("areaChart"),

    {

      type:'doughnut',

      data:{

        labels:Object.keys(areaMap),

        datasets:[{

          data:Object.values(areaMap),

          backgroundColor:[
            '#00c2ff',
            '#0077ff',
            '#5c6cff',
            '#00ffe1',
            '#ff9800'
          ],

          borderWidth:0

        }]

      },

      options:{

        responsive:true,

        maintainAspectRatio:false,

        plugins:{

          legend:{
            labels:{
              color:'#93a4b7'
            }
          }

        }

      }

    }

  );

  // =========================
  // REQUESTER
  // =========================

  const reqMap = {};

  filteredData.forEach(d=>{

    const req =
    d.Pemohon || "UNKNOWN";

    reqMap[req] =
    (reqMap[req] || 0) + 1;

  });

  const sortedReq =
    Object.entries(reqMap)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10);

  charts.req = new Chart(

    document.getElementById("requesterChart"),

    {

      type:'bar',

      data:{

        labels:sortedReq.map(i=>i[0]),

        datasets:[{

          data:sortedReq.map(i=>i[1]),

          backgroundColor:'#5c6cff',

          borderRadius:10,

          borderSkipped:false,

          barThickness:18,

          maxBarThickness:20

        }]

      },

      options:{

        ...chartStyle(),

        indexAxis:'y',

        plugins:{
          legend:{
            display:false
          }
        },

        scales:{

          x:{
            ticks:{
              color:'#93a4b7'
            },

            grid:{
              color:'rgba(255,255,255,.04)'
            }
          },

          y:{

            ticks:{
              color:'#93a4b7',

              autoSkip:false,

              font:{
                size:11
              }
            },

            grid:{
              display:false
            }

          }

        }

      }

    }

  );

}

// =========================
// CHART STYLE
// =========================

function chartStyle(){

  return {

    responsive:true,

    maintainAspectRatio:false,

    plugins:{

      legend:{

        labels:{
          color:'#93a4b7'
        }

      }

    },

    scales:{

      x:{

        ticks:{
          color:'#93a4b7'
        },

        grid:{
          color:'rgba(255,255,255,.04)'
        }

      },

      y:{

        ticks:{
          color:'#93a4b7'
        },

        grid:{
          color:'rgba(255,255,255,.04)'
        }

      }

    }

  };

}

// =========================
// TABLE
// =========================

function renderTable(){

  const tbody =
  document.getElementById("tableBody");

  tbody.innerHTML = "";

  filteredData.forEach(row=>{

    const lowStock =
    Number(row["Actual Stock"]) <= 5
    ? 'low-stock'
    : '';

    tbody.innerHTML += `

      <tr>

        <td>${row.Tanggal || '-'}</td>

        <td>${row["Kode Item"] || '-'}</td>

        <td>${row.Deskripsi || '-'}</td>

        <td>${row.Qty || 0}</td>

        <td>${row["Mesin/Area"] || '-'}</td>

        <td>${row.Pemohon || '-'}</td>

        <td class="${lowStock}">
          ${row["Actual Stock"] || 0}
        </td>

      </tr>

    `;

  });

}

// =========================
// FILTER
// =========================

function applyFilters(){

  const date =
  document.getElementById("filterDate")
  .value.toLowerCase();

  const item =
  document.getElementById("filterItem")
  .value.toLowerCase();

  const area =
  document.getElementById("filterArea")
  .value.toLowerCase();

  const requester =
  document.getElementById("filterRequester")
  .value.toLowerCase();

  filteredData = rawData.filter(row => {

    return (

      (!date ||
      row.Tanggal?.toLowerCase().includes(date))

      &&

      (!item ||
      row["Kode Item"]?.toLowerCase().includes(item))

      &&

      (!area ||
      row["Mesin/Area"]?.toLowerCase().includes(area))

      &&

      (!requester ||
      row.Pemohon?.toLowerCase().includes(requester))

    );

  });

  updateDashboard();

}

// =========================
// SEARCH TABLE
// =========================

document
.getElementById("searchInput")
.addEventListener("keyup",function(){

  const keyword =
  this.value.toLowerCase();

  const rows =
  document.querySelectorAll("#tableBody tr");

  rows.forEach(row=>{

    row.style.display =
    row.innerText
    .toLowerCase()
    .includes(keyword)
    ? ''
    : 'none';

  });

});

// =========================
// CLOCK
// =========================

function updateClock(){

  const now = new Date();

  document.getElementById("clock")
  .innerText =
  now.toLocaleTimeString();

  document.getElementById("date")
  .innerText =
  now.toDateString();

}

setInterval(updateClock,1000);

updateClock();

// =========================
// INITIAL LOAD
// =========================

loadCSV();

// =========================
// AUTO REFRESH
// =========================

setInterval(async ()=>{

  try{

    await loadCSV();

  }

  catch(err){

    console.log(err);

  }

},5000);
