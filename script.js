const dataFile        = "data/final_project_data.csv";
const countyDataFile  = "data/county_data.csv";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const STATE_COLORS = {
  Iowa:   "#e6a817",
  Kansas: "#4caf50",
  Texas:  "#e07b6a"
};

const STATE_CROPS = {
  Iowa:   "Corn",
  Kansas: "Wheat",
  Texas:  "Cotton"
};

const STATE_FIPS = {
  Iowa:   "19",
  Kansas: "20",
  Texas:  "48"
};

const VAR_LABELS = {
  NDVI:          "Vegetation Index (NDVI)",
  LST_Day:       "Land Surface Temp — Day (°C)",
  LST_Night:     "Land Surface Temp — Night (°C)",
  Precipitation: "Precipitation (mm)"
};

const tooltip = d3.select("#tooltip");

let allData    = [];
let countyData = [];
let currentVar   = "LST_Day";
let currentMonth = 7;
let usTopoCache  = null;
let scatterActiveState = "All";

// ── GEO CACHE ────────────────────────────────────────────────────────────────

function getUsTopo() {
  if (usTopoCache) return Promise.resolve(usTopoCache);
  return d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json").then(us => {
    usTopoCache = us;
    return us;
  });
}

// ── LOAD DATA ────────────────────────────────────────────────────────────────

Promise.all([
  d3.csv(dataFile, d => ({
    state:         d.state,
    month:         +d.month,
    NDVI:          +d.NDVI,
    LST_Day:       +d.LST_Day,
    LST_Night:     +d.LST_Night,
    Precipitation: +d.Precipitation,
    state_crop:    d.state_crop
  })),
  d3.csv(countyDataFile, d => ({
    GEOID:         d.GEOID,
    county:        d.county,
    state:         d.state,
    month:         +d.month,
    NDVI:          +d.NDVI,
    LST_Day:       +d.LST_Day,
    LST_Night:     +d.LST_Night,
    Precipitation: +d.Precipitation,
    state_crop:    d.state_crop
  })),
  getUsTopo()
]).then(([stateData, cData]) => {
  allData    = stateData;
  countyData = cData;

  drawUSMap();
  drawChoropleth();
  drawLineCharts();
  buildScatterButtons();
  drawScatter("scatter-lst",    "LST_Day");
  drawScatter("scatter-precip", "Precipitation");

  d3.select("#variable-select").on("change", function() {
    currentVar = this.value;
    updateChoroTitles();
    drawChoropleth();
    drawLineCharts();
  });

  d3.select("#month-slider").on("input", function() {
    currentMonth = +this.value;
    d3.select("#month-label").text(MONTHS[currentMonth - 1]);
    updateChoroTitles();
    drawChoropleth();
  });
});

// ── HELPERS ──────────────────────────────────────────────────────────────────

function showTooltip(html, event) {
  tooltip
    .style("opacity", 1)
    .html(html)
    .style("left", (event.pageX + 14) + "px")
    .style("top",  (event.pageY - 28) + "px");
}
function moveTooltip(event) {
  tooltip
    .style("left", (event.pageX + 14) + "px")
    .style("top",  (event.pageY - 28) + "px");
}
function hideTooltip() {
  tooltip.style("opacity", 0);
}

function colorScaleFor(variable) {
  const extent = d3.extent(countyData, d => d[variable]);
  if (variable === "NDVI")
    return d3.scaleSequential(d3.interpolateGreens).domain(extent);
  if (variable.startsWith("LST"))
    return d3.scaleSequential(d3.interpolateOranges).domain(extent);
  return d3.scaleSequential(d3.interpolateBlues).domain(extent);
}

function updateChoroTitles() {
  const month = MONTHS[currentMonth - 1];
  d3.select("#choro-left-title").text(`${VAR_LABELS[currentVar]} · ${month}`);
  d3.select("#choro-right-title").text(`Vegetation Index (NDVI) · ${month}`);
  d3.select("#line-left-title").text(`${VAR_LABELS[currentVar]} · Monthly`);
}

// ── US MAP ───────────────────────────────────────────────────────────────────

function drawUSMap() {
  const us = usTopoCache;
  const container = document.getElementById("us-map");
  const W = container.clientWidth || 860;
  const H = Math.round(W * 0.56);

  d3.select("#us-map").selectAll("*").remove();

  const svg = d3.select("#us-map")
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("class", "map-svg");

  const states = topojson.feature(us, us.objects.states);
  const projection = d3.geoAlbersUsa().fitSize([W, H], states);
  const path = d3.geoPath().projection(projection);

  const fipsToState = {};
  Object.entries(STATE_FIPS).forEach(([s, id]) => fipsToState[id] = s);

  svg.selectAll("path")
    .data(states.features)
    .join("path")
    .attr("d", path)
    .attr("class", d => {
      const id = String(d.id).padStart(2, "0");
      if (id === "19") return "state-iowa";
      if (id === "20") return "state-kansas";
      if (id === "48") return "state-texas";
      return "state-default";
    })
    .on("mouseover", function(event, d) {
      const id = String(d.id).padStart(2, "0");
      const name = fipsToState[id];
      if (!name) return;
      const rows = allData.filter(r => r.state === name);
      const avgNDVI   = d3.mean(rows, r => r.NDVI).toFixed(3);
      const avgLST    = d3.mean(rows, r => r.LST_Day).toFixed(1);
      const avgPrecip = d3.mean(rows, r => r.Precipitation).toFixed(1);
      showTooltip(`
        <strong>${name} — ${STATE_CROPS[name]}</strong><br>
        Avg NDVI: ${avgNDVI}<br>
        Avg LST Day: ${avgLST} °C<br>
        Avg Precipitation: ${avgPrecip} mm
      `, event);
    })
    .on("mousemove", moveTooltip)
    .on("mouseout", hideTooltip);

  states.features.forEach(f => {
    const id = String(f.id).padStart(2, "0");
    const name = fipsToState[id];
    if (!name) return;
    const c = path.centroid(f);
    if (!c || isNaN(c[0])) return;
    svg.append("text")
      .attr("x", c[0]).attr("y", c[1] - 4)
      .attr("text-anchor", "middle")
      .attr("fill", STATE_COLORS[name])
      .attr("font-size", 13).attr("font-weight", 700)
      .attr("pointer-events", "none")
      .text(name);
    svg.append("text")
      .attr("x", c[0]).attr("y", c[1] + 12)
      .attr("text-anchor", "middle")
      .attr("fill", STATE_COLORS[name])
      .attr("font-size", 10)
      .attr("pointer-events", "none")
      .text(STATE_CROPS[name]);
  });
}

// ── CHOROPLETH ───────────────────────────────────────────────────────────────

function drawChoropleth() {
  renderChoro("choro-left",  "legend-left",  currentVar, currentMonth);
  renderChoro("choro-right", "legend-right", "NDVI",     currentMonth);
}

function renderChoro(containerId, legendId, variable, month) {
  const us = usTopoCache;
  if (!us) return;

  d3.select(`#${containerId}`).selectAll("*").remove();
  d3.select(`#${legendId}`).selectAll("*").remove();

  const container = document.getElementById(containerId);
  const W = container.clientWidth || 460;
  const H = Math.round(W * 0.7);

  const colorScale = colorScaleFor(variable);
  const extent = d3.extent(countyData, d => d[variable]);

  const allCounties = topojson.feature(us, us.objects.counties);
  const allStates   = topojson.feature(us, us.objects.states);
  const targetStateFips = new Set(Object.values(STATE_FIPS));

  const threeCounties = allCounties.features.filter(f => {
    const statefp = String(f.id).padStart(5, "0").slice(0, 2);
    return targetStateFips.has(statefp);
  });

  const threeStates = allStates.features.filter(f =>
    targetStateFips.has(String(f.id).padStart(2, "0"))
  );

  const monthRows = countyData.filter(d => d.month === month);
  const lookup = {};
  monthRows.forEach(d => { lookup[d.GEOID] = d; });

  const svg = d3.select(`#${containerId}`)
    .append("svg")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .attr("class", "choro-svg");

  const projection = d3.geoAlbersUsa()
    .fitSize([W - 10, H - 10], { type: "FeatureCollection", features: threeStates });
  projection.translate([
    projection.translate()[0] + 5,
    projection.translate()[1] + 5
  ]);
  const path = d3.geoPath().projection(projection);

  svg.selectAll("path.county")
    .data(threeCounties)
    .join("path")
    .attr("class", "county")
    .attr("d", path)
    .attr("fill", f => {
      const geoid = String(f.id).padStart(5, "0");
      const row = lookup[geoid];
      return row ? colorScale(row[variable]) : "#ddd";
    })
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.3)
    .on("mouseover", function(event, f) {
      const geoid = String(f.id).padStart(5, "0");
      const row = lookup[geoid];
      if (!row) return;
      d3.select(this).attr("stroke-width", 1.5).attr("stroke", "#333");
      showTooltip(`
        <strong>${row.county}, ${row.state}</strong><br>
        ${VAR_LABELS[variable]}: ${row[variable].toFixed(2)}<br>
        Month: ${MONTHS[month - 1]}
      `, event);
    })
    .on("mousemove", moveTooltip)
    .on("mouseout", function() {
      d3.select(this).attr("stroke-width", 0.3).attr("stroke", "#fff");
      hideTooltip();
    });

  svg.selectAll("path.state-border")
    .data(threeStates)
    .join("path")
    .attr("class", "state-border")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#333")
    .attr("stroke-width", 1.5)
    .attr("pointer-events", "none");

  threeStates.forEach(f => {
    const id = String(f.id).padStart(2, "0");
    const name = Object.entries(STATE_FIPS).find(([s, fip]) => fip === id)?.[0];
    if (!name) return;
    const c = path.centroid(f);
    if (!c || isNaN(c[0])) return;
    svg.append("text")
      .attr("x", c[0]).attr("y", c[1])
      .attr("text-anchor", "middle")
      .attr("fill", "#222").attr("font-size", 12).attr("font-weight", 700)
      .attr("pointer-events", "none")
      .text(name);
    svg.append("text")
      .attr("x", c[0]).attr("y", c[1] + 14)
      .attr("text-anchor", "middle")
      .attr("fill", "#555").attr("font-size", 9)
      .attr("pointer-events", "none")
      .text(STATE_CROPS[name]);
  });

  const lW = Math.min(W - 40, 300), lH = 12;
  const legendSvg = d3.select(`#${legendId}`)
    .append("svg").attr("viewBox", `0 0 ${W} 36`);

  const defs = legendSvg.append("defs");
  const gradId = `grad-${containerId}`;
  const grad = defs.append("linearGradient").attr("id", gradId);
  for (let i = 0; i <= 10; i++) {
    grad.append("stop")
      .attr("offset", `${i * 10}%`)
      .attr("stop-color", colorScale(extent[0] + (extent[1] - extent[0]) * i / 10));
  }
  legendSvg.append("rect")
    .attr("x", 20).attr("y", 4).attr("width", lW).attr("height", lH)
    .attr("rx", 4).attr("fill", `url(#${gradId})`);
  legendSvg.append("text").attr("x", 20).attr("y", 30)
    .attr("fill", "#777").attr("font-size", 10).text(extent[0].toFixed(1));
  legendSvg.append("text").attr("x", 20 + lW).attr("y", 30)
    .attr("fill", "#777").attr("font-size", 10).attr("text-anchor", "end")
    .text(extent[1].toFixed(1));
}

// ── LINE CHARTS (binary) ──────────────────────────────────────────────────────

function drawLineCharts() {
  drawSingleLineChart("line-chart-left",  currentVar);
  drawSingleLineChart("line-chart-right", "NDVI");
}

function drawSingleLineChart(containerId, variable) {
  const margin = { top: 20, right: 30, bottom: 50, left: 60 };
  const outerW = 540, outerH = 340;
  const W = outerW - margin.left - margin.right;
  const H = outerH - margin.top - margin.bottom;

  let svg = d3.select(`#${containerId}`).select("svg");
  if (svg.empty()) {
    svg = d3.select(`#${containerId}`)
      .append("svg").attr("viewBox", `0 0 ${outerW} ${outerH}`);
    svg.append("g").attr("class", "line-inner")
      .attr("transform", `translate(${margin.left},${margin.top})`);
  }
  svg.select(".line-inner").selectAll("*").remove();
  const g = svg.select(".line-inner");

  const xScale = d3.scaleLinear().domain([1, 12]).range([0, W]);
  const yExt = d3.extent(allData, d => d[variable]);
  const yPad = (yExt[1] - yExt[0]) * 0.1;
  const yScale = d3.scaleLinear().domain([yExt[0] - yPad, yExt[1] + yPad]).range([H, 0]);

  g.append("g")
    .attr("transform", `translate(0,${H})`)
    .attr("class", "axis")
    .call(d3.axisBottom(xScale).ticks(12).tickFormat(i => MONTHS[i - 1]))
    .call(ax => ax.select(".domain").attr("stroke", "#666"))
    .call(ax => ax.selectAll(".tick line").attr("stroke", "#666"))
    .call(ax => ax.selectAll(".tick text").attr("fill", "#333").attr("font-size", "11px"));

  g.append("g").attr("class", "axis").call(d3.axisLeft(yScale).ticks(5))
    .call(ax => ax.select(".domain").attr("stroke", "#666"))
    .call(ax => ax.selectAll(".tick line").attr("stroke", "#666"))
    .call(ax => ax.selectAll(".tick text").attr("fill", "#333").attr("font-size", "11px"));

  g.append("text").attr("class", "axis-label")
    .attr("x", W / 2).attr("y", H + 42)
    .attr("text-anchor", "middle").text("Month");

  g.append("text").attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -H / 2).attr("y", -48)
    .attr("text-anchor", "middle").text(VAR_LABELS[variable]);

  const line = d3.line()
    .x(d => xScale(d.month))
    .y(d => yScale(d[variable]))
    .curve(d3.curveCatmullRom);

  ["Iowa", "Kansas", "Texas"].forEach(state => {
    const stateData = allData.filter(d => d.state === state).sort((a, b) => a.month - b.month);
    const color = STATE_COLORS[state];

    g.append("path").datum(stateData)
      .attr("fill", "none")
      .attr("stroke", color).attr("stroke-width", 2.5)
      .attr("d", line);

    g.selectAll(`.dot-${state}-${containerId}`)
      .data(stateData)
      .join("circle")
      .attr("cx", d => xScale(d.month))
      .attr("cy", d => yScale(d[variable]))
      .attr("r", 4)
      .attr("fill", color)
      .attr("stroke", "#fff").attr("stroke-width", 1.5)
      .on("mouseover", function(event, d) {
        d3.select(this).attr("r", 6);
        showTooltip(`
          <strong>${d.state} — ${STATE_CROPS[d.state]}</strong><br>
          Month: ${MONTHS[d.month - 1]}<br>
          ${VAR_LABELS[variable]}: ${d[variable].toFixed(3)}
        `, event);
      })
      .on("mousemove", moveTooltip)
      .on("mouseout", function() { d3.select(this).attr("r", 4); hideTooltip(); });
  });

  // Legend
  const legend = g.append("g").attr("transform", `translate(${W - 160}, 10)`);
  ["Iowa", "Kansas", "Texas"].forEach((state, i) => {
    const item = legend.append("g").attr("transform", `translate(0, ${i * 20})`);
    item.append("circle").attr("r", 4).attr("fill", STATE_COLORS[state]);
    item.append("text").attr("x", 10).attr("y", 4)
      .attr("font-size", 11).attr("fill", "#444")
      .text(`${state} (${STATE_CROPS[state]})`);
  });
}

// ── SCATTER BUTTONS (shared) ──────────────────────────────────────────────────

function buildScatterButtons() {
  const row = d3.select("#scatter-filter-row");
  row.selectAll("*").remove();

  ["All", "Iowa", "Kansas", "Texas"].forEach(state => {
    row.append("button")
      .attr("class", `scatter-btn${state === "All" ? " active" : ""}`)
      .style("background", state === "All" ? "#3a6ea5" : "#f0ede8")
      .style("color", state === "All" ? "#fff" : "#444")
      .text(state === "All" ? "All States" : `${state} (${STATE_CROPS[state]})`)
      .on("click", function() {
        scatterActiveState = state;
        row.selectAll(".scatter-btn")
          .style("background", function() {
            return d3.select(this).text().startsWith(state === "All" ? "All" : state) ? "#3a6ea5" : "#f0ede8";
          })
          .style("color", function() {
            return d3.select(this).text().startsWith(state === "All" ? "All" : state) ? "#fff" : "#444";
          });
        drawScatter("scatter-lst",    "LST_Day");
        drawScatter("scatter-precip", "Precipitation");
      });
  });
}

// ── SCATTER ──────────────────────────────────────────────────────────────────

function drawScatter(containerId, xVar) {
  d3.select(`#${containerId}`).selectAll("*").remove();

  const margin = { top: 20, right: 30, bottom: 55, left: 60 };
  const outerW = 540, outerH = 360;
  const W = outerW - margin.left - margin.right;
  const H = outerH - margin.top - margin.bottom;

  const svg = d3.select(`#${containerId}`)
    .append("svg").attr("viewBox", `0 0 ${outerW} ${outerH}`);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const filtered = scatterActiveState === "All" ? allData : allData.filter(d => d.state === scatterActiveState);

  const xExt = d3.extent(allData, d => d[xVar]);
  const xPad = (xExt[1] - xExt[0]) * 0.08;
  const yExt = d3.extent(allData, d => d.NDVI);
  const yPad = (yExt[1] - yExt[0]) * 0.08;

  const xScale = d3.scaleLinear().domain([xExt[0] - xPad, xExt[1] + xPad]).range([0, W]);
  const yScale = d3.scaleLinear().domain([yExt[0] - yPad, yExt[1] + yPad]).range([H, 0]);

  g.append("g")
    .attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(xScale).ticks(7))
    .call(ax => ax.select(".domain").attr("stroke", "#666"))
    .call(ax => ax.selectAll(".tick line").attr("stroke", "#666"))
    .call(ax => ax.selectAll(".tick text").attr("fill", "#333").attr("font-size", "12px"));

  g.append("g").call(d3.axisLeft(yScale).ticks(6))
    .call(ax => ax.select(".domain").attr("stroke", "#666"))
    .call(ax => ax.selectAll(".tick line").attr("stroke", "#666"))
    .call(ax => ax.selectAll(".tick text").attr("fill", "#333").attr("font-size", "12px"));

  g.append("text").attr("class", "axis-label")
    .attr("x", W / 2).attr("y", H + 46)
    .attr("text-anchor", "middle").text(VAR_LABELS[xVar]);

  g.append("text").attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -H / 2).attr("y", -48)
    .attr("text-anchor", "middle").text("NDVI");

  // NDVI threshold lines
  [{ y: 0.3, label: "Emergence (0.2–0.4)", color: "#aaa" },
   { y: 0.7, label: "Peak Greenness (0.6–0.8)", color: "#4caf50" }
  ].forEach(t => {
    if (t.y >= yScale.domain()[0] && t.y <= yScale.domain()[1]) {
      g.append("line")
        .attr("x1", 0).attr("x2", W)
        .attr("y1", yScale(t.y)).attr("y2", yScale(t.y))
        .attr("stroke", t.color).attr("stroke-width", 1.2)
        .attr("stroke-dasharray", "5,4").attr("opacity", 0.7);
      g.append("text")
        .attr("x", W - 4).attr("y", yScale(t.y) - 5)
        .attr("text-anchor", "end").attr("fill", t.color).attr("font-size", 10)
        .text(t.label);
    }
  });

  filtered.forEach(d => {
    const color = STATE_COLORS[d.state];
    g.append("circle")
      .attr("cx", xScale(d[xVar])).attr("cy", yScale(d.NDVI))
      .attr("r", 6).attr("fill", color).attr("opacity", 0.75)
      .attr("stroke", "#fff").attr("stroke-width", 1)
      .on("mouseover", function(event) {
        d3.select(this).attr("r", 9).attr("opacity", 1);
        showTooltip(`
          <strong>${d.state} — ${STATE_CROPS[d.state]}</strong><br>
          Month: ${MONTHS[d.month - 1]}<br>
          ${VAR_LABELS[xVar]}: ${d[xVar].toFixed(2)}<br>
          NDVI: ${d.NDVI.toFixed(3)}
        `, event);
      })
      .on("mousemove", moveTooltip)
      .on("mouseout", function() {
        d3.select(this).attr("r", 6).attr("opacity", 0.75);
        hideTooltip();
      });

    g.append("text")
      .attr("x", xScale(d[xVar])).attr("y", yScale(d.NDVI) + 4)
      .attr("text-anchor", "middle").attr("font-size", 7).attr("font-weight", 700)
      .attr("fill", "#fff").attr("pointer-events", "none")
      .text(MONTHS[d.month - 1].slice(0, 1));
  });
}