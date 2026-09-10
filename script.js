// ISS Tracker frontend logic
// - Renders a clickable world map with D3 (equirectangular projection)
// - Polls /api/current every 5s for the ISS's live position/speed
// - Fetches /api/passes?lat=&lon= whenever the user clicks the map or searches
// - Keeps a self-updating "Last updated: ..." label

(function () {
  const svg = d3.select("#mapSvg");
  let projection = null;
  let path = null;
  let width = 0;
  let height = 0;

  let issMarker = null;
  let pinMarker = null;
  let lastUpdateTime = null; // Date object of the last successful /api/current fetch

  // ---------- Map setup ----------

  function sizeSvg() {
    const wrap = document.querySelector(".map-wrap");
    width = wrap.clientWidth;
    height = wrap.clientHeight;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
  }

  function buildProjection() {
    projection = d3.geoEquirectangular()
      .fitSize([width, height], { type: "Sphere" });
    path = d3.geoPath(projection);
  }

  function drawMap(worldGeo) {
    svg.selectAll("*").remove();

    svg.append("path")
      .datum({ type: "Sphere" })
      .attr("class", "sphere")
      .attr("d", path)
      .attr("fill", "#eef0f2");

    svg.append("g")
      .selectAll("path")
      .data(worldGeo.features)
      .join("path")
      .attr("class", "land")
      .attr("d", path);

    // marker layers (drawn after land so they sit on top)
    issMarker = svg.append("g").attr("class", "iss-marker").style("display", "none");
    issMarker.append("circle").attr("r", 6).attr("fill", "#ffd54a").attr("stroke", "#1f3c68").attr("stroke-width", 1.5);
    issMarker.append("text").text("🛰").attr("x", 10).attr("y", 5).attr("font-size", 16);

    pinMarker = svg.append("g").attr("class", "pin-marker").style("display", "none");
    pinMarker.append("circle").attr("r", 7).attr("fill", "#e0524a").attr("stroke", "#fff").attr("stroke-width", 2);

    svg.on("click", onMapClick);
  }

  function initMap() {
    sizeSvg();
    buildProjection();

    d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then((topology) => {
        const worldGeo = topojson.feature(topology, topology.objects.countries);
        drawMap(worldGeo);
        // place ISS marker as soon as we have a position
        refreshCurrentPosition();
      })
      .catch(() => {
        document.querySelector(".map-wrap").innerHTML =
          '<div style="padding:20px;color:#1f3c68;">Could not load world map data. Check your internet connection.</div>';
      });
  }

  function onMapClick(event) {
    if (!projection) return;
    const [x, y] = d3.pointer(event);
    const coords = projection.invert([x, y]);
    if (!coords) return;
    const [lon, lat] = coords;
    placePin(lat, lon);
    fetchPasses(lat, lon);
  }

  function placePin(lat, lon) {
    if (!pinMarker || !projection) return;
    const [x, y] = projection([lon, lat]);
    pinMarker.attr("transform", `translate(${x},${y})`).style("display", null);
  }

  function placeIssMarker(lat, lon) {
    if (!issMarker || !projection) return;
    const [x, y] = projection([lon, lat]);
    issMarker.attr("transform", `translate(${x},${y})`).style("display", null);
  }

  // ---------- Current ISS position (polled) ----------

  function refreshCurrentPosition() {
    fetch("/api/current")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);

        document.getElementById("issLat").textContent = data.latitude.toFixed(3) + "°";
        document.getElementById("issLon").textContent = data.longitude.toFixed(3) + "°";
        document.getElementById("issAlt").textContent = data.altitude_km + " km";
        document.getElementById("currentSpeed").textContent = data.speed_mph.toLocaleString();

        placeIssMarker(data.latitude, data.longitude);

        lastUpdateTime = new Date();
        document.getElementById("statusDot").classList.remove("stale");
        updateLastUpdatedLabel();
      })
      .catch(() => {
        document.getElementById("statusDot").classList.add("stale");
      });
  }

  function updateLastUpdatedLabel() {
    const label = document.getElementById("lastUpdated");
    if (!lastUpdateTime) {
      label.textContent = "--";
      return;
    }
    const seconds = Math.floor((Date.now() - lastUpdateTime.getTime()) / 1000);
    if (seconds < 10) {
      label.textContent = "now";
    } else if (seconds < 60) {
      label.textContent = `${seconds} sec ago`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      label.textContent = `${mins} min ago`;
    } else {
      const hrs = Math.floor(seconds / 3600);
      label.textContent = `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    }
  }

  // ---------- Passes for a clicked/searched location ----------

  function fetchPasses(lat, lon) {
    setPassesLoadingState();
    fetch(`/api/passes?lat=${lat}&lon=${lon}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        renderPasses(data.passes);
      })
      .catch(() => {
        document.getElementById("upcomingPasses").innerHTML =
          '<div class="empty-state">Could not load pass predictions for that location. Try again shortly.</div>';
      });
  }

  function setPassesLoadingState() {
    document.getElementById("nextPassDate").textContent = "Loading…";
  }

  function renderPasses(passes) {
    const list = document.getElementById("upcomingPasses");
    list.innerHTML = "";

    if (!passes || passes.length === 0) {
      document.getElementById("nextPassTime").textContent = "--:-- --";
      document.getElementById("nextPassDate").textContent = "No passes in the next 5 days";
      document.getElementById("visibleMin").textContent = "--";
      document.getElementById("maxAltitude").textContent = "--°";
      document.getElementById("nextPassMini").textContent = "--:-- --";
      list.innerHTML = '<div class="empty-state">No upcoming passes found for this location in the next 5 days.</div>';
      return;
    }

    const next = passes[0];
    document.getElementById("nextPassTime").textContent = next.time_label;
    document.getElementById("nextPassDate").textContent = next.date_label;
    document.getElementById("visibleMin").textContent = next.duration_min;
    document.getElementById("maxAltitude").textContent = (next.max_altitude_deg ?? "--") + "°";
    document.getElementById("nextPassMini").textContent = `${next.time_label}`;

    passes.forEach((p) => {
      const card = document.createElement("div");
      card.className = "pass-card";
      card.innerHTML = `
        <div>
          <div class="pass-date">${p.date_label}</div>
          <div class="pass-time">${p.time_label}</div>
        </div>
        <div class="pass-duration">${p.duration_min} mins</div>
      `;
      list.appendChild(card);
    });
  }

  // ---------- Search ----------

  function initSearch() {
    const form = document.getElementById("searchForm");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = document.getElementById("searchInput").value.trim();
      if (!q) return;
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.error) throw new Error(data.error);
          placePin(data.latitude, data.longitude);
          fetchPasses(data.latitude, data.longitude);
        })
        .catch(() => {
          document.getElementById("upcomingPasses").innerHTML =
            '<div class="empty-state">Could not find that location. Try a different search.</div>';
        });
    });
  }

  // ---------- Fullscreen ----------

  function initFullscreen() {
    const btn = document.getElementById("fullscreenBtn");
    const el = document.getElementById("app");
    btn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen).call(el);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen).call(document);
      }
    });
  }

  // ---------- Boot ----------

  window.addEventListener("resize", () => {
    if (!svg.node()) return;
    sizeSvg();
    buildProjection();
    svg.selectAll("path.land").attr("d", path);
    svg.selectAll("path.sphere").attr("d", path);
  });

  document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initSearch();
    initFullscreen();

    refreshCurrentPosition();
    setInterval(refreshCurrentPosition, 5000); // live position every 5s
    setInterval(updateLastUpdatedLabel, 1000); // tick the "X sec/min/hr ago" label every 1s
  });
})();
