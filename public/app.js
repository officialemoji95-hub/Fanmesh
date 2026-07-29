const numberFormatter = new Intl.NumberFormat("en-US");
const toast = document.querySelector(".toast");
let toastTimer;
let fanRecords = [];
let audienceState = { totalFollowers: 0, identifiedFans: 0, directConnections: 0 };
let authState = { configured: false, authenticated: false, mode: "demo" };
let authMode = "signin";
let pendingImport = null;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const importHeaderAliases = Object.freeze({
  name: "name",
  fullname: "name",
  displayname: "name",
  email: "email",
  emailaddress: "email",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  location: "location",
  city: "location",
  sourceid: "sourceId",
  leadid: "sourceId",
  leadgenid: "sourceId",
  consent: "consent",
  marketingconsent: "consent",
  optedincare: "consent",
  optedin: "consent",
  consentat: "consentAt",
  createdtime: "consentAt",
  createdat: "consentAt",
  consentsource: "consentSource",
  consentchannels: "consentChannels",
  consentchannel: "consentChannels",
  campaignid: "campaignId",
  utmsource: "utmSource",
  utmmedium: "utmMedium",
  utmcampaign: "utmCampaign",
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("The CSV contains an unclosed quoted field");
  return rows;
}

function recordsFromCsv(text) {
  const table = parseCsv(text.replace(/^\uFEFF/, ""));
  if (table.length < 2) throw new Error("The CSV needs a header and at least one data row");
  const headers = table[0].map((header) => importHeaderAliases[header.toLowerCase().replace(/[^a-z0-9]+/g, "")] || "");
  if (!headers.includes("email") && !headers.includes("phone")) throw new Error("Add an email or phone column");
  return table.slice(1).map((values) => Object.fromEntries(headers.flatMap((header, index) => header ? [[header, values[index]?.trim() || ""]] : [])));
}

function renderImportPreview(preview, { committed = false } = {}) {
  const target = document.querySelector("#import-preview");
  if (committed) {
    target.className = "import-preview success";
    target.innerHTML = `<strong>${numberFormatter.format(preview.accepted)} records committed</strong><span>${numberFormatter.format(preview.created)} new · ${numberFormatter.format(preview.updated)} updated · ${numberFormatter.format(preview.consentEventsAdded)} consent events added</span>`;
    return;
  }
  const errors = preview.invalid.slice(0, 5).map((item) => `<li>Row ${numberFormatter.format(item.row)}: ${escapeHtml(item.reason)}</li>`).join("");
  target.className = `import-preview ${preview.summary.valid ? "ready" : "error"}`;
  target.innerHTML = `
    <div class="import-summary"><strong>${numberFormatter.format(preview.summary.valid)} accepted</strong><span>${numberFormatter.format(preview.summary.invalid)} rejected · ${numberFormatter.format(preview.summary.duplicates)} duplicates</span></div>
    ${errors ? `<ul>${errors}</ul>${preview.invalid.length > 5 ? `<small>And ${numberFormatter.format(preview.invalid.length - 5)} more rejected rows.</small>` : ""}` : "<span>Consent and identity checks passed. Nothing has been saved yet.</span>"}`;
}

function channelMarkup(channels) {
  return `<div class="channels">${channels.map((channel) =>
    `<span class="channel ${escapeHtml(channel)}" title="${escapeHtml(channel)}">${escapeHtml(channel.slice(0, 2))}</span>`,
  ).join("")}</div>`;
}

function renderFans(records) {
  const table = document.querySelector("#fan-table");
  if (!records.length) {
    table.innerHTML = `<tr><td colspan="6" class="loading">${authState.configured ? "No fan records yet. Your first consented import will appear here." : "No fans match that search."}</td></tr>`;
    return;
  }

  table.innerHTML = records.map((fan) => {
    const score = fan.fanScore.score;
    const tier = fan.fanScore.tier;
    const initials = fan.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("");
    return `<tr>
      <td><div class="fan-cell"><span class="fan-avatar">${escapeHtml(initials)}</span><span><strong>${escapeHtml(fan.displayName)}</strong><small>${escapeHtml(fan.location)}</small></span></div></td>
      <td>${channelMarkup(fan.channels)}</td>
      <td><span class="score">${score}<i><em style="width:${score}%"></em></i></span></td>
      <td><span class="tier ${tier}">${tier} fan</span></td>
      <td>${escapeHtml(fan.lastSeen)}</td>
      <td><button class="row-action" data-fan="${escapeHtml(fan.id)}" aria-label="View fan details">•••</button></td>
    </tr>`;
  }).join("");
}

function renderRecommendations(recommendations) {
  document.querySelector("#recommendations").innerHTML = recommendations.map((item, index) => `
    <article class="recommendation">
      <div class="rec-top"><span class="rec-index">0${index + 1}</span><span class="rec-priority">${escapeHtml(item.priority)} priority</span></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.detail)}</p>
      <footer><span>${escapeHtml(item.expectedImpact)}</span><button data-toast="This action will become interactive in the next milestone.">Explore →</button></footer>
    </article>`).join("");
}

function capabilityLabel(capability) {
  return capability.replaceAll("_", " ");
}

function safeTikTokShareUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    if (url.hostname !== "tiktok.com" && !url.hostname.endsWith(".tiktok.com")) return "";
    return url.href;
  } catch {
    return "";
  }
}

function shortDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
    : "Date unavailable";
}

function renderTikTokPerformance(catalog) {
  const target = document.querySelector("#tiktok-performance");
  const source = catalog.social.find((item) => item.platform === "tiktok");
  if (source?.status !== "connected" || !source.account) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const account = source.account;
  const videos = Array.isArray(account.recentVideos) ? account.recentVideos.slice(0, 5) : [];
  const rows = videos.map((video) => {
    const shareUrl = safeTikTokShareUrl(video.shareUrl);
    const title = escapeHtml(video.title || video.description || "Untitled TikTok post");
    return `<article class="tiktok-video-row">
      <div class="tiktok-video-title">${shareUrl ? `<a href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer">${title} ↗</a>` : `<strong>${title}</strong>`}<small>${escapeHtml(shortDate(video.createdAt))}</small></div>
      <span><b>${numberFormatter.format(video.views || 0)}</b><small>views</small></span>
      <span><b>${numberFormatter.format(video.likes || 0)}</b><small>likes</small></span>
      <span><b>${numberFormatter.format(video.comments || 0)}</b><small>comments</small></span>
      <span><b>${numberFormatter.format(video.shares || 0)}</b><small>shares</small></span>
    </article>`;
  }).join("");
  target.hidden = false;
  target.innerHTML = `
    <div class="tiktok-performance-heading">
      <div><p class="eyebrow">TikTok performance</p><h3>What your latest public posts are actually doing</h3></div>
      <span class="status good">Latest ${numberFormatter.format(account.recentVideoCount || 0)} of 20</span>
    </div>
    <div class="tiktok-performance-metrics">
      <span><small>Posts analyzed</small><strong>${numberFormatter.format(account.recentVideoCount || 0)}</strong></span>
      <span><small>Average views</small><strong>${numberFormatter.format(account.averageViews || 0)}</strong></span>
      <span><small>Median views</small><strong>${numberFormatter.format(account.medianViews || 0)}</strong></span>
      <span><small>Engagement / view</small><strong>${percent(account.engagementRate)}</strong></span>
    </div>
    <div class="tiktok-video-list">${rows || `<p class="tiktok-empty">TikTok returned no public videos for this account yet. Sync again after publishing a public post.</p>`}</div>
    <p class="tiktok-method">Transparent window: up to the 20 most recent public posts returned by TikTok. Engagement is (likes + comments + shares) ÷ views.</p>`;
}

function renderConnections(catalog) {
  const sourceGrid = document.querySelector("#source-grid");
  const sources = catalog.social;
  sourceGrid.innerHTML = sources.map((source) => `
    <article class="source-card ${source.status === "connected" ? "is-connected" : ""}">
      <div class="source-icon ${escapeHtml(source.platform)}">${escapeHtml(source.platform.slice(0, 2))}</div>
      <div class="source-info"><strong>${escapeHtml(source.label)}</strong><span>${escapeHtml(source.account?.name || source.status.replaceAll("_", " "))}</span></div>
      <span class="connection-dot ${source.status === "connected" ? "live" : ""}" title="${escapeHtml(source.status.replaceAll("_", " "))}"></span>
      <p>${escapeHtml(source.caveat || "Import only records you are authorized to use.")}</p>
      <div class="source-tags">${source.capabilities.slice(0, 2).map((capability) => `<span>${escapeHtml(capabilityLabel(capability))}</span>`).join("")}</div>
      ${source.status === "connected" ? `
        <div class="connection-summary"><strong>${numberFormatter.format(source.account?.followers || 0)} followers</strong><span>${source.platform === "tiktok" ? `${numberFormatter.format(source.account?.recentVideoCount || 0)} posts · ${numberFormatter.format(source.account?.averageViews || 0)} avg views` : `${numberFormatter.format(source.account?.adAccounts || 0)} ad accounts`}</span></div>
        <div class="connection-actions"><button class="connection-button" type="button" data-connection-sync="${escapeHtml(source.platform)}">Sync now</button><button class="connection-link" type="button" data-connection-disconnect="${escapeHtml(source.platform)}">Disconnect</button></div>
      ` : source.configured && source.connectUrl ? `
        <a class="connection-button" href="${escapeHtml(source.connectUrl)}">Connect ${escapeHtml(source.label)} ↗</a>
      ` : `
        <span class="connection-needed">Developer app needed</span>
      `}
    </article>
  `).join("");
  renderTikTokPerformance(catalog);
}

async function runConnectionAction(action, platform, button) {
  const disconnecting = action === "disconnect";
  if (disconnecting && !window.confirm(`Disconnect ${platform}? FanMesh will erase its stored authorization tokens.`)) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = disconnecting ? "Disconnecting…" : "Syncing…";
  try {
    const response = await fetch(`/api/v1/oauth/${encodeURIComponent(platform)}/${action}`, {
      method: disconnecting ? "DELETE" : "POST",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `${platform} ${action} failed`);
    await loadDashboard();
    showToast(disconnecting ? `${platform} disconnected.` : `${platform} data synced.`);
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.textContent = original;
  }
}

function handleOAuthReturn() {
  const parameters = new URLSearchParams(window.location.search);
  const result = parameters.get("oauth");
  if (!result) return;
  const provider = parameters.get("provider") || "Platform";
  if (result === "connected") {
    showToast(`${provider} connected${parameters.get("account") ? ` as ${parameters.get("account")}` : ""}.`);
  } else {
    showToast(parameters.get("message") || `${provider} connection failed.`);
  }
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
}

function renderSocialPlan(plan) {
  const result = document.querySelector("#social-plan-result");
  result.className = "plan-preview plan-result";
  result.innerHTML = `
    <div class="plan-result-heading"><div><p class="eyebrow">Draft ${escapeHtml(plan.id)}</p><h3>${escapeHtml(plan.contentId)} distribution</h3></div><span class="status good">${escapeHtml(plan.status)}</span></div>
    <p class="plan-audience"><strong>${numberFormatter.format(plan.audience.eligibleDirect)}</strong> eligible direct identities · ${escapeHtml(String(plan.audience.holdoutPercent))}% holdout</p>
    <div class="social-steps">${plan.steps.map((step) => `
      <div class="social-step"><b>0${escapeHtml(String(step.order))}</b><span><strong>${escapeHtml(step.channel)}</strong><small>${escapeHtml(step.audience)}</small></span><p>${escapeHtml(step.action)}</p></div>
    `).join("")}</div>
    <div class="guardrail"><strong>Guardrails:</strong> ${escapeHtml(plan.guardrails[0])}</div>`;
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function percent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function updateDashboardChrome(snapshot, workspace, meta) {
  audienceState = snapshot;
  const identifiedRate = snapshot.totalFollowers ? (snapshot.identifiedFans / snapshot.totalFollowers) * 100 : 0;
  const directRate = snapshot.identifiedFans ? (snapshot.directConnections / snapshot.identifiedFans) * 100 : 0;
  const display = {
    followers: numberFormatter.format(snapshot.totalFollowers),
    identified: numberFormatter.format(snapshot.identifiedFans),
    direct: numberFormatter.format(snapshot.directConnections),
  };

  document.querySelector("#total-followers").textContent = display.followers;
  document.querySelector("#identified-fans").textContent = display.identified;
  document.querySelector("#direct-connections").textContent = display.direct;
  document.querySelector("#view-rate").textContent = percent(snapshot.viewRate);
  document.querySelector("#connected-platforms").textContent = `${numberFormatter.format(snapshot.connectedPlatforms)} platforms`;
  document.querySelector("#identity-rate").textContent = percent(identifiedRate);
  document.querySelector("#direct-rate").textContent = percent(directRate);
  document.querySelector("#average-views").textContent = numberFormatter.format(snapshot.averageViews);
  document.querySelector("#reach-followers").textContent = display.followers;
  document.querySelector("#reach-identified").textContent = display.identified;
  document.querySelector("#reach-direct").textContent = display.direct;
  document.querySelector("#orbit-fans").textContent = formatCompact(snapshot.identifiedFans);
  document.querySelector("#audience-count").textContent = formatCompact(snapshot.identifiedFans);
  document.querySelector("#capture-count").textContent = `${display.identified} identities`;
  document.querySelector("#capture-note").textContent = meta.demo ? "sample records in demo mode" : "in your private workspace";
  document.querySelector("#capture-state").textContent = meta.demo ? "Demo audience" : "Audience database is live";
  document.querySelector("#audience-mode").textContent = meta.demo ? "Showing clearly labeled demo records" : `Showing ${fanRecords.length} workspace records`;

  const identifiedWidth = snapshot.totalFollowers ? Math.max(0, Math.min(100, identifiedRate)) : 0;
  const directWidth = snapshot.totalFollowers ? Math.max(0, Math.min(100, (snapshot.directConnections / snapshot.totalFollowers) * 100)) : 0;
  document.querySelector(".bar.identified").style.width = `${identifiedWidth}%`;
  document.querySelector(".bar.reachable").style.width = `${directWidth}%`;

  const modePill = document.querySelector("#data-mode-pill");
  modePill.classList.toggle("live", !meta.demo);
  modePill.innerHTML = `<i></i> ${meta.demo ? "Demo data" : "Live workspace"}`;
  document.querySelector("#setup-banner").hidden = !meta.demo;

  const name = authState.user?.displayName || (meta.demo ? "Demo Creator" : "Creator");
  document.querySelector("#profile-name").textContent = name;
  document.querySelector("#profile-workspace").textContent = workspace?.name || "Creator workspace";
  document.querySelector("#profile-avatar").textContent = name.slice(0, 1).toUpperCase();
  document.querySelector("#signout-button").hidden = !authState.authenticated;
}

async function loadDashboard() {
  try {
    const response = await fetch("/api/v1/dashboard?limit=20");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Dashboard API unavailable");
    const { insights, fans, connections, workspace } = body.data;
    const meta = body.meta;
    const { snapshot } = insights;
    fanRecords = fans;
    updateDashboardChrome(snapshot, workspace, meta);
    renderRecommendations(insights.recommendations);
    renderConnections(connections);
    document.querySelector("#cross-platform-count").textContent = numberFormatter.format(
      fanRecords.filter((fan) => fan.channels.length > 1).length,
    );
    renderFans(fanRecords);
  } catch (error) {
    document.querySelector("#recommendations").innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
    document.querySelector("#fan-table").innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(error.message)}</td></tr>`;
    document.querySelector("#capture-count").textContent = "Unavailable";
    document.querySelector("#capture-note").textContent = error.message;
    document.querySelector("#audience-mode").textContent = "Workspace data could not be loaded";
  }
}

function showAuthGate(show) {
  document.querySelector("#auth-gate").hidden = !show;
  document.body.classList.toggle("auth-open", show);
}

function setAuthMode(mode) {
  authMode = mode;
  const signUp = mode === "signup";
  const form = document.querySelector("#auth-form");
  form.dataset.mode = mode;
  document.querySelector("#display-name-field").hidden = !signUp;
  form.elements.displayName.required = signUp;
  form.elements.password.autocomplete = signUp ? "new-password" : "current-password";
  document.querySelector("#auth-title").textContent = signUp ? "Create your creator workspace." : "Sign in to your audience.";
  document.querySelector("#auth-copy").textContent = signUp
    ? "Your private workspace is created automatically after registration."
    : "Your workspace and fan data stay private to your account.";
  form.querySelector("button[type=submit]").textContent = signUp ? "Create account ↗" : "Sign in ↗";
  document.querySelector("#auth-toggle").textContent = signUp
    ? "Already have an account? Sign in"
    : "New to FanMesh? Create an account";
  document.querySelector("#auth-message").textContent = "";
}

async function bootstrapAccount() {
  try {
    const response = await fetch("/api/v1/auth/session");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not check your account");
    authState = body.data;
    if (authState.configured && !authState.authenticated) {
      showAuthGate(true);
      return;
    }
    showAuthGate(false);
    await loadDashboard();
    handleOAuthReturn();
  } catch (error) {
    showAuthGate(true);
    document.querySelector("#auth-message").textContent = error.message;
  }
}

document.addEventListener("click", async (event) => {
  const toastTrigger = event.target.closest("[data-toast]");
  if (toastTrigger) showToast(toastTrigger.dataset.toast);

  const scrollTrigger = event.target.closest("[data-scroll]");
  if (scrollTrigger) document.getElementById(scrollTrigger.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });

  if (event.target.closest(".notice button")) event.target.closest(".notice").remove();

  const rowAction = event.target.closest("[data-fan]");
  if (rowAction) {
    const fan = fanRecords.find((item) => item.id === rowAction.dataset.fan);
    if (fan) showToast(`${fan.displayName}: score ${fan.fanScore.score}, led by ${fan.fanScore.strongestSignals[0]?.signal || "recent activity"}.`);
  }

  const syncButton = event.target.closest("[data-connection-sync]");
  if (syncButton) await runConnectionAction("sync", syncButton.dataset.connectionSync, syncButton);

  const disconnectButton = event.target.closest("[data-connection-disconnect]");
  if (disconnectButton) await runConnectionAction("disconnect", disconnectButton.dataset.connectionDisconnect, disconnectButton);

  if (event.target.closest(".mobile-menu")) document.querySelector(".sidebar").classList.toggle("open");
  if (event.target.closest(".nav a")) document.querySelector(".sidebar").classList.remove("open");
});

document.querySelector("#fan-search").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  renderFans(fanRecords.filter((fan) =>
    fan.displayName.toLowerCase().includes(query) || fan.location.toLowerCase().includes(query),
  ));
});

document.querySelector("#campaign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type=submit]");
  const input = Object.fromEntries(new FormData(event.currentTarget));
  submitButton.disabled = true;
  submitButton.textContent = "Building sequence…";

  try {
    const response = await fetch("/api/v1/campaigns/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("Could not build the campaign sequence");
    const { data } = await response.json();
    document.querySelector("#campaign-result").className = "sequence-result";
    document.querySelector("#campaign-result").innerHTML = `
      <h3>${escapeHtml(data.contentType)} activation</h3>
      <p class="sequence-meta">Start with: <strong>${escapeHtml(data.primarySegment)}</strong></p>
      <div class="sequence">${data.sequence.map((step) => `
        <div class="sequence-step"><b>${escapeHtml(step.offset)}</b><span>${escapeHtml(step.channel)}</span><p>${escapeHtml(step.action)}</p></div>
      `).join("")}</div>
      <p class="guardrail"><strong>Guardrail:</strong> ${escapeHtml(data.guardrail)}</p>`;
  } catch (error) {
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Generate activation plan ↗";
  }
});

document.querySelector("#social-experiment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type=submit]");
  const formData = new FormData(event.currentTarget);
  const input = {
    contentId: formData.get("contentId"),
    objective: formData.get("objective"),
    platforms: formData.getAll("platforms"),
    channels: formData.getAll("channels"),
    candidateCounts: {
      followers: audienceState.totalFollowers,
      adLeads: 0,
      optedInFans: audienceState.directConnections,
    },
  };
  submitButton.disabled = true;
  submitButton.textContent = "Building plan…";
  try {
    const response = await fetch("/api/v1/experiments/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("Could not build the social plan");
    const { data } = await response.json();
    renderSocialPlan(data);
  } catch (error) {
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Build reach plan ↗";
  }
});

document.querySelector("#audience-import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const file = form.elements.file.files?.[0];
  const authorization = document.querySelector("#import-authorized");
  const commitButton = document.querySelector("#commit-import");
  button.disabled = true;
  button.textContent = "Checking file…";
  authorization.checked = false;
  authorization.disabled = true;
  commitButton.disabled = true;
  pendingImport = null;
  try {
    if (!file) throw new Error("Choose a CSV file first");
    if (file.size > 1.8 * 1024 * 1024) throw new Error("CSV files must be smaller than 1.8 MB");
    const source = form.elements.source.value;
    const rows = recordsFromCsv(await file.text()).map((row) => ({ ...row, source }));
    const response = await fetch("/api/v1/imports/leads/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, rows }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not preview this import");
    pendingImport = { source, rows, preview: body.data };
    renderImportPreview(body.data);
    authorization.disabled = body.data.summary.valid === 0;
  } catch (error) {
    const target = document.querySelector("#import-preview");
    target.className = "import-preview error";
    target.innerHTML = `<strong>Preview failed</strong><span>${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = false;
    button.textContent = "Preview import";
  }
});

document.querySelector("#import-authorized").addEventListener("change", (event) => {
  document.querySelector("#commit-import").disabled = !event.currentTarget.checked || !pendingImport?.preview?.summary.valid;
});

document.querySelector("#commit-import").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!pendingImport || !document.querySelector("#import-authorized").checked) return;
  button.disabled = true;
  button.textContent = "Committing records…";
  try {
    const response = await fetch("/api/v1/imports/leads/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: pendingImport.source, rows: pendingImport.rows, confirmedAuthorized: true }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not commit this import");
    renderImportPreview(body.data, { committed: true });
    pendingImport = null;
    document.querySelector("#import-authorized").checked = false;
    document.querySelector("#import-authorized").disabled = true;
    await loadDashboard();
    showToast("Authorized audience records are now in your private workspace.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  } finally {
    button.textContent = "Commit accepted records ↗";
  }
});

document.querySelector("#auth-toggle").addEventListener("click", () => {
  setAuthMode(authMode === "signin" ? "signup" : "signin");
});

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const message = document.querySelector("#auth-message");
  const input = Object.fromEntries(new FormData(form));
  button.disabled = true;
  button.textContent = authMode === "signup" ? "Creating workspace…" : "Signing in…";
  message.className = "auth-message";
  message.textContent = "";
  try {
    const response = await fetch(`/api/v1/auth/${authMode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Account request failed");
    if (body.data.verificationRequired) {
      setAuthMode("signin");
      form.elements.password.value = "";
      message.classList.add("success");
      message.textContent = "Check your email to confirm the account, then sign in.";
      return;
    }
    authState = body.data;
    form.reset();
    showAuthGate(false);
    await loadDashboard();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = authMode === "signup" ? "Create account ↗" : "Sign in ↗";
  }
});

document.querySelector("#signout-button").addEventListener("click", async () => {
  await fetch("/api/v1/auth/signout", { method: "POST" });
  authState = { configured: true, authenticated: false, mode: "supabase" };
  setAuthMode("signin");
  showAuthGate(true);
});

bootstrapAccount();
