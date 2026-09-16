const runtime = window.DEALERSOURCE_CONFIG ?? {};

const $ = (selector) => document.querySelector(selector);
const icon = (name, className = "") => `<svg class="i ${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return value == null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatDate(value, options = { dateStyle: "medium" }) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString([], options);
}

function sourceDomain(value) {
  try { return new URL(value).hostname; } catch { return "source"; }
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
      fetchSupabase("cases?select=*&status=neq.closed"),
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
        recipient: row.recipient, status: row.status, openedAt: row.opened_at,
        nextActionAt: row.next_action_at, followups: row.followups,
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

function normalizeGateStatus(status) {
  return status === "pass" || status === "fail" || status === "stale" ? status : "pending";
}

function gateMarkup(gates = []) {
  const icons = { pass: "check", fail: "x", pending: "clock", stale: "stale" };
  return gates.map((gate) => {
    const status = normalizeGateStatus(gate.status);
    return `<span role="listitem"><span class="chip chip-${status}" data-gate="${escapeHtml(gate.name)}" data-status="${status}">${icon(icons[status])}<span class="gate">${escapeHtml(gate.name)}</span><span class="label">${status[0].toUpperCase()}${status.slice(1)}</span></span></span>`;
  }).join("");
}

function evidenceRows(site, report) {
  const source = site.sourceUrls?.[0];
  const sourceLink = source
    ? `<a class="link-ext" href="${escapeHtml(source)}" target="_blank" rel="noopener"><span class="source-domain">${escapeHtml(sourceDomain(source))}</span>${icon("external-small")}</a>`
    : '<span class="muted">not supplied</span>';
  const gateRows = (site.gates ?? []).map((gate) => {
    const status = normalizeGateStatus(gate.status);
    const rowClass = status === "stale" ? "is-stale" : "";
    return `<tr class="evidence-row ${rowClass}"><td data-label="Fact"><span class="fact">${escapeHtml(gate.name)}: gate evidence</span></td><td data-label="Value" class="val">${escapeHtml(gate.reason ?? status)}</td><td data-label="Method"><span class="tag tag-official">${icon("layer")}Verified source</span></td><td data-label="Fetched" class="mono">${escapeHtml(formatDate(report.generatedAt, { dateStyle: "medium" }))}</td><td data-label="Expires" class="mono expires">report TTL</td><td data-label="Source" class="src">${sourceLink}</td></tr>`;
  });
  gateRows.push(`<tr class="evidence-row"><td data-label="Fact"><span class="fact">traffic: AADT</span></td><td data-label="Value" class="val">${Number(site.metrics?.aadt ?? 0).toLocaleString()}</td><td data-label="Method"><span class="tag tag-official">${icon("layer")}NCDOT</span></td><td data-label="Fetched" class="mono">${escapeHtml(formatDate(report.generatedAt, { dateStyle: "medium" }))}</td><td data-label="Expires" class="mono expires">report TTL</td><td data-label="Source" class="src">${sourceLink}</td></tr>`);
  return gateRows.join("");
}

function renderSite(site, index, report) {
  const score = site.score ?? {};
  const scoreTotal = Number(score.total ?? 0);
  const scoreDisplay = (scoreTotal / 100).toFixed(2);
  const factors = [
    ["Traffic", "traffic", "35%", Number(site.metrics?.aadt ?? 0).toLocaleString()],
    ["Visibility", "visibility", "25%", `${site.metrics?.frontageFeet ?? 0} ft`],
    ["Drive", "distance", "20%", `${site.metrics?.driveMinutes ?? 0} min`],
    ["Rent", "rent", "12%", money(site.monthlyRent)],
    ["Competitors", "competitors", "8%", `${site.metrics?.competitors ?? 0} within 5 mi`],
  ];
  const shared = site.sharedLot ? " is-shared" : "";
  const selected = index === 0 ? " is-selected" : "";
  const rankClasses = `rank${shared}${selected}`;
  return `<li class="site-card${shared}${selected}" id="site-${escapeHtml(site.id)}" data-site-id="${escapeHtml(site.id)}" data-lat="${site.latitude}" data-lon="${site.longitude}">
    <div class="card-main">
      <div class="card-head"><span class="${rankClasses}" aria-label="Rank ${index + 1}${site.sharedLot ? ", shared lot" : ""}" title="Rank ${index + 1}">${index + 1}</span><div class="card-title"><div class="addr"><a href="#site-${escapeHtml(site.id)}">${escapeHtml(site.address)}</a></div><div class="city">Eastern North Carolina · <span class="mono">${escapeHtml(site.parcelId ?? "parcel pending")}</span></div></div><div class="card-flags">${site.sharedLot ? `<span class="flag-shared">${icon("shared")}Shared lot</span>` : ""}</div></div>
      <div class="facts"><span class="fact">${icon("dollar")}<span class="v">${money(site.monthlyRent)}</span><span class="u">/ mo</span></span><span class="fact">${icon("car")}<span class="v">${escapeHtml(site.metrics?.driveMinutes ?? 0)}</span><span class="u">min drive</span></span><span class="fact">${icon("pin")}<span class="v">${Number(site.metrics?.aadt ?? 0).toLocaleString()}</span><span class="u">AADT</span></span></div>
      <div class="gates" role="list" aria-label="Gates">${gateMarkup(site.gates)}</div>
      <div class="score"><div class="score-row"><span class="caps">Score</span><div class="score-track score-bar" role="img" aria-label="Score ${scoreDisplay} of 1.00">${factors.map((factor, factorIndex) => `<span class="seg seg-${factorIndex + 1}" style="width:${Number(score[factor[1]] ?? 0)}%" title="${factor[0]}: ${(Number(score[factor[1]] ?? 0) / 100).toFixed(2)}"></span>`).join("")}</div><span class="score-value">${scoreDisplay}</span></div><dl class="breakdown">${factors.map((factor, factorIndex) => `<div><dt><span class="sw seg-${factorIndex + 1}"></span>${factor[0]}<span class="w" title="weight">${factor[2]}</span></dt><dd><b>${(Number(score[factor[1]] ?? 0) / 100).toFixed(2)}</b><span class="raw">${escapeHtml(factor[3])}</span></dd></div>`).join("")}</dl></div>
      <details class="evidence"${index === 0 ? " open" : ""}><summary>${icon("chevron", "i-chev")}View evidence <span class="muted">(${(site.gates?.length ?? 0) + 1})</span></summary><table class="evidence-table"><colgroup><col class="c-fact"><col class="c-val"><col class="c-method"><col class="c-fetched"><col class="c-expires"><col class="c-src"></colgroup><thead><tr><th scope="col">Fact</th><th scope="col">Value</th><th scope="col">Method</th><th scope="col">Fetched</th><th scope="col">Expires</th><th scope="col">Source</th></tr></thead><tbody>${evidenceRows(site, report)}</tbody></table></details>
    </div>
    <div class="thumbs"><div class="thumb thumb-street" role="img" aria-label="Street-level photo placeholder for ${escapeHtml(site.address)}">${icon("image", "i-20")}<span class="thumb-label">Street</span></div><div class="thumb thumb-aerial" role="img" aria-label="Aerial thumbnail placeholder for ${escapeHtml(site.address)}">${icon("layer", "i-20")}<span class="thumb-label">Aerial</span></div></div>
  </li>`;
}

function markerPosition(site, sites) {
  const lats = sites.map((item) => Number(item.latitude));
  const lons = sites.map((item) => Number(item.longitude));
  const minLat = Math.min(...lats) - 0.02, maxLat = Math.max(...lats) + 0.02;
  const minLon = Math.min(...lons) - 0.02, maxLon = Math.max(...lons) + 0.02;
  return {
    left: 8 + ((Number(site.longitude) - minLon) / (maxLon - minLon || 1)) * 84,
    top: 92 - ((Number(site.latitude) - minLat) / (maxLat - minLat || 1)) * 84,
  };
}

function renderMap(sites) {
  const container = $("#map-static");
  if (!sites.length) { container.innerHTML = '<div class="empty">No viable sites to map.</div>'; return; }
  const first = sites[0];
  const firstPosition = markerPosition(first, sites);
  container.innerHTML = `<span class="map-home" style="left:50%;top:50%" title="Home base">${icon("home")}</span>${sites.map((site, index) => {
    const position = markerPosition(site, sites);
    return `<button type="button" class="static-marker marker rank${index === 0 ? " is-selected" : ""}${site.sharedLot ? " is-shared" : ""}" style="left:${position.left}%;top:${position.top}%" data-site-id="${escapeHtml(site.id)}" aria-label="Rank ${index + 1}, ${escapeHtml(site.address)}">${index + 1}</button>`;
  }).join("")}<div class="map-popup is-below" style="left:calc(${firstPosition.left}% - 120px);top:calc(${firstPosition.top}% + 24px)" role="dialog" aria-label="Selected site"><div class="pop-head"><span class="rank">1</span><span class="addr">${escapeHtml(first.address)}</span></div><div class="pop-body"><div class="pop-facts"><span><b>${money(first.monthlyRent)}</b>/mo</span><span><b>${escapeHtml(first.metrics?.driveMinutes)}</b> min</span><span>score <b>${(Number(first.score?.total ?? 0) / 100).toFixed(2)}</b></span></div><div class="gates" role="list" aria-label="Gates">${gateMarkup(first.gates)}</div><a class="pop-link" href="#site-${escapeHtml(first.id)}">Open in list</a></div></div><span class="map-caption">Static preview · MapLibre replaces this when online</span>`;
  container.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => document.getElementById(`site-${button.dataset.siteId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })));
}

async function upgradeMap(sites) {
  if (!runtime.mapStyleUrl || !runtime.maplibreAssetUrl || !sites.length) return;
  try {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${runtime.maplibreAssetUrl.replace(/\/$/, "")}/maplibre-gl.css`;
    document.head.append(css);
    const module = await import(`${runtime.maplibreAssetUrl.replace(/\/$/, "")}/maplibre-gl.js`);
    const maplibregl = module.default ?? module;
    const map = new maplibregl.Map({ container: "map", style: runtime.mapStyleUrl, center: [-77.36, 35.61], zoom: 8 });
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    for (const site of sites) new maplibregl.Marker({ color: accent }).setLngLat([site.longitude, site.latitude]).setPopup(new maplibregl.Popup().setText(site.address)).addTo(map);
    map.on("load", () => { $("#map-static").hidden = true; });
  } catch (error) {
    console.warn("MapLibre unavailable; retaining the offline preview.", error);
  }
}

function renderShortlist(report) {
  $("#shortlist-summary").textContent = `${report.shortlist.length} viable sites · ranked by weighted score · standalone before shared lots`;
  $("#shortlist").innerHTML = report.shortlist.map((site, index) => renderSite(site, index, report)).join("");
  const almost = report.pipeline.filter((site) => !site.viable && (site.gates ?? []).filter((gate) => normalizeGateStatus(gate.status) === "pending").length === 1 && !(site.gates ?? []).some((gate) => normalizeGateStatus(gate.status) === "fail"));
  $("#almost-summary").textContent = `${almost.length} sites · pending is unresolved, not a pass`;
  $("#almost-list").innerHTML = almost.map((site) => {
    const gate = site.gates.find((item) => normalizeGateStatus(item.status) === "pending");
    const itemCase = report.cases.find((item) => item.siteId === site.id);
    return `<li class="almost-row"><div><div class="addr">${escapeHtml(site.address)}</div><div class="city">${money(site.monthlyRent)}/mo · ${escapeHtml(site.metrics?.driveMinutes)} min</div></div><div>${gateMarkup([gate])}</div><div class="case"><span class="case-status case-${itemCase ? "awaiting" : "blocked"}">${icon(itemCase ? "mail" : "refresh")}${itemCase ? escapeHtml(itemCase.status) : "no case"}</span><span>${escapeHtml(gate.name)} ${itemCase ? `case → <span class="mono">${escapeHtml(itemCase.recipient ?? itemCase.owner)}</span>` : "requires evidence"}</span></div></li>`;
  }).join("");
  renderMap(report.shortlist);
}

function pipelineStage(site) {
  if (site.viable || site.stage === "reported" || site.stage === "scored") return "scored";
  if ((site.gates ?? []).some((gate) => normalizeGateStatus(gate.status) === "fail")) return "excluded";
  return ["discovered", "resolved", "enriched", "verifying"].includes(site.stage) ? site.stage : "verifying";
}

function renderPipeline(report) {
  const stages = [
    ["discovered", "listing or parcel seen, not yet resolved"], ["resolved", "address, parcel and drive time known"],
    ["enriched", "traffic, visibility and POIs fetched"], ["verifying", "one or more gates pending"],
    ["scored", "all three gates pass"], ["excluded", "a gate failed or policy excluded it"],
  ];
  $("#pipeline-summary").textContent = `${report.pipeline.length} sites in this run · by current stage`;
  $("#stage-strip").innerHTML = stages.map(([stage, description]) => {
    const count = report.pipeline.filter((site) => pipelineStage(site) === stage).length;
    return `<li class="stage${stage === "scored" ? " is-active" : ""}${stage === "excluded" ? " is-excluded" : ""}"><div class="n">${count}</div><div class="l">${stage[0].toUpperCase()}${stage.slice(1)}</div><div class="d">${description}</div></li>`;
  }).join("");
  $("#cases-summary").textContent = `${report.cases.length} open · “no reply” is not approval`;
  $("#cases-body").innerHTML = report.cases.length ? report.cases.map((item) => {
    const site = report.pipeline.find((candidate) => candidate.id === item.siteId);
    const statusClass = item.status === "bounced" ? "bounced" : item.status === "replied" ? "replied" : "awaiting";
    const statusIcon = statusClass === "bounced" ? "alert" : statusClass === "replied" ? "check" : "clock";
    return `<tr><td data-label="Site"><span class="addr">${escapeHtml(site?.address ?? item.siteId)}</span><span class="sub mono">${escapeHtml(item.siteId)}</span></td><td data-label="Case">${escapeHtml(item.type)}</td><td data-label="Recipient" class="mono">${escapeHtml(item.recipient ?? item.owner)}</td><td data-label="Opened" class="mono">${escapeHtml(formatDate(item.openedAt))}</td><td data-label="Follow-ups" class="num">${escapeHtml(item.followups ?? 0)}</td><td data-label="Status"><span class="case-status case-${statusClass}">${icon(statusIcon)}${escapeHtml(item.status)}</span></td><td data-label="Next" class="next">Next action ${escapeHtml(formatDate(item.nextActionAt))}</td></tr>`;
  }).join("") : '<tr><td colspan="7"><div class="empty">No unresolved cases.</div></td></tr>';
  $("#pipeline-body").innerHTML = report.pipeline.map((site) => `<tr><td data-label="Site"><span class="addr">${escapeHtml(site.address)}</span><span class="sub mono">${escapeHtml(site.id)}</span></td><td data-label="Stage">${escapeHtml(pipelineStage(site))}</td><td data-label="Rent">${money(site.monthlyRent)}</td><td data-label="Gates"><div class="gates" role="list" aria-label="Gates">${gateMarkup(site.gates)}</div></td><td data-label="Lot">${site.sharedLot ? "Shared" : "Standalone"}</td></tr>`).join("");
}

function renderExceptions(report) {
  const paused = Boolean(report.config?.business?.mail?.paused) || report.exceptions.some((item) => /paused|bounce/i.test(`${item.type} ${item.message}`));
  $("#exception-count").textContent = report.exceptions.length;
  $("#exception-count").classList.toggle("is-alert", report.exceptions.length > 0);
  $("#policy-summary").textContent = `${report.exceptions.length} · never treated as verified evidence`;
  $("#exceptions-list").innerHTML = report.exceptions.map((item) => `<li><span class="k">${escapeHtml(item.type)}<span class="sub">${escapeHtml(item.severity)}</span></span><span class="r">${escapeHtml(item.message)}</span><span class="m">${icon("ban", "i-16")}</span></li>`).join("");
  $("#exception-banners").innerHTML = paused ? `<div class="banner banner-paused" role="alert">${icon("pause")}<div class="b-title">Sending paused</div><div class="b-meta"><span>Automated outreach remains off until the recorded bounce or system pause is resolved.</span><span>The dashboard is read-only.</span></div></div>` : "";
  $("#global-banner").innerHTML = paused ? `<div class="paused-strip" role="status">${icon("pause", "i-16")}<span>Sending paused by the current report configuration.</span><a href="#exceptions">See exceptions</a></div>` : "";
  return paused;
}

function renderConfig(report, paused) {
  const business = report.config?.business ?? {};
  const configRows = [
    ["Home base", business.search?.home_base, "search center"],
    ["Max drive time", `${business.search?.max_drive_minutes ?? "?"} min`, "from home base"],
    ["Rent range", `${money(business.rent?.min_monthly)} – ${money(business.rent?.max_monthly)} / mo`, "written evidence required"],
    ["Shared-lot policy", business.site?.shared_lot, "ranked after standalone sites"],
    ["Flood zones excluded", business.flood?.high_risk_zones?.join(", "), "FEMA high-risk zones"],
    ["Search schedule", business.schedule?.cron, business.schedule?.timezone],
  ];
  $("#business-config").innerHTML = configRows.map(([key, value, note]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? "Not configured")}<span class="sub">${escapeHtml(note ?? "")}</span></dd></div>`).join("");
  const providers = report.config?.providers?.providers ?? report.config?.providers ?? {};
  const paidEnabled = Boolean(report.config?.providers?.paid_enabled);
  $("#paid-indicator").className = `paid-indicator paid-${paidEnabled ? "on" : "off"}`;
  $("#paid-indicator").innerHTML = `${icon(paidEnabled ? "alert" : "check")}Paid providers: ${paidEnabled ? "on" : "off"}`;
  $("#providers-body").innerHTML = Object.entries(providers).map(([layer, provider]) => `<tr><td data-label="Layer" class="mono">${escapeHtml(layer)}</td><td data-label="Selected provider"><span class="addr">${escapeHtml(provider)}</span></td><td data-label="Cost"><span class="cost ${paidEnabled ? "cost-paid" : "cost-free"}">${paidEnabled ? "configured" : "free/default"}</span></td><td data-label="Enabled"><span class="onoff onoff-on"><span class="sw"></span>on</span></td></tr>`).join("");
  $("#run-id").textContent = report.runId;
  const summary = [
    ["Generated", formatDate(report.generatedAt, { dateStyle: "medium", timeStyle: "short" })],
    ["Sites", report.pipeline.length], ["Viable", report.shortlist.length], ["Cases open", report.cases.length],
    ["Exceptions", report.exceptions.length], ["Paid providers", paidEnabled ? "on" : "off"],
    ["Mail", paused ? "paused" : "ready"], ["Status", "complete"],
  ];
  $("#run-summary").innerHTML = summary.map(([key, value]) => `<div><div class="k">${escapeHtml(key)}</div><div class="v">${escapeHtml(value)}</div></div>`).join("");
}

function showView(view) {
  const allowed = ["shortlist", "pipeline", "exceptions", "config"];
  const selected = allowed.includes(view) ? view : "shortlist";
  document.querySelectorAll(".dashboard-view").forEach((page) => {
    const active = page.dataset.page === selected;
    page.hidden = !active;
    page.removeAttribute("id");
    if (active) page.id = "main";
  });
  document.querySelectorAll(".nav a[data-view]").forEach((link) => {
    if (link.dataset.view === selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `dealersource | ${selected[0].toUpperCase()}${selected.slice(1)}`;
}

function setupInteractions() {
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
  $(".theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("dealersource-theme", next);
  });
  const savedTheme = localStorage.getItem("dealersource-theme");
  if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;
  showView(location.hash.slice(1));
}

try {
  const report = await loadReport();
  const paused = renderExceptions(report);
  renderShortlist(report);
  renderPipeline(report);
  renderConfig(report, paused);
  const state = paused ? "paused" : "ok";
  $("#run-status").innerHTML = `<span class="dot dot-${state}" aria-hidden="true"></span><span>Last run <span class="mono">${escapeHtml(formatDate(report.generatedAt, { dateStyle: "medium", timeStyle: "short" }))}</span> · ${paused ? "Paused" : "Complete"}</span>`;
  $("#footer-run").textContent = report.runId;
  setupInteractions();
  await upgradeMap(report.shortlist);
} catch (error) {
  $("#main").innerHTML = `<div class="banner banner-failed" role="alert">${icon("x")}<div class="b-title">Dashboard unavailable</div><div class="b-meta"><span>${escapeHtml(error.message)}</span></div></div>`;
  $("#run-status").innerHTML = '<span class="dot dot-failed"></span><span>Data load failed</span>';
}
