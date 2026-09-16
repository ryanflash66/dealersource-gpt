const runtime = window.DEALERSOURCE_CONFIG ?? {};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return value == null ? "Unknown" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

async function fetchSupabase(path) {
  const response = await fetch(`${runtime.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: runtime.supabaseAnonKey, Authorization: `Bearer ${runtime.supabaseAnonKey}` },
  });
  if (!response.ok) throw new Error(`Supabase dashboard query failed: ${response.status}`);
  return response.json();
}

async function loadReport() {
  if (runtime.supabaseUrl && runtime.supabaseAnonKey) {
    const [siteRows, evidenceRows, scoreRows, runRows, sourceRows, caseRows, systemRows] = await Promise.all([
      fetchSupabase("sites?select=*&order=shared_lot.asc,updated_at.desc"),
      fetchSupabase("evidence?select=*"),
      fetchSupabase("scores?select=*"),
      fetchSupabase("runs?select=*&order=started_at.desc&limit=1"),
      fetchSupabase("sources?select=*"),
      fetchSupabase("cases?select=id,site_id,case_type,owner,status,opened_at,next_action_at,followups&status=neq.closed"),
      fetchSupabase("system_state?select=id,paused,reason,updated_at"),
    ]);
    const sites = siteRows.map((row) => row.payload && Object.keys(row.payload).length ? row.payload : row);
    for (const site of sites) {
      const score = scoreRows.find((row) => row.site_id === site.id);
      site.score = score?.payload && Object.keys(score.payload).length ? score.payload : score;
      if (!site.gates?.length) {
        site.gates = ["zoning", "rent", "flood"].map((name) => {
          const item = evidenceRows.find((row) => row.site_id === site.id && row.fact === name);
          return item?.payload?.gate ?? { name, status: item?.verified ? "pass" : "unknown", evidenceId: item?.id ?? null };
        });
      }
    }
    const run = runRows[0] ?? {};
    return {
      generatedAt: run.completed_at ?? new Date().toISOString(),
      runId: run.id ?? "live",
      shortlist: sites.filter((site) => site.viable),
      pipeline: sites,
      cases: caseRows.map((row) => ({
        id: row.id, siteId: row.site_id, type: row.case_type, owner: row.owner,
        status: row.status, openedAt: row.opened_at, nextActionAt: row.next_action_at, followups: row.followups,
      })),
      exceptions: [
        ...sourceRows.filter((source) => !source.enabled).map((source) => ({ type: "source", severity: "warning", message: `${source.name} excluded by source policy.` })),
        ...systemRows.filter((item) => item.paused).map((item) => ({ type: item.id, severity: "error", message: `Automated ${item.id} is paused: ${item.reason ?? "manual pause"}.` })),
      ],
      config: runtime.publicConfig,
    };
  }
  const response = await fetch("/api/data").catch(() => null) ?? await fetch("/data.json");
  if (!response.ok) throw new Error("Fixture report could not be loaded.");
  return response.json();
}

function gateMarkup(gates) {
  return gates.map((gate) => `<span class="gate ${escapeHtml(gate.status)}"><span aria-hidden="true">${gate.status === "pass" ? "✓" : gate.status === "fail" ? "×" : "!"}</span> ${escapeHtml(gate.name)}</span>`).join("");
}

function evidenceLink(site) {
  const source = site.sourceUrls?.[0];
  return source ? `<a class="evidence-link" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">View source evidence ↗</a>` : "";
}

function renderSite(site, index) {
  return `<article class="site-card" id="${escapeHtml(site.id)}">
    <div class="site-summary">
      <div class="rank"><span><small>Rank</small>${index + 1}</span></div>
      <div><h3>${escapeHtml(site.address)}</h3><p class="site-address">Parcel ${escapeHtml(site.parcelId ?? "pending")}</p><div class="badges"><span class="badge">${money(site.monthlyRent)}/mo</span><span class="badge">${escapeHtml(site.metrics.driveMinutes)} min drive</span>${site.sharedLot ? '<span class="badge shared">Shared lot · last resort</span>' : '<span class="badge">Standalone</span>'}</div></div>
      <div class="score"><strong>${escapeHtml(site.score?.total ?? 0)}</strong><span>weighted score</span></div>
    </div>
    <div class="site-details">
      <div class="detail"><span>Traffic</span><strong>${Number(site.metrics.aadt ?? 0).toLocaleString()} AADT</strong></div>
      <div class="detail"><span>Frontage</span><strong>${escapeHtml(site.metrics.frontageFeet ?? 0)} ft</strong></div>
      <div class="detail"><span>Display</span><strong>${escapeHtml(site.vehicleDisplay ?? 0)} vehicles</strong></div>
      <div class="detail"><span>Office</span><strong>${site.office ? "Enclosed" : "Unverified"}</strong></div>
      <div class="detail"><span>Competition</span><strong>${escapeHtml(site.metrics.competitors ?? 0)} nearby</strong></div>
    </div>
    <div class="gate-row"><div class="badges">${gateMarkup(site.gates)}</div>${evidenceLink(site)}</div>
  </article>`;
}

function renderMap(sites) {
  const map = document.querySelector("#map");
  if (!sites.length) { map.innerHTML = '<div class="empty">No viable sites to map.</div>'; return; }
  const latitudes = sites.map((site) => site.latitude);
  const longitudes = sites.map((site) => site.longitude);
  const minLat = Math.min(...latitudes) - .03, maxLat = Math.max(...latitudes) + .03;
  const minLon = Math.min(...longitudes) - .03, maxLon = Math.max(...longitudes) + .03;
  map.innerHTML = sites.map((site, index) => {
    const left = 10 + ((site.longitude - minLon) / (maxLon - minLon || 1)) * 80;
    const top = 90 - ((site.latitude - minLat) / (maxLat - minLat || 1)) * 80;
    return `<button class="map-marker ${site.sharedLot ? "shared" : ""}" style="left:${left}%;top:${top}%" aria-label="Show ${escapeHtml(site.address)}" data-site="${escapeHtml(site.id)}"><span>${index + 1}</span></button>`;
  }).join("");
  map.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.site)?.scrollIntoView({ behavior: "smooth", block: "center" })));
}

async function upgradeMap(sites) {
  if (!runtime.mapStyleUrl || !runtime.maplibreAssetUrl) return;
  try {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${runtime.maplibreAssetUrl.replace(/\/$/, "")}/maplibre-gl.css`;
    document.head.append(css);
    const module = await import(`${runtime.maplibreAssetUrl.replace(/\/$/, "")}/maplibre-gl.js`);
    const maplibregl = module.default ?? module;
    const map = new maplibregl.Map({ container: "map", style: runtime.mapStyleUrl, center: [-77.36, 35.61], zoom: 8 });
    for (const site of sites) new maplibregl.Marker({ color: site.sharedLot ? "#ffd166" : "#ffb14a" }).setLngLat([site.longitude, site.latitude]).setPopup(new maplibregl.Popup().setText(site.address)).addTo(map);
    document.querySelector("#map-mode").textContent = "Self-hosted tiles";
  } catch (error) {
    console.warn("MapLibre upgrade unavailable; retaining offline plot.", error);
  }
}

function renderMetrics(report) {
  const viable = report.shortlist.length;
  const standalone = report.shortlist.filter((site) => !site.sharedLot).length;
  const openCases = report.cases.length;
  const avgScore = viable ? Math.round(report.shortlist.reduce((sum, site) => sum + (site.score?.total ?? 0), 0) / viable) : 0;
  document.querySelector("#metrics").innerHTML = [
    ["Verified sites", viable, `${standalone} standalone`], ["Average score", avgScore, "out of 100"], ["Open cases", openCases, openCases ? "awaiting evidence" : "queue clear"], ["Policy exceptions", report.exceptions.length, "visible in Exceptions"],
  ].map(([label, value, note]) => `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join("");
}

function renderPipeline(report) {
  const stages = ["discovered", "resolved", "enriched", "verifying", "scored", "reported"];
  document.querySelector("#stage-strip").innerHTML = stages.map((stage) => `<div class="stage"><span>${stage}</span><strong>${report.pipeline.filter((site) => site.stage === stage).length}</strong></div>`).join("");
  document.querySelector("#pipeline-table").innerHTML = report.pipeline.map((site) => `<tr><td><strong>${escapeHtml(site.address)}</strong></td><td><span class="stage-pill">${escapeHtml(site.stage)}</span></td><td>${money(site.monthlyRent)}</td><td><div class="badges">${gateMarkup(site.gates)}</div></td><td>${site.sharedLot ? "Shared" : "Standalone"}</td></tr>`).join("");
  document.querySelector("#cases").innerHTML = report.cases.length ? report.cases.map((item) => `<div class="case"><div><strong>${escapeHtml(item.type)} verification</strong><p>${escapeHtml(report.pipeline.find((site) => site.id === item.siteId)?.address ?? item.siteId)} · ${escapeHtml(item.owner)}</p></div><span class="stage-pill">${escapeHtml(item.status)}</span><time>${new Date(item.nextActionAt).toLocaleDateString()}</time></div>`).join("") : '<div class="empty">No unresolved cases.</div>';
}

function flatten(object, prefix = "") {
  return Object.entries(object ?? {}).flatMap(([key, value]) => value && typeof value === "object" && !Array.isArray(value) ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, Array.isArray(value) ? value.join(", ") : value]]);
}

function renderConfig(report) {
  const groups = [
    ["Business rules", report.config.business], ["Provider selection", report.config.providers?.providers ?? report.config.providers],
  ];
  document.querySelector("#config-grid").innerHTML = groups.map(([title, data]) => `<section class="config-card"><h2>${title}</h2><dl>${flatten(data).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl></section>`).join("");
}

function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
    const view = button.dataset.view;
    document.querySelectorAll(".nav-item").forEach((item) => { item.classList.toggle("is-active", item === button); item.removeAttribute("aria-current"); });
    button.setAttribute("aria-current", "page");
    document.querySelectorAll(".view").forEach((section) => { const active = section.id === `view-${view}`; section.hidden = !active; section.classList.toggle("is-active", active); });
    history.replaceState(null, "", `#${view}`);
    document.querySelector("#main-content").focus();
  }));
}

try {
  const report = await loadReport();
  document.querySelector("#run-state").innerHTML = `<span class="pulse-dot"></span> ${escapeHtml(report.runId)} complete`;
  document.querySelector("#generated-at").textContent = new Date(report.generatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  document.querySelector("#shortlist-count").textContent = report.shortlist.length;
  document.querySelector("#exception-count").textContent = report.exceptions.length;
  document.querySelector("#home-base").textContent = report.config.business.search.home_base;
  document.querySelector("#search-window").textContent = `${report.config.business.search.max_drive_minutes} minute drive time`;
  document.querySelector("#shortlist").innerHTML = report.shortlist.length ? report.shortlist.map(renderSite).join("") : '<div class="empty">No sites currently pass all three gates.</div>';
  document.querySelector("#exceptions").innerHTML = report.exceptions.length ? report.exceptions.map((item) => `<article class="exception-card ${escapeHtml(item.severity)}"><span class="exception-icon" aria-hidden="true">!</span><div><strong>${escapeHtml(item.type)}</strong><p>${escapeHtml(item.message)}</p></div><small>${escapeHtml(item.severity)}</small></article>`).join("") : '<div class="empty">No active exceptions.</div>';
  renderMetrics(report);
  renderMap(report.shortlist);
  renderPipeline(report);
  renderConfig(report);
  setupNavigation();
  await upgradeMap(report.shortlist);
} catch (error) {
  document.querySelector("#main-content").innerHTML = `<div class="empty"><h1>Dashboard unavailable</h1><p>${escapeHtml(error.message)}</p></div>`;
  document.querySelector("#run-state").textContent = "Data load failed";
}
