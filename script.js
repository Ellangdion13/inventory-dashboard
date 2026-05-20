// =========================
// script.js
// =========================

let rawData = [];
let filteredData = [];

let charts = {};

async function loadCSV(){

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

function updateDashboard(){

  updateKPI();
  renderCharts();
  renderTable();

}

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

function renderCharts(){

  Object.values(charts)
  .forEach(chart => chart.destroy());

  // TOP ITEM

  const itemMap = {};

  filteredData.forEach(d=>{

    const item = d["Kode Item"];

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

          borderRadius:12

        }]

      },

      options:chartStyle()

    }

  );

  // DAILY TREND

  const dailyMap = {};

  filteredData.forEach(d=>{

    const date = d.Tanggal;

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

          backgroundColor:'rgba(0,194,255,.15)',

          fill:true,

          tension:.4,

          pointRadius:4

        }]

      },

      options:chartStyle()

    }

  );

  // AREA

  const areaMap = {};

  filteredData.forEach(d=>{

    const area = d["Mesin/Area"];

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
          ]

        }]

      },

      options:chartStyle()

    }

  );

  // REQUESTER

  const reqMap = {};

  filteredData.forEach(d=>{

    const req = d.Pemohon;

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

          borderRadius:10

        }]

      },

      options:{

        ...chartStyle(),

        indexAxis:'y'

      }

    }

  );

}

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

loadCSV();

setInterval(loadCSV,5000);
