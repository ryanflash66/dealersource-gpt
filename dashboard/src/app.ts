const runtime = window.DEALERSOURCE_CONFIG ?? {};
const $ = (selector) => document.querySelector(selector);
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

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

function formatDate(value, options = { dateStyle: "medium" }) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString([], options);
}

function sourceDomain(value) {
  try { return new URL(value).hostname; } catch { return "source"; }
}

function normalizeContractReport(report) {
  if (report?.schema_version !== "1") return report;
  const business = runtime.publicConfig?.business ?? {};
  const rentMin = Number(business.rent?.min_monthly ?? 600);
  const rentMax = Number(business.rent?.max_monthly ?? 1000);
  const maxDrive = Number(business.search?.max_drive_minutes ?? 60);
  const evidenceBySite = new Map();
  for (const item of report.evidence ?? []) {
    const rows = evidenceBySite.get(item.site_id) ?? [];
    rows.push(item);
    evidenceBySite.set(item.site_id, rows);
  }
  const pipeline = (report.sites ?? []).map((site) => {
    const metrics = site.metrics ?? {};
    const rentRange = Math.max(1, rentMax - rentMin);
    const score = site.score == null ? null : {
      traffic: Math.max(0, Math.min(35, Number(metrics.aadt ?? 0) / 30_000 * 35)),
      visibility: Math.max(0, Math.min(25, Number(metrics.visibility ?? 0) * 25)),
      distance: Math.max(0, Math.min(20, (1 - Number(site.drive_minutes ?? maxDrive) / maxDrive) * 20)),
      rent: Math.max(0, Math.min(12, (1 - (Number(metrics.rent_monthly ?? rentMax) - rentMin) / rentRange) * 12)),
      competitors: Math.max(0, Math.min(8, (1 - Number(metrics.competitors ?? 10) / 10) * 8)),
      total: Number(site.score),
    };
    const gates = ["zoning", "rent", "flood"].map((name) => {
      const evidenceId = site.gates?.[name]?.evidence_ids?.[0] ?? null;
      const item = (report.evidence ?? []).find((candidate) => candidate.evidence_id === evidenceId);
      return {
        name,
        status: site.gates?.[name]?.status ?? "pending",
        evidenceId,
        reason: site.gates?.[name]?.status === "pending" ? "Evidence is still pending." : "Contract evidence recorded.",
        sourceUrl: item?.source_url,
        fetchedAt: item?.fetched_at,
        expiresAt: item?.expires_at,
      };
    });
    return {
      id: site.site_id,
      siteKey: site.parcel_id,
      address: site.address,
      latitude: site.latitude ?? null,
      longitude: site.longitude ?? null,
      parcelId: site.parcel_id,
      listingIds: site.listing_ids,
      sourceUrls: (evidenceBySite.get(site.site_id) ?? []).map((item) => item.source_url),
      monthlyRent: metrics.rent_monthly,
      sharedLot: site.shared_lot,
      inSearchArea: site.in_search_area,
      stage: site.viable ? "reported" : !site.in_search_area || gates.some((gate) => gate.status === "fail") ? "excluded" : "verifying",
      metrics: {
        aadt: metrics.aadt,
        frontageFeet: Math.round(Number(metrics.visibility ?? 0) * 200),
        cornerLot: null,
        signageVisible: null,
        driveMinutes: site.drive_minutes,
        competitors: metrics.competitors,
      },
      imagery: [],
      gates,
      viable: site.viable,
      score,
      rank: site.rank,
    };
  });
  const cases = (report.sites ?? []).flatMap((site) => (site.open_cases ?? []).map((item, index) => ({
    id: `case-${site.site_id}-${item.case_type}-${index}`,
    siteId: site.site_id,
    type: item.case_type,
    owner: item.case_type === "zoning" ? "planning-authority" : "leasing-contact",
    recipient: item.recipient,
    status: item.status,
    openedAt: `${report.run_date}T10:00:00.000Z`,
    nextActionAt: `${report.run_date}T10:00:00.000Z`,
    followups: 0,
  })));
  return {
    generatedAt: `${report.run_date}T09:05:00.000Z`,
    runId: report.run_id,
    shortlist: pipeline.filter((site) => site.viable).sort((left, right) => left.rank - right.rank),
    pipeline,
    cases,
    exceptions: [],
    config: { business, providers: report.providers },
  };
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
  return normalizeContractReport(await response.json());
}

function gateStatus(value) {
  if (value === "pass" || value === "fail" || value === "stale") return value;
  return "pending";
}

function gateIcon(status) {
  return status === "pass" ? "check" : status === "fail" ? "x" : status === "stale" ? "alert" : "clock";
}

function gateResult(gate, compact = false) {
  const status = gateStatus(gate.status);
  const label = `${gate.name[0].toUpperCase()}${gate.name.slice(1)}`;
  if (compact) return `<span class="gate-pill ${status}">${escapeHtml(label)} ${status}</span>`;
  return `<span class="gate-result ${status}">${icon(gateIcon(status))}${escapeHtml(label)} ${status}</span>`;
}

function factorData(site) {
  const score = site.score ?? {};
  return [
    { label: "Traffic", height: Math.min(100, Math.max(8, Number(score.traffic ?? 0) / 35 * 100)), value: `${Number(site.metrics?.aadt ?? 0).toLocaleString()} /day` },
    { label: "Visibility", height: Math.min(100, Math.max(8, Number(score.visibility ?? 0) / 25 * 100)), value: `${site.metrics?.frontageFeet ?? 0} ft` },
    { label: "Drive", height: Math.min(100, Math.max(8, Number(score.distance ?? 0) / 20 * 100)), value: `${site.metrics?.driveMinutes ?? 0} min` },
    { label: "Rent", height: Math.min(100, Math.max(8, Number(score.rent ?? 0) / 12 * 100)), value: `${money(site.monthlyRent)}/mo` },
    { label: "Competitors", height: Math.min(100, Math.max(8, Number(score.competitors ?? 0) / 8 * 100)), value: `${site.metrics?.competitors ?? 0} nearby` },
  ];
}

function factorBars(site) {
  return `<div class="factor-bars" aria-label="Score factors">${factorData(site).map((factor) => `<div class="factor"><i style="height:${factor.height}%"></i></div>`).join("")}</div>`;
}

function renderSiteCard(site, index, selected = false) {
  const score = Math.round(Number(site.score?.total ?? 0));
  return `<article class="site-card${selected ? " is-selected" : ""}${site.sharedLot ? " is-shared" : ""}" data-site-id="${escapeHtml(site.id)}" role="button" tabindex="0" aria-label="Open details for ${escapeHtml(site.address)}">
    <div><div class="site-photo">Street photo</div><div class="site-rank"><strong>${index + 1}</strong><span>${score}</span></div></div>
    <div class="site-card-body"><div><div class="site-title"><span>${escapeHtml(site.address)}</span>${site.sharedLot ? '<span class="shared-badge">Shared lot, ranks last</span>' : ""}</div><div class="site-meta"><span class="mono">${escapeHtml(site.parcelId ?? "parcel pending")}</span> · ${escapeHtml(site.metrics?.driveMinutes ?? 0)} min · ${site.listingIds?.length ?? 1} listing${site.listingIds?.length === 1 ? "" : "s"} · ${money(site.monthlyRent)}/mo</div></div><div class="site-lower"><div class="gate-row">${(site.gates ?? []).map((gate) => gateResult(gate)).join("")}</div>${factorBars(site)}</div></div>
  </article>`;
}

function oneAwaySites(report) {
  return report.pipeline.filter((site) => {
    const statuses = (site.gates ?? []).map((gate) => gateStatus(gate.status));
    return !site.viable && statuses.filter((status) => status === "pending" || status === "stale").length === 1 && !statuses.includes("fail");
  });
}

function renderPendingCard(site, report) {
  const pendingGate = site.gates.find((gate) => ["pending", "stale"].includes(gateStatus(gate.status)));
  const itemCase = report.cases.find((item) => item.siteId === site.id);
  return `<article class="site-card pending-card"><div class="site-photo">Street photo</div><div class="site-card-body"><div><div class="site-title"><span>${escapeHtml(site.address)}</span></div><div class="site-meta"><span class="mono">${escapeHtml(site.parcelId)}</span> · ${escapeHtml(site.metrics?.driveMinutes)} min · ${money(site.monthlyRent)}/mo</div></div><div class="gate-row">${site.gates.map((gate) => gateResult(gate)).join("")}</div><div class="score-note">No score until viable.</div><div class="case-note">${itemCase ? `${escapeHtml(pendingGate.name)} case to ${escapeHtml(itemCase.recipient ?? itemCase.owner)} · next follow-up ${escapeHtml(formatDate(itemCase.nextActionAt))}` : `${escapeHtml(pendingGate.name)} evidence required`}</div></div></article>`;
}

function evidenceMarkup(site, report) {
  return (site.gates ?? []).map((gate) => {
    const status = gateStatus(gate.status);
    const source = gate.sourceUrl ?? site.sourceUrls?.[0];
    const link = source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener">Open${icon("external")}</a>` : "";
    return `<div class="evidence-row"><div><div class="fact-line ${status}">${icon(gateIcon(status))}${escapeHtml(gate.name)} ${status}<span>· ${escapeHtml(gate.reason ?? "Evidence recorded")}</span></div><div class="evidence-meta">${escapeHtml(source ? sourceDomain(source) : "source unavailable")} · verified source · fetched ${escapeHtml(formatDate(gate.fetchedAt ?? report.generatedAt))}${gate.expiresAt ? ` · expires ${escapeHtml(formatDate(gate.expiresAt))}` : ""}</div></div>${link}</div>`;
  }).join("");
}

function renderDrawer(site, index, report) {
  const factors = factorData(site);
  $("#site-drawer").innerHTML = `<div class="drawer-head"><div><div class="drawer-title"><span class="drawer-rank">${index + 1}</span>${escapeHtml(site.address)}</div><div class="drawer-meta"><span class="mono">${escapeHtml(site.parcelId)}</span> · ${escapeHtml(site.metrics?.driveMinutes)} min from home base · ${site.sharedLot ? "shared lot" : "standalone lot"}</div></div></div><div class="drawer-body"><div class="drawer-images"><div class="drawer-image">Street photo</div><div class="drawer-image">Aerial</div></div><div class="viable-banner"><strong>${icon("check-circle")}Viable. All three gates passed.</strong><span>Score ${Math.round(Number(site.score?.total ?? 0))}</span></div><div><div class="eyebrow">Gates and evidence</div>${evidenceMarkup(site, report)}</div><div><div class="eyebrow">Why it ranks ${index === 0 ? "first" : `#${index + 1}`}</div><div class="factor-detail">${factors.map((factor, factorIndex) => `<div><div class="bar factor factor-${factorIndex + 1}"><i style="height:${factor.height}%"></i></div><small>${factor.label}</small><b>${escapeHtml(factor.value)}</b></div>`).join("")}</div></div><div><div class="eyebrow">Merged listings</div><div class="case-note">${site.listingIds?.length ?? 1} source record${site.listingIds?.length === 1 ? "" : "s"} merged into this site.</div></div></div>`;
}

function markerPosition(site, sites) {
  const lats = sites.map((item) => Number(item.latitude));
  const lons = sites.map((item) => Number(item.longitude));
  const minLat = Math.min(...lats) - .03, maxLat = Math.max(...lats) + .03;
  const minLon = Math.min(...lons) - .03, maxLon = Math.max(...lons) + .03;
  return { left: 8 + ((Number(site.longitude) - minLon) / (maxLon - minLon || 1)) * 84, top: 92 - ((Number(site.latitude) - minLat) / (maxLat - minLat || 1)) * 84 };
}

function renderMap(report) {
  const pending = oneAwaySites(report);
  const sites = [...report.shortlist, ...pending];
  const map = $("#map-static");
  if (!sites.length) { map.innerHTML = '<div class="empty">No candidate sites to map.</div>'; return; }
  map.innerHTML = `<span class="map-home" style="left:48%;top:46%">${icon("home")}</span>${sites.map((site) => {
    const index = report.shortlist.findIndex((item) => item.id === site.id);
    const position = markerPosition(site, sites);
    return `<button class="map-marker${index < 0 ? " pending" : ""}" style="left:${position.left}%;top:${position.top}%" data-site-id="${escapeHtml(site.id)}" aria-label="${index < 0 ? "Pending" : `Rank ${index + 1}`}, ${escapeHtml(site.address)}">${index < 0 ? "?" : index + 1}</button>`;
  }).join("")}`;
  map.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    const index = report.shortlist.findIndex((site) => site.id === button.dataset.siteId);
    if (index >= 0) selectSite(index, report);
  }));
}

function selectSite(index, report) {
  document.querySelectorAll(".site-card[data-site-id]").forEach((card) => card.classList.toggle("is-selected", card.dataset.siteId === report.shortlist[index].id));
  renderDrawer(report.shortlist[index], index, report);
}

async function upgradeMap(report) {
  if (!runtime.mapStyleUrl || !runtime.maplibreAssetUrl || !report.shortlist.length) return;
  try {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${runtime.maplibreAssetUrl.replace(/\/$/, "")}/maplibre-gl.css`;
    document.head.append(css);
    const module = await import(`${runtime.maplibreAssetUrl.replace(/\/$/, "")}/maplibre-gl.js`);
    const maplibregl = module.default ?? module;
    const map = new maplibregl.Map({ container: "map", style: runtime.mapStyleUrl, center: [-77.36, 35.61], zoom: 8 });
    const primary = getComputedStyle($("#app")).getPropertyValue("--primary").trim();
    for (const site of report.shortlist) new maplibregl.Marker({ color: primary }).setLngLat([site.longitude, site.latitude]).setPopup(new maplibregl.Popup().setText(site.address)).addTo(map);
    map.on("load", () => { $("#map-static").hidden = true; });
  } catch (error) {
    console.warn("MapLibre unavailable; retaining the static preview.", error);
  }
}

function pipelineStage(site) {
  if (site.inSearchArea === false) return "excluded";
  if (site.viable || site.stage === "reported" || site.stage === "scored") return "scored";
  if ((site.gates ?? []).some((gate) => gateStatus(gate.status) === "fail")) return "excluded";
  return ["discovered", "resolved", "enriched", "verifying"].includes(site.stage) ? site.stage : "verifying";
}

function stageNote(stage) {
  return { discovered: "listing or parcel seen", resolved: "merged candidate sites", enriched: "facts fetched", verifying: "waiting on evidence", scored: "viable and ranked", excluded: "failed a gate" }[stage];
}

function stageColor(stage) {
  return { discovered: "var(--stage-1)", resolved: "var(--stage-2)", enriched: "var(--stage-3)", verifying: "var(--stage-4)", scored: "var(--stage-5)", excluded: "var(--stage-6)" }[stage];
}

function renderShortlist(report) {
  const almost = oneAwaySites(report);
  const excluded = report.pipeline.filter((site) => pipelineStage(site) === "excluded").length;
  const verifying = report.pipeline.filter((site) => pipelineStage(site) === "verifying").length;
  const metrics = [["Viable", report.shortlist.length], ["One away", almost.length], ["Verifying", verifying], ["Excluded", excluded]];
  $("#shortlist-metrics").innerHTML = metrics.map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#shortlist").innerHTML = report.shortlist.map((site, index) => renderSiteCard(site, index, index === 0)).join("");
  $("#almost-list").innerHTML = almost.length ? almost.map((site) => renderPendingCard(site, report)).join("") : '<div class="empty">No site is exactly one answer away.</div>';
  document.querySelectorAll(".site-card[data-site-id]").forEach((card) => {
    const open = () => selectSite(report.shortlist.findIndex((site) => site.id === card.dataset.siteId), report);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });
  if (report.shortlist.length) renderDrawer(report.shortlist[0], 0, report);
  renderMap(report);
}

function renderPipeline(report) {
  const stages = ["discovered", "resolved", "enriched", "verifying", "scored", "excluded"];
  $("#pipeline-meta").textContent = `${report.pipeline.length} sites · ${report.cases.length} open cases`;
  $("#stage-strip").innerHTML = stages.map((stage) => `<div class="stage" style="--stage-color:${stageColor(stage)}"><div class="label">${stage[0].toUpperCase()}${stage.slice(1)}</div><div class="count">${report.pipeline.filter((site) => pipelineStage(site) === stage).length}</div><div class="note">${stageNote(stage)}</div></div>`).join("");
  $("#pipeline-rows").innerHTML = report.pipeline.map((site) => {
    const stage = pipelineStage(site);
    const rank = report.shortlist.findIndex((item) => item.id === site.id);
    const statuses = (site.gates ?? []).map((gate) => gateStatus(gate.status));
    const outcome = rank >= 0 ? `Rank ${rank + 1}, score ${Math.round(Number(site.score?.total ?? 0))}` : statuses.includes("fail") ? site.gates.find((gate) => gateStatus(gate.status) === "fail")?.reason : "One answer away";
    const outcomeClass = statuses.includes("fail") ? "fail" : rank < 0 ? "wait" : "";
    return `<div class="pipeline-row"><span class="parcel">${escapeHtml(site.parcelId)}</span><div><div class="site-name">${escapeHtml(site.address)}</div><div class="row-sub">${site.listingIds?.length ?? 1} listing${site.listingIds?.length === 1 ? "" : "s"} · ${escapeHtml(site.metrics?.driveMinutes)} min${site.sharedLot ? " · shared lot" : ""}</div></div><span class="stage-label" style="--stage-color:${stageColor(stage)}"><i class="stage-dot"></i>${stage[0].toUpperCase()}${stage.slice(1)}</span><div class="gate-pills">${site.gates?.length ? site.gates.map((gate) => gateResult(gate, true)).join("") : '<span class="row-sub">Not checked</span>'}</div><span class="outcome ${outcomeClass}">${escapeHtml(outcome)}</span></div>`;
  }).join("");
  $("#case-rows").innerHTML = report.cases.length ? report.cases.map((item) => {
    const site = report.pipeline.find((candidate) => candidate.id === item.siteId);
    const status = item.status === "replied" ? "answered" : item.status === "held" || item.status === "bounced" ? "held" : "awaiting";
    const age = Math.max(0, Math.floor((new Date(report.generatedAt) - new Date(item.openedAt)) / 86400000));
    return `<div class="case-row"><div><strong>${escapeHtml(site?.address ?? item.siteId)} · ${escapeHtml(item.type)}</strong><p>To ${escapeHtml(item.recipient ?? item.owner)}</p><p>Opened ${escapeHtml(formatDate(item.openedAt))} · <span class="mono">${age} d</span> · ${escapeHtml((item.followups ?? 0) + 1)} email${item.followups ? "s" : ""} sent</p><p class="next">Next: follow-up ${escapeHtml(formatDate(item.nextActionAt))}</p></div><span class="status-pill ${status}">${status === "answered" ? "Answered" : status === "held" ? "Held, sending paused" : "Awaiting reply"}</span></div>`;
  }).join("") : '<div class="empty">No open cases.</div>';
}

function isPaused(report) {
  return Boolean(report.config?.business?.mail?.paused) || report.exceptions.some((item) => /paused|bounce/i.test(`${item.type} ${item.message}`));
}

function renderExceptions(report) {
  const paused = isPaused(report);
  $("#exceptions-meta").textContent = `${report.exceptions.length} open`;
  $("#exception-count").textContent = report.exceptions.length;
  $("#exception-count").classList.toggle("is-alert", report.exceptions.length > 0);
  $("#pause-card").innerHTML = paused ? `<div class="pause-card"><span class="pause-disc">${icon("pause")}</span><div><h2>Email sending paused.</h2><p>A recorded bounce or system pause stopped outreach. Runs continue and records still update. No follow-ups go out until the issue is resolved.</p></div><div class="pause-stats"><div>${report.cases.length} case${report.cases.length === 1 ? "" : "s"} waiting</div><div>Follow-ups held</div></div></div>` : "";
  $("#exceptions-list").innerHTML = report.exceptions.length ? report.exceptions.map((item) => `<div class="exception-row"><div><strong>${escapeHtml(item.type)}</strong><p>${escapeHtml(item.message)}</p></div><span class="neutral-pill">${item.severity === "error" ? "Failed today" : "Excluded by policy"}</span></div>`).join("") : '<div class="empty">No source or provider exceptions.</div>';
  const stale = report.pipeline.flatMap((site) => (site.gates ?? []).filter((gate) => gateStatus(gate.status) === "stale").map((gate) => ({ site, gate })));
  $("#evidence-exceptions").innerHTML = stale.length ? stale.map(({ site, gate }) => `<div class="evidence-exception stale"><div><strong>${escapeHtml(gate.name)} evidence · ${escapeHtml(site.address)}</strong><p>${escapeHtml(gate.reason)} · re-fetch queued</p></div><span class="neutral-pill">Expired</span></div>`).join("") : '<div class="empty">No evidence is expired in this report.</div>';
  return paused;
}

function renderConfig(report, paused) {
  const business = report.config?.business ?? {};
  const rows = [
    ["Home base", business.search?.home_base, "Search center for drive time"],
    ["Drive time", `${business.search?.max_drive_minutes ?? "?"} min`, "Maximum from home base"],
    ["Monthly rent", `${money(business.rent?.min_monthly)} to ${money(business.rent?.max_monthly)}`, "Written quote required"],
    ["Vehicle display", `${business.site?.min_vehicle_display ?? "?"} minimum`, "Office required"],
    ["Shared lots", business.site?.shared_lot, "Always ranked after standalone sites"],
    ["Flood zones", business.flood?.high_risk_zones?.join(", "), "Excluded high-risk zones"],
    ["Follow-ups", `${business.mail?.max_followups ?? "?"} per case`, `${business.mail?.followup_days ?? "?"} days apart`],
  ];
  $("#business-config").innerHTML = rows.map(([label, value, note]) => `<div class="kv-row"><span>${escapeHtml(label)}</span><div><strong>${escapeHtml(value ?? "Not configured")}</strong><small>${escapeHtml(note)}</small></div></div>`).join("");
  const runRows = [["Generated", formatDate(report.generatedAt, { dateStyle: "medium", timeStyle: "short" })], ["Sites", report.pipeline.length], ["Viable", report.shortlist.length], ["Open cases", report.cases.length], ["Exceptions", report.exceptions.length], ["Status", paused ? "sending paused" : "complete"]];
  $("#run-id").textContent = report.runId;
  $("#run-summary").innerHTML = runRows.map(([label, value]) => `<div class="kv-row"><span>${escapeHtml(label)}</span><div><strong class="mono">${escapeHtml(value)}</strong></div></div>`).join("");
  const providers = report.config?.providers?.providers ?? report.config?.providers ?? {};
  const paid = Boolean(report.config?.providers?.paid_enabled);
  $("#paid-indicator").innerHTML = `<span class="cost-pill ${paid ? "paid" : "free"}">${paid ? "Paid" : "Free"}</span> ${paid ? "Paid providers enabled" : "All selected providers use the free configuration"}`;
  $("#provider-rows").innerHTML = Object.entries(providers).filter(([kind]) => kind !== "paid_enabled").map(([kind, provider]) => `<div class="provider-row"><span class="kind">${escapeHtml(kind)}</span><div><strong>${escapeHtml(provider)}</strong><small>Selected provider</small></div><span class="row-sub">Fixture input</span><span class="cost-pill ${paid ? "paid" : "free"}">${paid ? "Paid" : "Free"}</span><span class="provider-status">OK</span></div>`).join("");
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
  document.querySelectorAll(".pill-nav a[data-view]").forEach((link) => {
    if (link.dataset.view === selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  $("#health-strip").hidden = selected !== "shortlist";
  $("#app").classList.toggle("shortlist-active", selected === "shortlist");
  document.title = `dealersource | ${selected === "config" ? "Configuration" : selected[0].toUpperCase() + selected.slice(1)}`;
}

function setupInteractions() {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = () => $("#app").classList.toggle("dark", media.matches);
  applyTheme();
  media.addEventListener?.("change", applyTheme);
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1));
}

try {
  const report = await loadReport();
  const paused = renderExceptions(report);
  renderShortlist(report);
  renderPipeline(report);
  renderConfig(report, paused);
  $("#report-date").textContent = `Report ${formatDate(report.generatedAt, { dateStyle: "medium" })}`;
  $("#run-status").innerHTML = paused ? `<span class="status-with-icon status-paused">${icon("pause")}Sending paused</span><span>Last run ${formatDate(report.generatedAt, { timeStyle: "short" })}</span>` : `<span class="status-with-icon status-ok">${icon("check-circle")}Running</span><span>Last run ${formatDate(report.generatedAt, { timeStyle: "short" })}</span>`;
  $("#health-strip").classList.toggle("is-paused", paused);
  $("#health-strip").innerHTML = `<strong>${icon(paused ? "pause" : "check-circle")}${paused ? "Sending paused" : "Automation running"}</strong><span>Last run ${formatDate(report.generatedAt, { dateStyle: "medium", timeStyle: "short" })}</span><span><span class="mono">${report.pipeline.length}</span> sites · <span class="mono">${report.shortlist.length}</span> viable</span><span><span class="mono">${report.cases.length}</span> open case${report.cases.length === 1 ? "" : "s"}</span><span><span class="mono">${report.exceptions.length}</span> exceptions</span><span class="push">Free sources only</span>`;
  setupInteractions();
  await upgradeMap(report);
} catch (error) {
  $("#main").innerHTML = `<div class="pause-card"><span class="pause-disc">${icon("x")}</span><div><h2>Dashboard unavailable.</h2><p>${escapeHtml(error.message)}</p></div></div>`;
  $("#run-status").innerHTML = `<span class="status-with-icon status-failed">${icon("x")}Data load failed</span>`;
}
