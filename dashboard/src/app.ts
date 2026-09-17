// The browser renderer stays JavaScript-compatible; the data rules live in the typed view model.
// @ts-nocheck
import {
  evidenceExceptions,
  evidenceFact,
  exclusionOutcome,
  gateStatus,
  normalizeContractReport,
  oneAwaySites,
  pipelineStage,
  pipelineRowView,
  reportAge,
  resolveTheme,
  stageCounts,
} from "./view-model.js";

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
  const [reportResponse, messagesResponse, runResponse] = await Promise.all([
    fetch("/data.json"),
    fetch("/messages.json").catch(() => null),
    fetch("/run.json").catch(() => null),
  ]);
  if (!reportResponse.ok) throw new Error("Fixture report could not be loaded.");
  const messages = messagesResponse?.ok ? await messagesResponse.json() : [];
  const run = runResponse?.ok ? await runResponse.json() : {};
  return normalizeContractReport(await reportResponse.json(), messages, run, runtime.publicConfig);
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

function renderPendingCard(site, report) {
  const pendingGate = site.gates.find((gate) => ["pending", "stale"].includes(gateStatus(gate.status)));
  const itemCase = report.cases.find((item) => item.siteId === site.id);
  const age = itemCase ? Math.max(0, Math.floor((new Date(report.generatedAt) - new Date(itemCase.openedAt)) / 86400000)) : 0;
  return `<article class="site-card pending-card" data-site-id="${escapeHtml(site.id)}" role="button" tabindex="0" aria-label="Open details for ${escapeHtml(site.address)}"><div class="site-photo">Street photo</div><div class="site-card-body"><div><div class="site-title"><span>${escapeHtml(site.address)}</span></div><div class="site-meta"><span class="mono">${escapeHtml(site.parcelId)}</span> · ${escapeHtml(site.metrics?.driveMinutes)} min · ${money(site.monthlyRent)}/mo</div></div><div class="gate-row">${site.gates.map((gate) => gateResult(gate)).join("")}</div><div class="score-note">No score until viable.</div><div class="case-note">${itemCase ? `${escapeHtml(pendingGate.name)} case to ${escapeHtml(itemCase.recipient ?? itemCase.owner)} · ${age} d old · next follow-up ${escapeHtml(formatDate(itemCase.nextActionAt))}` : `${escapeHtml(pendingGate.name)} evidence required`}</div></div></article>`;
}

function evidenceMarkup(site, report) {
  return (site.gates ?? []).map((gate) => {
    const status = gateStatus(gate.status);
    const source = gate.sourceUrl ?? site.sourceUrls?.[0];
    const link = source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener">Open${icon("external")}</a>` : "";
    return `<div class="evidence-row"><div><div class="fact-line ${status}">${icon(gateIcon(status))}${escapeHtml(gate.name)} ${status}<span>· ${escapeHtml(gate.reason ?? "Evidence pending")}</span></div><div class="evidence-meta">${escapeHtml(source ? sourceDomain(source) : "source unavailable")} · ${escapeHtml(gate.method ?? "recorded evidence")} · fetched ${escapeHtml(formatDate(gate.fetchedAt ?? report.generatedAt))}${gate.expiresAt ? ` · expires ${escapeHtml(formatDate(gate.expiresAt))}` : ""}</div></div>${link}</div>`;
  }).join("");
}

function listingMarkup(site) {
  return (site.listings ?? []).map((listing) => {
    const source = listing.source_id ?? (listing.url ? sourceDomain(listing.url) : "source unavailable");
    const rent = listing.rent_monthly == null ? "rent not stated" : `${money(listing.rent_monthly)}/mo`;
    const text = `${listing.listing_id} · ${source} · ${rent}`;
    return listing.url ? `<a class="detail-row" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener">${escapeHtml(text)}${icon("external")}</a>` : `<div class="detail-row">${escapeHtml(text)}</div>`;
  }).join("");
}

function drawerCaseMarkup(site) {
  if (!site.openCases?.length) return '<div class="case-note">None. Every gate was answered by public records, a listing, or a recorded reply.</div>';
  return site.openCases.map((item) => `<div class="drawer-case"><strong>${escapeHtml(item.type)} · ${escapeHtml(item.recipient ?? item.owner)}</strong><span>Opened ${escapeHtml(formatDate(item.openedAt))} · ${item.emailsSent} email${item.emailsSent === 1 ? "" : "s"} sent</span><span>Next: follow-up ${escapeHtml(formatDate(item.nextActionAt))}</span></div>`).join("");
}

function renderDrawer(site, report) {
  const factors = factorData(site);
  const rank = site.rank ?? "?";
  const banner = site.viable
    ? `<div class="viable-banner"><strong>${icon("check-circle")}Viable. All three gates passed.</strong><span>Score ${Math.round(Number(site.score?.total ?? 0))}</span></div>`
    : `<div class="pending-banner"><strong>${icon("clock")}Not yet viable. Required evidence is pending.</strong></div>`;
  const factorsMarkup = site.viable ? `<div><div class="eyebrow">Why it ranks ${rank === 1 ? "first" : `#${rank}`}</div><div class="factor-detail">${factors.map((factor, factorIndex) => `<div><div class="bar factor factor-${factorIndex + 1}"><i style="height:${factor.height}%"></i></div><small>${factor.label}</small><b>${escapeHtml(factor.value)}</b></div>`).join("")}</div></div>` : "";
  $("#site-drawer").innerHTML = `<div class="drawer-head"><div><div class="drawer-title"><span class="drawer-rank">${rank}</span>${escapeHtml(site.address)}</div><div class="drawer-meta"><span class="mono">${escapeHtml(site.parcelId)}</span> · ${escapeHtml(site.metrics?.driveMinutes)} min from home base · ${site.inSearchArea ? "inside search area" : "outside search area"} · ${site.sharedLot ? "shared lot" : "standalone lot"}</div></div></div><div class="drawer-body"><div class="drawer-images"><div class="drawer-image">Street photo</div><div class="drawer-image">Aerial</div></div>${banner}<div><div class="eyebrow">Gates and evidence</div>${evidenceMarkup(site, report)}</div>${factorsMarkup}<div><div class="eyebrow">Merged from ${site.listingIds?.length ?? 0} listing${site.listingIds?.length === 1 ? "" : "s"}</div><div class="detail-list">${listingMarkup(site)}</div></div><div><div class="eyebrow">Open cases</div><div class="detail-list">${drawerCaseMarkup(site)}</div></div></div>`;
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
    selectSite(button.dataset.siteId, report);
  }));
}

function selectSite(siteId, report) {
  const site = report.pipeline.find((candidate) => candidate.id === siteId);
  if (!site) return;
  document.querySelectorAll(".site-card[data-site-id]").forEach((card) => card.classList.toggle("is-selected", card.dataset.siteId === site.id));
  renderDrawer(site, report);
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
    const open = () => selectSite(card.dataset.siteId, report);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
  });
  if (report.shortlist.length) renderDrawer(report.shortlist[0], report);
  renderMap(report);
}

function renderPipeline(report) {
  const stages = ["discovered", "resolved", "enriched", "verifying", "scored", "excluded"];
  const counts = stageCounts(report);
  const evidenceById = new Map((report.evidence ?? []).map((item) => [item.evidence_id, item]));
  $("#pipeline-meta").textContent = `${counts.discovered} listings merged into ${counts.resolved} sites this run`;
  $("#stage-strip").innerHTML = stages.map((stage) => `<div class="stage" style="--stage-color:${stageColor(stage)}"><div class="label">${stage[0].toUpperCase()}${stage.slice(1)}</div><div class="count">${counts[stage]}</div><div class="note">${stageNote(stage)}</div></div>`).join("");
  $("#pipeline-rows").innerHTML = report.pipeline.map((site) => {
    const row = pipelineRowView(site, evidenceById, report.config?.business ?? {});
    const gates = row.showGates ? site.gates?.map((gate) => gateResult(gate, true)).join("") : '<span class="row-sub">Not checked</span>';
    return `<div class="pipeline-row"><span class="parcel">${escapeHtml(site.parcelId)}</span><div><div class="site-name">${escapeHtml(site.address)}</div><div class="row-sub">${site.listingIds?.length ?? 1} listing${site.listingIds?.length === 1 ? "" : "s"} · ${escapeHtml(site.metrics?.driveMinutes)} min${site.sharedLot ? " · shared lot" : ""}</div></div><span class="stage-label" style="--stage-color:${stageColor(row.stage)}"><i class="stage-dot"></i>${row.stage[0].toUpperCase()}${row.stage.slice(1)}</span><div class="gate-pills">${gates}</div><span class="outcome ${row.outcomeClass}">${escapeHtml(row.outcome)}</span></div>`;
  }).join("");
  $("#case-rows").innerHTML = report.cases.length ? report.cases.map((item) => {
    const site = report.pipeline.find((candidate) => candidate.id === item.siteId);
    const status = item.status === "replied" ? "answered" : item.status === "held" || item.status === "bounced" ? "held" : "awaiting";
    const age = Math.max(0, Math.floor((new Date(report.generatedAt) - new Date(item.openedAt)) / 86400000));
    return `<div class="case-row"><div><strong>${escapeHtml(site?.address ?? item.siteId)} · ${escapeHtml(item.type)}</strong><p>To ${escapeHtml(item.recipient ?? item.owner)}</p><p>Opened ${escapeHtml(formatDate(item.openedAt))} · <span class="mono">${age} d</span> · ${escapeHtml(item.emailsSent ?? (item.followups ?? 0) + 1)} email${(item.emailsSent ?? 1) === 1 ? "" : "s"} sent</p><p class="next">Next: follow-up ${escapeHtml(formatDate(item.nextActionAt))}</p></div><span class="status-pill ${status}">${status === "answered" ? "Answered" : status === "held" ? "Held, sending paused" : "Awaiting reply"}</span></div>`;
  }).join("") : '<div class="empty">No open cases.</div>';
  $("#message-rows").innerHTML = report.messages.length ? report.messages.map((message) => `<div class="message-row"><span class="mono">${escapeHtml(formatDate(message.sent_at, { timeStyle: "short" }))}</span><div><strong>${escapeHtml(message.subject)}</strong><p>To ${escapeHtml(message.to)} · ${escapeHtml(message.case_type)}</p></div></div>`).join("") : '<div class="empty">No emails sent this run.</div>';
}

function isPaused(report) {
  return Boolean(report.config?.business?.mail?.paused) || report.exceptions.some((item) => /paused|bounce/i.test(`${item.type} ${item.message}`));
}

function renderExceptions(report) {
  const paused = isPaused(report);
  $("#exceptions-meta").textContent = `${report.exceptions.length} open`;
  $("#exception-count").textContent = report.exceptions.length;
  $("#exception-count").classList.toggle("is-alert", report.exceptions.length > 0);
  $("#pause-card").innerHTML = paused
    ? `<div class="pause-card"><span class="pause-disc">${icon("pause")}</span><div><h2>Email sending paused.</h2><p>${escapeHtml(report.config?.business?.mail?.pause_reason ?? "A recorded bounce or system pause stopped outreach.")} Runs continue and records still update. No follow-ups go out until sending resumes.</p></div><div class="pause-stats"><div>${report.cases.length} case${report.cases.length === 1 ? "" : "s"} waiting</div><div>Follow-ups held</div></div></div>`
    : `<div class="sending-card"><span>${icon("check-circle")}</span><div><h2>Email sending is on.</h2><p>${report.messages.length} message${report.messages.length === 1 ? "" : "s"} sent this run. Follow-ups remain enabled.</p></div></div>`;
  const exceptionRows = report.exceptions.map((item) => {
    const label = item.label ?? item.type;
    const title = item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(label)}${icon("external")}</a>` : escapeHtml(label);
    return `<div class="exception-row"><div><strong>${title}</strong><p>${escapeHtml(item.message)}</p></div><span class="neutral-pill">${escapeHtml(item.status ?? (item.severity === "error" ? "Failed today" : "Excluded by terms"))}</span></div>`;
  }).join("");
  const failureSummary = report.run?.errors?.length ? "" : '<div class="exception-row"><div><strong>Source failures</strong><p>None this run. Every configured source completed or was excluded before fetching.</p></div><span class="status-pill answered">OK</span></div>';
  $("#exceptions-list").innerHTML = `${failureSummary}${exceptionRows}` || '<div class="empty">No source failures or terms exclusions are recorded.</div>';
  const expiring = evidenceExceptions(report);
  $("#evidence-exceptions").innerHTML = expiring.length ? expiring.map((item) => {
    const site = report.pipeline.find((candidate) => candidate.id === item.site_id);
    const expired = item.expiresIn <= 0;
    const days = Math.max(1, Math.ceil(item.expiresIn / 86400000));
    const source = item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener">Open${icon("external")}</a>` : "";
    return `<div class="evidence-exception${expired ? " stale" : ""}"><div><strong>${escapeHtml(evidenceFact(item, report.config?.business ?? {}))} · ${escapeHtml(site?.address ?? item.site_id)}</strong><p>${escapeHtml(sourceDomain(item.source_url))} · fetched ${escapeHtml(formatDate(item.fetched_at))} · expires ${escapeHtml(formatDate(item.expires_at))}</p></div><span class="neutral-pill">${expired ? "Expired" : `Expires in ${days} d`}</span>${source}</div>`;
  }).join("") : '<div class="empty">No evidence expires within seven days.</div>';
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
  const explicitTheme = new URLSearchParams(location.search).get("theme");
  const applyTheme = () => {
    const theme = resolveTheme(location.search, media.matches);
    $("#app").classList.toggle("dark", theme === "dark");
    $("#app").dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  applyTheme();
  if (explicitTheme !== "light" && explicitTheme !== "dark") media.addEventListener?.("change", applyTheme);
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
  const age = reportAge(report.generatedAt);
  const stale = age.stale && !paused;
  $("#run-status").innerHTML = paused
    ? `<span class="status-with-icon status-paused">${icon("pause")}Sending paused</span><span>Last run ${formatDate(report.generatedAt, { timeStyle: "short" })}</span>`
    : stale
      ? `<span class="status-with-icon status-stale">${icon("clock")}Report stale</span><span>Last run ${formatDate(report.generatedAt, { dateStyle: "medium" })}</span>`
      : `<span class="status-with-icon status-ok">${icon("check-circle")}Running</span><span>Last run ${formatDate(report.generatedAt, { timeStyle: "short" })}</span>`;
  $("#health-strip").classList.toggle("is-paused", paused);
  $("#health-strip").classList.toggle("is-stale", stale);
  $("#health-strip").innerHTML = stale
    ? `<strong>${icon("clock")}Report is ${age.hours} hours old.</strong><span>Today's run has not finished.</span><span class="push">Last completed ${formatDate(report.generatedAt, { dateStyle: "medium", timeStyle: "short" })}</span>`
    : `<strong>${icon(paused ? "pause" : "check-circle")}${paused ? "Sending paused" : "Automation running"}</strong><span>Last run ${formatDate(report.generatedAt, { dateStyle: "medium", timeStyle: "short" })}</span><span><span class="mono">${report.run?.counts?.listings ?? 0}</span> listings merged into <span class="mono">${report.pipeline.length}</span> sites</span><span><span class="mono">${report.messages.length}</span> emails sent</span><span><span class="mono">${report.run?.counts?.replies_visible ?? 0}</span> replies</span><span class="push">${report.run?.errors?.length ?? 0} errors · free sources only</span>`;
  setupInteractions();
  await upgradeMap(report);
} catch (error) {
  $("#main").innerHTML = `<div class="pause-card"><span class="pause-disc">${icon("x")}</span><div><h2>Dashboard unavailable.</h2><p>${escapeHtml(error.message)}</p></div></div>`;
  $("#run-status").innerHTML = `<span class="status-with-icon status-failed">${icon("x")}Data load failed</span>`;
}
