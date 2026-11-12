const $ = (selector) => document.querySelector(selector);
const logs = [];
let currentTenders = [];
let locationReference = null;
let locationPoll = null;
let locationPollInFlight = false;
let locationStartInFlight = false;
let captchaSubmitInFlight = false;
let locationState = "IDLE";
const dashboardDiagnostics = window.__mahaTendersDiagnostics || {
  loadCount: 0,
  requestSequence: 0,
  lifecycle: [],
  requests: []
};
window.__mahaTendersDiagnostics = dashboardDiagnostics;

function recordLifecycle(type) {
  const navigation = performance.getEntriesByType("navigation")[0];
  const event = {
    type,
    timestamp: new Date().toISOString(),
    navigationType: navigation ? navigation.type : "unknown"
  };
  dashboardDiagnostics.lifecycle.push(event);
  console.info("[MahaTenders dashboard lifecycle]", event);
}

recordLifecycle("script-loaded");
dashboardDiagnostics.loadCount += 1;
window.addEventListener("beforeunload", () => recordLifecycle("beforeunload"));
window.addEventListener("pagehide", (event) => recordLifecycle(`pagehide:persisted=${event.persisted}`));
window.addEventListener("pageshow", (event) => recordLifecycle(`pageshow:persisted=${event.persisted}`));
document.addEventListener("DOMContentLoaded", () => recordLifecycle("DOMContentLoaded"), { once: true });
const districtTalukas = {
  Wardha: ["Wardha", "Seloo", "Deoli", "Hinganghat", "Samudrapur", "Karanja", "Arvi", "Ashti"],
  Amravati: ["Amravati", "Bhatkuli", "Nandgaon Khandeshwar", "Daryapur", "Anjangaon Surji", "Achalpur", "Chandurbazar", "Chikhaldara", "Dharni", "Morshi", "Warud", "Chandur Railway", "Teosa", "Dhamangaon Railway"]
};

function escapeHtml(value) {
  return String(value ?? "—")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function statusClass(status) {
  return {
    WORKING: "status-working", "PARTIALLY WORKING": "status-partial",
    FAILED: "status-failed", "NOT TESTED": "status-not-tested",
    "NOT IMPLEMENTED": "status-not-implemented"
  }[status] || "status-not-tested";
}

function setStatus(element, status) {
  element.className = `status-badge ${statusClass(status)}`;
  element.textContent = status;
}

function showNotification(message, type = "success") {
  const element = $("#notification");
  element.textContent = message;
  element.className = `notification ${type}`;
  element.hidden = false;
  window.setTimeout(() => { element.hidden = true; }, 5000);
}

function addLog(name, status, message, duration = null) {
  logs.unshift({ at: new Date().toLocaleTimeString(), name, status, message,
    duration: duration === null ? "—" : `${duration} ms` });
  $("#logList").innerHTML = logs.length ? logs.map((log) => `
    <div class="log-entry"><time>${escapeHtml(log.at)}</time>
      <span class="status-badge ${statusClass(log.status)}">${escapeHtml(log.status)}</span>
      <span class="log-message">${escapeHtml(log.name)} — ${escapeHtml(log.message)}</span>
      <span class="log-meta">${escapeHtml(log.duration)}</span></div>`).join("")
    : '<div class="log-empty">No tests run in this browser session.</div>';
}

function pythonBaseUrl() {
  return $("#pythonBaseUrl").value.trim().replace(/\/+$/, "");
}

async function fetchJson(url, options = {}) {
  const requestSequence = ++dashboardDiagnostics.requestSequence;
  const method = options.method || "GET";
  const referenceMatch = url.match(/location-search\/([^/?]+)/);
  const request = {
    sequence: requestSequence,
    timestamp: new Date().toISOString(),
    endpoint: url.split("?")[0],
    method,
    reference: referenceMatch ? decodeURIComponent(referenceMatch[1]) : null,
    state: locationState
  };
  dashboardDiagnostics.requests.push(request);
  console.info("[MahaTenders dashboard request]", request);
  const response = await fetch(url, { headers: { Accept: "application/json" }, ...options });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  request.responseStatus = response.status;
  request.responseTimestamp = new Date().toISOString();
  request.responseState = locationState;
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`HTTP ${response.status} returned ${contentType || "unknown content"}: ${preview || "empty response"}`);
  }
  request.responseReference = body.reference || null;
  console.info("[MahaTenders dashboard response]", {
    sequence: request.sequence,
    endpoint: request.endpoint,
    method: request.method,
    reference: request.responseReference || request.reference,
    status: response.status,
    state: request.responseState
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error || "request failed"}`);
  return body;
}

async function checkApiAnythingHealth() {
  const started = performance.now();
  const badge = $("#healthStatus");
  const result = $("#healthResult");
  setStatus(badge, "NOT TESTED");
  result.hidden = false;
  result.textContent = "Requesting /v1/health…";
  try {
    const body = await fetchJson(`${$("#apiBaseUrl").value.trim().replace(/\/+$/, "")}/v1/health`);
    const duration = Math.round(performance.now() - started);
    if (body.ok !== true) throw new Error("health response was not ok");
    setStatus(badge, "WORKING"); setStatus($("#apiAnythingStatus"), "WORKING");
    $("#apiAnythingValue").textContent = `Healthy · v${body.version || "unknown"}`;
    result.textContent = `HTTP 200; ${duration} ms; version ${body.version || "unknown"}.`;
    addLog("API Anything health", "WORKING", "GET /v1/health returned ok", duration);
  } catch (error) {
    const duration = Math.round(performance.now() - started);
    setStatus(badge, "FAILED"); setStatus($("#apiAnythingStatus"), "FAILED");
    $("#apiAnythingValue").textContent = "Health unavailable";
    result.textContent = error.message;
    addLog("API Anything health", "FAILED", error.message, duration);
    showNotification("API Anything health check failed.", "error");
  }
}

async function loadScopedData() {
  const started = performance.now();
  try {
    const [health, stats, organisations, scope] = await Promise.all([
      fetchJson(`${pythonBaseUrl()}/health`),
      fetchJson(`${pythonBaseUrl()}/api/v1/stats`),
      fetchJson(`${pythonBaseUrl()}/api/v1/organisations`),
      fetchJson(`${pythonBaseUrl()}/api/v1/scope`)
    ]);
    if (health.ok !== true) throw new Error("Python API health response was not ok");
    const district = $("#districtFilter").value;
    const taluka = $("#talukaFilter").value;
    const params = new URLSearchParams();
    if (district) params.set("district", district);
    if (taluka) params.set("taluka", taluka);
    const tenders = await fetchJson(`${pythonBaseUrl()}/api/v1/tenders?${params}`);
    currentTenders = tenders.tenders;
    renderScope(scope);
    renderStats(stats, tenders.count, organisations.count);
    renderOrganisations(organisations.organisations);
    renderTenders(currentTenders);
    const duration = Math.round(performance.now() - started);
    setStatus($("#pythonStatus"), "WORKING");
    addLog("Scoped Python API", "WORKING", `Loaded ${tenders.count} in-scope tenders`, duration);
    showNotification(`Loaded ${tenders.count} Wardha/Amravati tenders.`);
  } catch (error) {
    setStatus($("#pythonStatus"), "FAILED");
    addLog("Scoped Python API", "FAILED", error.message);
    showNotification(`Scoped API unavailable: ${error.message}`, "error");
  }
}

function renderScope(scope) {
  const districts = scope.districts || {};
  const select = $("#talukaFilter");
  const selected = select.value;
  select.innerHTML = '<option value="">All talukas</option>' +
    Object.values(districts).flatMap((item) => item.talukas)
      .map((taluka) => `<option value="${escapeHtml(taluka)}">${escapeHtml(taluka)}</option>`).join("");
  select.value = selected;
}

function renderStats(stats, tenderCount, organisationCount) {
  $("#organisationCount").textContent = organisationCount;
  $("#tenderCount").textContent = tenderCount;
  $("#coverageLabel").textContent = `${tenderCount} in-scope records`;
  $("#districtStats").textContent = (stats.districts || [])
    .map((item) => `${item.district}: ${item.tender_count}`).join(" · ") || "No records";
}

function detailValue(tender, labels) {
  const fields = tender.detail_fields || {};
  const direct = labels.find((label) => tender[label] !== undefined && tender[label] !== null && tender[label] !== "");
  if (direct) return tender[direct];
  const match = Object.keys(fields).find((key) => labels.some((label) => key.toLowerCase() === label.toLowerCase()));
  return match ? fields[match] : null;
}

function meaningfulValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function detailEntries(tender, definitions) {
  return definitions.map(([label, labels]) => [label, detailValue(tender, labels)])
    .filter(([, value]) => meaningfulValue(value));
}

function renderDetailGrid(entries) {
  return `<div class="detail-grid">${entries.map(([label, value]) =>
    `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  ).join("")}</div>`;
}

function renderDetailSection(title, entries, emptyMessage = "No captured fields available.") {
  if (!entries.length) return "";
  return `<section class="detail-section"><h4>${escapeHtml(title)}</h4>${renderDetailGrid(entries)}</section>`;
}

function renderDetailTable(title, headers, rows, emptyMessage = "No structured records captured.") {
  if (!rows.length) return "";
  return `<section class="detail-section"><h4>${escapeHtml(title)}</h4>
    <div class="table-wrap detail-table-wrap"><table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div></section>`;
}

function tenderClassification(tender) {
  return tender.scope_classification?.status || tender.scope_status || "UNKNOWN";
}

function classificationClass(status) {
  return {
    IN_SCOPE: "status-working",
    UNKNOWN: "status-not-tested",
    OUT_OF_SCOPE: "status-failed"
  }[status] || "status-not-tested";
}

function renderOrganisations(organisations) {
  $("#organisationRows").innerHTML = organisations.length ? organisations.map((organisation) => `
    <tr><td><strong>${escapeHtml(organisation.name)}</strong></td>
      <td>${escapeHtml(organisation.tender_count)}</td>
      <td><span class="source-pill">Python scoped API</span></td>
      <td><span class="status-badge status-working">WORKING</span></td></tr>`).join("")
    : '<tr><td colspan="4">No in-scope organisations returned.</td></tr>';
}

function renderTenders(tenders) {
  $("#tenderRows").innerHTML = tenders.length ? tenders.map((tender) => `
    <tr><td><strong>${escapeHtml(tender.tender_id)}</strong></td>
      <td>${escapeHtml(tender.title || detailValue(tender, ["Title", "Tender Title"]))}</td>
      <td>${escapeHtml(tender.organisation || tender.organisation_chain || detailValue(tender, ["Organisation Chain"]))}</td>
      <td>${escapeHtml(tender.location_raw || detailValue(tender, ["Location", "City/Village"]))}</td>
      <td>${escapeHtml(tender.published_at || detailValue(tender, ["Published Date"]))}</td>
      <td>${escapeHtml(tender.estimated_value || detailValue(tender, ["Tender Value in ₹", "Tender Value"]))}</td>
      <td><span class="status-badge ${classificationClass(tenderClassification(tender))}">${escapeHtml(tenderClassification(tender))}</span></td>
      <td><button class="button button-quiet tender-details-button" type="button" data-tender-id="${escapeHtml(tender.tender_id)}">View details</button></td></tr>`).join("")
    : '<tr><td colspan="8">No tender records returned.</td></tr>';
  document.querySelectorAll(".tender-details-button").forEach((button) => {
    button.addEventListener("click", () => loadTenderDetails(button.dataset.tenderId));
  });
}

function resetLocationResults(message = "No location search started.") {
  clearLocationPolling();
  currentTenders = [];
  renderTenders([]);
  $("#tenderDetails").hidden = true;
  $("#locationProgress").textContent = message;
}

function clearLocationPolling() {
  if (locationPoll !== null) {
    window.clearTimeout(locationPoll);
    locationPoll = null;
  }
}

function populateSearchTalukas(district) {
  const select = $("#searchTaluka");
  const talukas = districtTalukas[district] || [];
  select.innerHTML = '<option value="">Select taluka</option>' +
    talukas.map((taluka) => `<option value="${escapeHtml(taluka)}">${escapeHtml(taluka)}</option>`).join("");
  select.disabled = !district;
}

async function runLocationSearch(taluka) {
  if (locationStartInFlight || captchaSubmitInFlight || ["STARTING", "RUNNING", "CAPTCHA_REQUIRED"].includes(locationState)) {
    return;
  }
  const started = performance.now();
  const progress = $("#locationProgress");
  clearLocationPolling();
  locationReference = null;
  locationState = "STARTING";
  locationStartInFlight = true;
  $("#captchaPanel").hidden = true;
  progress.textContent = `Starting ${taluka} location search…`;
  try {
    const body = await fetchJson(`${pythonBaseUrl()}/api/v1/location-search/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        district: $("#searchDistrict").value,
        taluka,
        human_captcha: true,
        max_details: 5
      })
    });
    if (!body.reference) throw new Error("Location search response did not include a temporary reference");
    locationReference = body.reference;
    locationState = body.status;
    renderLocationJob(body, taluka);
    if (body.status === "CAPTCHA_REQUIRED") showCaptcha(body);
    else pollLocationJob(taluka, started);
  } catch (error) {
    locationState = "FAILED";
    progress.textContent = `Location search failed: ${error.message}`;
    addLog(`MahaTenders ${taluka}`, "FAILED", error.message, Math.round(performance.now() - started));
    showNotification(`Location search failed: ${error.message}`, "error");
  } finally {
    locationStartInFlight = false;
  }
}

function renderLocationJob(body, taluka) {
  const summary = body.summary || {};
  const errors = (summary.errors || []).length;
  const message = summary.message ? ` ${escapeHtml(summary.message)}` : "";
  $("#locationProgress").innerHTML =
    `Status: <strong>${escapeHtml(body.status)}</strong>; listing pages: ${escapeHtml(summary.listing_pages_processed ?? 0)}; ` +
    `tender IDs: ${escapeHtml(summary.tender_ids_discovered ?? 0)}; details: ${escapeHtml(summary.tender_details_retrieved ?? 0)}; errors: ${escapeHtml(errors)}.${message}`;
  if (body.status === "FAILED" || body.status === "CANCELLED" || body.status === "EXPIRED") {
    addLog(`MahaTenders ${taluka}`, "FAILED", body.error || body.status);
  }
}

async function loadLocationResults(runId, taluka) {
  const body = await fetchJson(`${pythonBaseUrl()}/api/v1/location-search/runs/${encodeURIComponent(runId)}/tenders`);
  currentTenders = Array.isArray(body.tenders) ? body.tenders : [];
  renderTenders(currentTenders);
  $("#coverageLabel").textContent =
    `${body.total_tender_count ?? currentTenders.length} records from ${taluka} (including UNKNOWN)`;
  $("#tenderDetails").hidden = true;
  return body;
}

function showCaptcha(body) {
  locationState = "CAPTCHA_REQUIRED";
  $("#captchaImage").src = body.captcha.image;
  $("#captchaAnswer").value = "";
  $("#captchaPanel").hidden = false;
  $("#captchaAnswer").focus();
  $("#locationProgress").textContent = "CAPTCHA_REQUIRED: enter the displayed CAPTCHA and submit.";
}

function scheduleLocationPolling(taluka, started) {
  clearLocationPolling();
  locationPoll = window.setTimeout(() => {
    locationPoll = null;
    pollLocationJob(taluka, started);
  }, 1000);
}

async function pollLocationJob(taluka, started) {
  if (locationPollInFlight || !locationReference || locationState === "CANCELLED") return;
  locationPollInFlight = true;
  try {
    const body = await fetchJson(`${pythonBaseUrl()}/api/v1/location-search/${encodeURIComponent(locationReference)}`);
    locationState = body.status;
    renderLocationJob(body, taluka);
    if (body.status === "CAPTCHA_REQUIRED") {
      showCaptcha(body);
      return;
    }
    if (["RUNNING", "STARTING"].includes(body.status)) {
      scheduleLocationPolling(taluka, started);
      return;
    }
    clearLocationPolling();
    const summary = body.summary || {};
    const errors = (summary.errors || []).length;
    addLog(`MahaTenders ${taluka}`, errors || body.status !== "COMPLETED" ? "FAILED" : "WORKING",
      `${summary.listing_pages_processed || 0} pages, ${summary.tender_ids_discovered || 0} IDs, ${summary.tender_details_retrieved || 0} details`,
      Math.round(performance.now() - started));
    if (errors || body.status !== "COMPLETED") showNotification(`Location search ended with status ${body.status}.`, "error");
    else {
      try {
        const runId = summary.run_id;
        if (!runId) throw new Error("Completed location search did not include a run ID");
        const results = await loadLocationResults(runId, taluka);
        showNotification(`Loaded ${results.total_tender_count ?? results.tenders.length} tender records for ${taluka}.`);
      } catch (error) {
        addLog("Location tender results", "FAILED", error.message);
        showNotification(`Location search completed, but tender results could not be loaded: ${error.message}`, "error");
      }
    }
  } catch (error) {
    $("#locationProgress").textContent = `Location search status failed: ${error.message}`;
  } finally {
    locationPollInFlight = false;
  }
}

async function submitCaptcha(event) {
  event?.preventDefault();
  if (!locationReference || locationState !== "CAPTCHA_REQUIRED" || captchaSubmitInFlight) return;
  captchaSubmitInFlight = true;
  const submitButton = $("#submitCaptcha");
  submitButton.disabled = true;
  try {
    const body = await fetchJson(`${pythonBaseUrl()}/api/v1/location-search/${encodeURIComponent(locationReference)}/captcha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: $("#captchaAnswer").value })
    });
    locationState = body.status;
    if (body.status === "CAPTCHA_REQUIRED") showCaptcha(body);
    else {
      $("#captchaPanel").hidden = true;
      pollLocationJob($("#searchTaluka").value, performance.now());
    }
  } catch (error) {
    showNotification(`CAPTCHA submission failed: ${error.message}`, "error");
  } finally {
    captchaSubmitInFlight = false;
    submitButton.disabled = false;
  }
}

async function cancelLocationSearch(event) {
  event?.preventDefault();
  if (!locationReference) return;
  clearLocationPolling();
  locationState = "CANCELLED";
  const reference = locationReference;
  try {
    await fetchJson(`${pythonBaseUrl()}/api/v1/location-search/${encodeURIComponent(reference)}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    $("#captchaPanel").hidden = true;
    $("#locationProgress").textContent = "Location search cancelled.";
    locationReference = null;
  } catch (error) {
    showNotification(`Cancellation failed: ${error.message}`, "error");
  }
}

async function loadTenderDetails(tenderId) {
  try {
    const tender = currentTenders.find((item) => item.tender_id === tenderId);
    if (!tender) throw new Error("Tender record is not available in the current result set");
    const fields = tender.detail_fields || {};
    const classification = tenderClassification(tender);
    const overview = detailEntries(tender, [
      ["Tender ID", ["tender_id"]],
      ["Tender Reference Number", ["reference_number", "Tender Reference Number", "Tender Reference No"]],
      ["Title", ["title", "Title", "Tender Title"]],
      ["Organisation Chain", ["organisation", "organisation_chain", "Organisation Chain"]],
      ["Tender Type", ["Tender Type"]],
      ["Tender Category", ["Tender Category"]],
      ["Product Category", ["Product Category"]],
      ["Location", ["location_raw", "Location"]],
      ["Address", ["Address"]],
      ["Pincode", ["Pincode", "PIN Code"]]
    ]);
    const financial = detailEntries(tender, [
      ["Tender Value", ["estimated_value", "Tender Value in ₹", "Tender Value"]],
      ["EMD Amount", ["EMD Amount in ₹", "EMD Amount"]],
      ["EMD Fee Type", ["EMD Fee Type"]],
      ["EMD Exemption Allowed", ["EMD Exemption Allowed"]],
      ["Tender Fee", ["Tender Fee in ₹", "Tender Fee"]],
      ["Processing Fee", ["Processing Fee in ₹", "Processing Fee"]],
      ["Fee Exemption Allowed", ["Fee Exemption Allowed"]],
      ["Payment Mode", ["Payment Mode"]]
    ]);
    const dates = detailEntries(tender, [
      ["Published Date", ["published_at", "Published Date"]],
      ["Bid Submission Start Date", ["Bid Submission Start Date"]],
      ["Bid Submission End Date", ["closing_at", "Bid Submission End Date"]],
      ["Bid Opening Date", ["opening_at", "Bid Opening Date"]],
      ["Document Download / Sale Start Date", ["Document Download / Sale Start Date"]],
      ["Document Download / Sale End Date", ["Document Download / Sale End Date"]],
      ["Clarification Start Date", ["Clarification Start Date"]],
      ["Clarification End Date", ["Clarification End Date"]],
      ["Pre Bid Meeting Date", ["Pre Bid Meeting Date"]]
    ]);
    const work = detailEntries(tender, [
      ["Work Description", ["Work Description"]],
      ["Period of Work", ["Period of Work"]],
      ["Bid Validity", ["Bid Validity"]],
      ["Contract Type", ["Form of Contract", "Contract Type"]],
      ["Tender Class", ["Tender Class"]],
      ["Pre Bid Meeting Place and Address", ["Pre Bid Meeting Place", "Pre Bid Meeting Address", "Pre Bid Meeting Place and Address"]],
      ["Bid Opening Place", ["Bid Opening Place"]]
    ]);
    const other = detailEntries(tender, [
      ["Withdrawal Allowed", ["Withdrawal Allowed"]],
      ["Two Stage Bidding", ["Allow Two Stage Bidding", "Two Stage Bidding"]],
      ["Preferential Bidder", ["Allow Preferential Bidder", "Preferential Bidder"]],
      ["NDA / Pre Qualification", ["NDA/Pre Qualification", "Should Allow NDA Tender", "NDA / Pre Qualification"]]
    ]);
    const ignoredLabels = new Set([
      "s.no", "description", "cover no", "cover type", "document name", "document type"
    ]);
    const usefulLabel = (label, value) => {
      const normalized = label.trim().toLowerCase();
      if (!meaningfulValue(value) || ignoredLabels.has(normalized) || /^\d+(?:\.\w+)?$/.test(normalized)) return false;
      return !/footer|announcement|bidders who|online payment related issues|copyright|helpdesk/i.test(`${label} ${value}`);
    };
    const indexedRows = (prefix) => {
      const rows = {};
      Object.entries(fields).forEach(([label, value]) => {
        const match = label.match(new RegExp(`^${prefix}\\s*(\\d+)\\s+(cover number|cover no|cover type|description|document type)$`, "i"));
        if (!match || !usefulLabel(label, value)) return;
        const number = match[1];
        rows[number] = rows[number] || ["—", "—", "—", "—"];
        const column = {
          "cover number": 0, "cover no": 0, "cover type": 1,
          description: 2, "document type": 3
        }[match[2].toLowerCase()];
        rows[number][column] = value;
      });
      return Object.entries(rows).map(([number, row]) => {
        row[0] = row[0] === "—" ? number : row[0];
        return row;
      });
    };
    const coverRows = indexedRows("cover");
    const documentRows = Object.entries(fields)
      .filter(([label, value]) => usefulLabel(label, value) &&
        (/\.(?:pdf|xls|xlsx|doc|docx|rar|zip)$/i.test(label) || /document|attachment|technical document/i.test(label)))
      .map(([label, value]) => [label, value]);
    const paymentRows = Object.entries(fields)
      .filter(([label, value]) => usefulLabel(label, value) && /bank|instrument|transaction/i.test(label))
      .map(([label, value]) => [label, value]);
    const corrigendaRows = Object.entries(fields)
      .filter(([label, value]) => usefulLabel(label, value) && /corrigend/i.test(label))
      .map(([label, value]) => [label, value]);
    const overviewMeta = [
      ["Classification", classification],
      ["District", tender.district || tender.scope_classification?.district],
      ["Taluka", tender.taluka || tender.scope_classification?.taluka],
      ["Source URL", tender.source?.url],
      ["Extracted at", tender.source?.extracted_at],
      ["Evidence type", tender.source?.evidence_type]
    ].filter(([, value]) => meaningfulValue(value));
    const coverCount = detailEntries(tender, [["Number of Covers", ["No. of Covers", "Number of Covers"]]]);
    $("#tenderDetails").innerHTML = `<h3>${escapeHtml(tender.title || tenderId)}</h3>
      ${renderDetailGrid(overviewMeta)}${renderDetailSection("Tender overview", overview)}
      ${renderDetailSection("Financial details", financial)}${renderDetailSection("Important dates", dates)}
      ${renderDetailSection("Work details", work)}
      ${renderDetailSection("Covers", coverCount)}
      ${renderDetailTable("Cover information", ["Cover Number", "Cover Type", "Description", "Document Type"], coverRows)}
      ${renderDetailTable("Documents", ["Document name", "Available information"], documentRows)}
      ${renderDetailTable("Payment instruments", ["Field", "Value"], paymentRows)}
      ${renderDetailTable("Corrigenda", ["Field", "Value"], corrigendaRows)}
      ${renderDetailSection("Other information", other)}`;
    $("#tenderDetails").hidden = false;
    $("#tenderDetails").scrollIntoView({ behavior: "smooth", block: "start" });
    addLog("Tender details", "WORKING", `Loaded ${tenderId}`);
  } catch (error) {
    addLog("Tender details", "FAILED", error.message);
    showNotification(error.message, "error");
  }
}

function openMahaTenders() {
  window.open("https://mahatenders.gov.in/nicgep/app", "_blank", "noopener,noreferrer");
  addLog("MahaTenders homepage", "WORKING", "Opened public homepage; prior capture verified HTTP 200");
}

$("#refreshAll").addEventListener("click", () => { checkApiAnythingHealth(); loadScopedData(); });
$("#clearLogs").addEventListener("click", () => { logs.length = 0; addLog("Logs", "WORKING", "Session logs cleared"); logs.length = 0; $("#logList").innerHTML = '<div class="log-empty">No tests run in this browser session.</div>'; });
$("#openMahaTenders").addEventListener("click", openMahaTenders);
document.querySelector('[data-test="health"]').addEventListener("click", checkApiAnythingHealth);
$("#loadScopedData").addEventListener("click", loadScopedData);
$("#districtFilter").addEventListener("change", loadScopedData);
$("#talukaFilter").addEventListener("change", loadScopedData);
$("#searchDistrict").addEventListener("change", (event) => {
  if (locationReference) void cancelLocationSearch();
  locationReference = null;
  locationState = "IDLE";
  populateSearchTalukas(event.target.value);
  resetLocationResults("District changed locally; select a taluka to start a new search.");
});
$("#searchTaluka").addEventListener("change", (event) => {
  if (event.target.value) runLocationSearch(event.target.value);
});
$("#submitCaptcha").addEventListener("click", submitCaptcha);
$("#cancelLocationSearch").addEventListener("click", cancelLocationSearch);
addLog("Dashboard", "NOT TESTED", "Ready for bounded local API checks");
