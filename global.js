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
            [1, 2, 3].find(g => userGroups[g].has(d.id)) ?
            groupColorScale([1, 2, 3].find(g => userGroups[g].has(d.id))) :
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
    const margin = { top: 40, right: 120, bottom: 100, left: 60 };

    const svg = d3.select("#linechart").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // ---- Arrowhead for annotation arrows ----
    svg.append("defs").append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 5)
        .attr("refY", 5)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto-start-reverse")
        .append("path")
        .attr("d", "M 0 0 L 10 5 L 0 10 z")
        .attr("fill", "#333");

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

    // Axis labels
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

    // Line generator
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

    // Legend
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
    // STYLED ANNOTATIONS
    // =====================================
    if (groupsMatchDefaultPattern(userGroups)) {

        // ----- POLAR WARMING ANNOTATION (TOP-LEFT) -----
        const boxX = x(1870);
        const boxY = y(1.2);
        const boxWidth = 260;
        const boxHeight = 70;

        svg.append("rect")
            .attr("class", "annotation-box")
            .attr("x", boxX - 10)
            .attr("y", boxY - 40)
            .attr("width", boxWidth)
            .attr("height", boxHeight)
            .attr("rx", 8)
            .attr("ry", 8);

        svg.append("text")
            .attr("class", "annotation")
            .attr("x", boxX)
            .attr("y", boxY - 20)
            .call(t => {
                t.append("tspan")
                    .text("Since the early 2000s, the polar latitudes")
                    .attr("x", boxX).attr("dy", "1.2em");
                t.append("tspan")
                    .text("have warmed dramatically faster than")
                    .attr("x", boxX).attr("dy", "1.2em");
                t.append("tspan")
                    .text("the rest of the planet.");
            });

        svg.append("line")
            .attr("x1", boxX + 200)
            .attr("x2", x(2010))
            .attr("y1", boxY + 20)
            .attr("y2", y(1.6))
            .attr("stroke", "black")
            .attr("stroke-width", 1.2)
            .attr("marker-end", "url(#arrowhead)");

        // ----- AEROSOL COOLING ANNOTATION (BOTTOM CENTER) -----
        const aeroBoxX = x(1930);
        const aeroBoxY = height + 40;
        const aeroWidth = 330;
        const aeroHeight = 75;

        svg.append("rect")
            .attr("class", "annotation-box")
            .attr("x", aeroBoxX - 10)
            .attr("y", aeroBoxY)
            .attr("width", aeroWidth)
            .attr("height", aeroHeight)
            .attr("rx", 8)
            .attr("ry", 8);

        svg.append("text")
            .attr("class", "annotation")
            .attr("x", aeroBoxX)
            .attr("y", aeroBoxY + 20)
            .call(t => {
                t.append("tspan")
                    .text("Between ~1940 and 1970, global temperatures")
                    .attr("x", aeroBoxX)
                    .attr("dy", "1.2em");
                t.append("tspan")
                    .text("temporarily decreased due to aerosols in the")
                    .attr("x", aeroBoxX)
                    .attr("dy", "1.2em");
                t.append("tspan")
                    .text("air reflecting sunlight.");
            });

        svg.append("line")
            .attr("x1", x(1950))
            .attr("x2", x(1968))
            .attr("y1", height + 60)
            .attr("y2", y(-0.1))
            .attr("stroke", "black")
            .attr("stroke-width", 1.2)
            .attr("marker-end", "url(#arrowhead)");
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