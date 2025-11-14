import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

async function loadTASData() {
    try {
        const tasData = await d3.csv('data/zonal_anomaly.csv');
        return tasData.map(d => ({
            year: +d.year,
            lat: +d.lat,
            tas: +d.tas
        }));
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

const tasData = await loadTASData();

// =========================================
// GROUP STORAGE
// =========================================
let userGroups = {
    1: new Set(),
    2: new Set(),
    3: new Set()
};

// Latitude band definitions
const latitudeBands = [
    { id: 0, min: -90, max: -60 },
    { id: 1, min: -60, max: -30 },
    { id: 2, min: -30, max: 0 },
    { id: 3, min: 0, max: 30 },
    { id: 4, min: 30, max: 60 },
    { id: 5, min: 60, max: 90 }
];

// =========================================
// DEFAULT PRESET GROUPING
// =========================================
function applyDefaultPreset() {
    userGroups = {
        1: new Set([0, 5]),   // poles → Group 1 (blue)
        2: new Set([1, 4]),   // mid-latitudes → Group 2 (red)
        3: new Set([2, 3])    // tropics → Group 3 (green)
    };
}

applyDefaultPreset();

// =========================================
// HELPER TO CHECK IF GROUPS match preset pattern (for annotations)
// =========================================
function groupsMatchDefaultPattern(groups) {
    const sizes = Object.values(groups).map(s => s.size);
    if (!(sizes.includes(2) && sizes.filter(s => s === 2).length === 3)) return false;

    const poles = [0, 5];
    const mids = [2, 3];
    const midlats = [1, 4];

    const polesGroup = [...Object.entries(groups)].find(([g, set]) => poles.every(b => set.has(b)));
    const midsGroup = [...Object.entries(groups)].find(([g, set]) => mids.every(b => set.has(b)));
    const midlatGroup = [...Object.entries(groups)].find(([g, set]) => midlats.every(b => set.has(b)));

    return polesGroup && midsGroup && midlatGroup;
}

// =========================================
// UPDATE CHART WHEN GROUP CHANGES
// =========================================
function updateChartFromGroups() {
    const groupedData = computeGroupAverages(tasData, userGroups, latitudeBands);
    renderTASChart(groupedData);
}

// =========================================
// MAP RENDERING
// =========================================
async function renderLatMapWithWorld(bands, userGroups) {
    const width = 400;
    const height = 200;
    const margin = { right: 60 };

    const svg = d3.select("#latmap")
        .append("svg")
        .attr("width", width + margin.right)
        .attr("height", height);

    const projection = d3.geoNaturalEarth1()
        .scale(70)
        .translate([width / 2, height / 2]);

    const path = d3.geoPath(projection);

    const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
    const countries = topojson.feature(world, world.objects.countries);

    svg.append("g")
        .selectAll("path")
        .data(countries.features)
        .join("path")
        .attr("d", path)
        .attr("fill", "#e0e0e0")
        .attr("stroke", "#888")
        .attr("stroke-width", 0.5);

    const yFromLat = d3.scaleLinear()
        .domain([-90, 90])
        .range([height, 0]);

    // Draw latitude bands
    svg.append("g")
        .selectAll("rect")
        .data(bands)
        .join("rect")
        .attr("x", 0)
        .attr("width", width)
        .attr("y", d => yFromLat(d.max))
        .attr("height", d => yFromLat(d.min) - yFromLat(d.max))
        .attr("fill", d =>
            [1,2,3].find(g => userGroups[g].has(d.id)) ?
            groupColorScale([1,2,3].find(g => userGroups[g].has(d.id))) :
            "rgba(255,255,255,0.0)"
        )
        .attr("stroke", "#000")
        .attr("stroke-width", 0.8)
        .attr("fill-opacity", 0.4)
        .style("cursor", "pointer")
        .on("click", (event, d) => {
            handleBandClick(d.id);
            d3.select("#latmap").selectAll("svg").remove();
            renderLatMapWithWorld(latitudeBands, userGroups);
            updateChartFromGroups();
        });

    // Labels
    svg.append("g")
        .selectAll(".lat-label")
        .data(bands)
        .enter()
        .append("text")
        .attr("class", "lat-label")
        .attr("x", width + 55)
        .attr("y", d => yFromLat((d.min + d.max) / 2))
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .style("font-size", "10px")
        .style("fill", "#333")
        .text(d => `${d.max}° to ${d.min}°`);
}

const groupColorScale = d3.scaleOrdinal()
    .domain([1, 2, 3])
    .range(d3.schemeSet1);

// =========================================
// CLICK LOGIC FOR GROUP CYCLING
// =========================================
function handleBandClick(bandId) {
    for (let g = 1; g <= 3; g++) {
        if (userGroups[g].has(bandId)) {
            userGroups[g].delete(bandId);

            if (g < 3) userGroups[g + 1].add(bandId);
            return;
        }
    }
    userGroups[1].add(bandId);
}

// =========================================
// COMPUTE GROUP AVERAGES
// =========================================
function computeGroupAverages(data, groups, bands) {
    const groupResults = [];

    for (let g = 1; g <= 3; g++) {
        const bandIds = groups[g];
        if (bandIds.size === 0) continue;

        const groupBandRanges = bands.filter(b => bandIds.has(b.id));

        const filtered = data.filter(d =>
            groupBandRanges.some(b => d.lat >= b.min && d.lat < b.max)
        );

        const nested = d3.rollups(
            filtered,
            v => d3.mean(v, d => d.tas),
            d => d.year
        );

        groupResults.push({
            name: `Group ${g}`,
            values: nested.map(([year, tas]) => ({ year, tas }))
        });
    }

    return groupResults;
}

// =========================================
// CHART RENDERING
// =========================================
function renderTASChart(groupedData) {
    d3.select("#linechart").selectAll("*").remove();

    const allValues = groupedData.flatMap(d => d.values);

    const width = 600, height = 400;
    const margin = { top: 40, right: 120, bottom: 40, left: 60 };

    const svg = d3.select("#linechart").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
        .domain(d3.extent(allValues, d => d.year))
        .range([0, width]);

    const y = d3.scaleLinear()
        .domain(d3.extent(allValues, d => d.tas)).nice()
        .range([height, 0]);

    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(10).tickFormat(d3.format("d")));

    svg.append("g")
        .call(d3.axisLeft(y));

    svg.append("text")
        .attr("class", "x-axis-label")
        .attr("x", width / 2)
        .attr("y", height + 35)
        .attr("text-anchor", "middle")
        .text("Year");

    svg.append("text")
        .attr("class", "y-axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -40)
        .attr("text-anchor", "middle")
        .text("Temperature Change (°C)");

    const line = d3.line()
        .x(d => x(d.year))
        .y(d => y(d.tas));

    svg.selectAll(".line")
        .data(groupedData)
        .join("path")
        .attr("fill", "none")
        .attr("stroke", d => groupColorScale(Number(d.name.replace("Group ", ""))))
        .attr("stroke-width", 2)
        .attr("d", d => line(d.values));

    const legend = svg.selectAll(".legend")
        .data(groupedData)
        .join("g")
        .attr("transform", (d, i) => `translate(${width + 10},${i * 25})`);

    legend.append("rect")
        .attr("width", 12)
        .attr("height", 12)
        .attr("fill", d => groupColorScale(Number(d.name.replace("Group ", ""))));

    legend.append("text")
        .attr("x", 18)
        .attr("y", 10)
        .text(d => d.name)
        .style("font-size", "12px");

    // =====================================
    // CONDITIONAL ANNOTATIONS
    // =====================================
    if (groupsMatchDefaultPattern(userGroups)) {

        // Polar warming annotation
        svg.append("text")
            .attr("x", x(2005))
            .attr("y", y(1.5))
            .attr("class", "annotation")
            .text("Poles have rapidly accelerated warming since 2000 →");

        svg.append("line")
            .attr("x1", x(1995))
            .attr("x2", x(2008))
            .attr("y1", y(1.4))
            .attr("y2", y(1.7))
            .attr("stroke", "black")
            .attr("stroke-dasharray", "4 2");

        // Aerosol cooling annotation
        svg.append("text")
            .attr("x", x(1965))
            .attr("y", y(-0.3))
            .attr("class", "annotation")
            .text("1960–1980 dip caused by aerosol cooling");

        svg.append("line")
            .attr("x1", x(1960))
            .attr("x2", x(1980))
            .attr("y1", y(-0.25))
            .attr("y2", y(-0.1))
            .attr("stroke", "black")
            .attr("stroke-dasharray", "4 2");
    }
}

// =========================================
// BUTTON LOGIC
// =========================================
document.getElementById("clear-all").addEventListener("click", () => {
    userGroups = { 1: new Set(), 2: new Set(), 3: new Set() };
    d3.select("#latmap").selectAll("svg").remove();
    renderLatMapWithWorld(latitudeBands, userGroups);
    updateChartFromGroups();
});

document.getElementById("restore-defaults").addEventListener("click", () => {
    applyDefaultPreset();
    d3.select("#latmap").selectAll("svg").remove();
    renderLatMapWithWorld(latitudeBands, userGroups);
    updateChartFromGroups();
});

// Initial renders
renderLatMapWithWorld(latitudeBands, userGroups);
updateChartFromGroups();