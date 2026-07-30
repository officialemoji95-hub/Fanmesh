const numberFormatter = new Intl.NumberFormat("en-US");
const toast = document.querySelector(".toast");
let toastTimer;
let fanRecords = [];
let audienceState = { totalFollowers: 0, identifiedFans: 0, directConnections: 0 };
let authState = { configured: false, authenticated: false, mode: "demo" };
let authMode = "signin";
let pendingImport = null;
let pendingMetaLeadImport = null;
let pendingIdentityImport = null;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

async function copyToClipboard(value) {
  const text = String(value || "");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
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

const identityHeaderAliases = Object.freeze({
  username: "username",
  user: "username",
  handle: "username",
  screenname: "username",
  name: "name",
  fullname: "name",
  displayname: "name",
  profileurl: "profileUrl",
  profilelink: "profileUrl",
  url: "profileUrl",
  href: "profileUrl",
  id: "externalId",
  userid: "externalId",
  externalid: "externalId",
  timestamp: "timestamp",
  date: "timestamp",
  followedat: "timestamp",
  createdat: "timestamp",
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

function normalizedObjectValue(record, aliases) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "";
  const normalized = Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]+/g, ""), value]));
  for (const alias of aliases) {
    const value = normalized[alias];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

function collectOfficialIdentityRows(value, relationship, rows = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOfficialIdentityRows(item, relationship, rows));
    return rows;
  }
  if (!value || typeof value !== "object") return rows;

  const stringList = value.string_list_data || value.stringListData;
  if (Array.isArray(stringList)) {
    stringList.forEach((item) => {
      if (!item || typeof item !== "object") return;
      rows.push({
        name: value.title || item.value || "",
        username: item.value || "",
        profileUrl: item.href || "",
        timestamp: item.timestamp || "",
        relationship,
      });
    });
    return rows;
  }

  const username = normalizedObjectValue(value, ["username", "user_name", "handle", "screenname", "value"]);
  const profileUrl = normalizedObjectValue(value, ["profileurl", "profilelink", "href", "url"]);
  const externalId = normalizedObjectValue(value, ["userid", "user_id", "externalid", "id"]);
  if (username || profileUrl || externalId) {
    rows.push({
      username,
      profileUrl,
      externalId,
      name: normalizedObjectValue(value, ["displayname", "fullname", "name", "title"]) || username,
      timestamp: normalizedObjectValue(value, ["timestamp", "date", "followedat", "createdat", "time"]),
      relationship,
    });
    return rows;
  }

  Object.values(value).forEach((item) => collectOfficialIdentityRows(item, relationship, rows));
  return rows;
}

function identityRecordsFromCsv(text, relationship) {
  const table = parseCsv(text.replace(/^\uFEFF/, ""));
  if (table.length < 2) throw new Error("The CSV needs a header and at least one identity row");
  const headers = table[0].map((header) => identityHeaderAliases[header.toLowerCase().replace(/[^a-z0-9]+/g, "")] || "");
  if (!["username", "profileUrl", "externalId"].some((field) => headers.includes(field))) {
    throw new Error("Identity CSV needs a username, profile URL, or platform ID column");
  }
  return table.slice(1).map((values) => ({
    ...Object.fromEntries(headers.flatMap((header, index) => header ? [[header, values[index]?.trim() || ""]] : [])),
    relationship,
  }));
}

async function identityRecordsFromFile(file, relationship) {
  const contents = (await file.text()).replace(/^\uFEFF/, "");
  if (file.name.toLowerCase().endsWith(".json") || file.type === "application/json") {
    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error(`${file.name} is not valid JSON`);
    }
    const rows = collectOfficialIdentityRows(parsed, relationship);
    if (!rows.length) throw new Error(`${file.name} contains no recognizable platform identities`);
    return rows;
  }
  return identityRecordsFromCsv(contents, relationship);
}

function dedupeIdentityRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.externalId, row.username, row.profileUrl].map((value) => String(value || "").trim().toLowerCase()).find(Boolean);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chunks(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) batches.push(values.slice(index, index + size));
  return batches;
}

function renderIdentityImport(summary, { committed = false, progress = "" } = {}) {
  const target = document.querySelector("#identity-import-preview");
  if (committed) {
    target.className = "import-preview success";
    target.innerHTML = `<strong>${numberFormatter.format(summary.accepted)} platform identities committed</strong><span>${numberFormatter.format(summary.created)} new · ${numberFormatter.format(summary.updated)} refreshed · 0 direct-contact permissions assumed</span>`;
    return;
  }
  target.className = `import-preview ${summary.valid ? "ready" : "error"}`;
  const errors = (summary.invalidRows || []).slice(0, 5).map((item) => `<li>Row ${numberFormatter.format(item.row)}: ${escapeHtml(item.reason)}</li>`).join("");
  target.innerHTML = `
    <div class="import-summary"><strong>${numberFormatter.format(summary.valid)} identities ready</strong><span>${numberFormatter.format(summary.invalid)} rejected · ${numberFormatter.format(summary.duplicates)} duplicate rows removed</span></div>
    <span>${escapeHtml(progress || "These records are platform-only signals; no email, SMS, or automated-DM consent is created.")}</span>
    ${errors ? `<ul>${errors}</ul>` : ""}`;
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

function safeInstagramUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    if (url.hostname !== "instagram.com" && !url.hostname.endsWith(".instagram.com")) return "";
    return url.href;
  } catch {
    return "";
  }
}

function formatMoney(value, currency) {
  if (!currency || currency === "mixed" || value === null || value === undefined) return currency === "mixed" ? "Mixed currencies" : "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
  } catch {
    return `${currency} ${Number(value || 0).toFixed(2)}`;
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

function renderMetaPerformance(catalog) {
  const target = document.querySelector("#meta-performance");
  const source = catalog.social.find((item) => item.platform === "meta");
  if (source?.status !== "connected" || !source.account) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const account = source.account;
  const media = (Array.isArray(account.instagramAccounts) ? account.instagramAccounts : [])
    .flatMap((instagram) => (instagram.recentMedia || []).map((post) => ({ ...post, username: instagram.username || instagram.name })))
    .sort((first, second) => Date.parse(second.createdAt || "") - Date.parse(first.createdAt || ""))
    .slice(0, 5);
  const rows = media.map((post) => {
    const permalink = safeInstagramUrl(post.permalink);
    const label = escapeHtml(post.caption || "Untitled Instagram post");
    return `<article class="meta-media-row">
      <div class="meta-media-title">${permalink ? `<a href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : `<strong>${label}</strong>`}<small>@${escapeHtml(post.username || "instagram")} · ${escapeHtml(shortDate(post.createdAt))}</small></div>
      <span><b>${numberFormatter.format(post.views || 0)}</b><small>views</small></span>
      <span><b>${numberFormatter.format(post.reach || 0)}</b><small>reach</small></span>
      <span><b>${numberFormatter.format(post.totalInteractions || post.interactions || 0)}</b><small>interactions</small></span>
      <span><b>${percent(post.engagementRate)}</b><small>engagement / reach</small></span>
    </article>`;
  }).join("");
  const issues = (Array.isArray(account.syncIssues) ? account.syncIssues : []).map((issue) =>
    `<li><strong>${escapeHtml(issue.area.replaceAll("_", " "))}:</strong> ${escapeHtml(issue.message)}</li>`,
  ).join("");
  const ads = account.adSummary30d || {};
  target.hidden = false;
  target.innerHTML = `
    <div class="platform-performance-heading">
      <div><p class="eyebrow">Meta signal inventory</p><h3>Organic attention, paid delivery, and lead capture—kept separate</h3></div>
      <span class="status ${issues ? "warning" : "good"}">${issues ? `${numberFormatter.format(account.syncIssues.length)} access item${account.syncIssues.length === 1 ? "" : "s"}` : "Authorized assets synced"}</span>
    </div>
    <div class="platform-performance-metrics">
      <span><small>Posts measured</small><strong>${numberFormatter.format(account.recentMediaCount || 0)}</strong></span>
      <span><small>Average reach</small><strong>${numberFormatter.format(account.averageMetaReach || 0)}</strong></span>
      <span><small>Median reach</small><strong>${numberFormatter.format(account.medianMetaReach || 0)}</strong></span>
      <span><small>Engagement / reach</small><strong>${percent(account.metaEngagementRate)}</strong></span>
    </div>
    <div class="meta-ad-strip">
      <span><small>Ad spend · 30d</small><strong>${escapeHtml(formatMoney(ads.spend, ads.currency))}</strong></span>
      <span><small>Impressions · 30d</small><strong>${numberFormatter.format(ads.impressions || 0)}</strong></span>
      <span><small>Reach · 30d</small><strong>${numberFormatter.format(ads.reach || 0)}</strong></span>
      <span><small>Clicks · 30d</small><strong>${numberFormatter.format(ads.clicks || 0)}</strong></span>
      <span><small>Reported leads · 30d</small><strong>${numberFormatter.format(ads.leads || 0)}</strong></span>
    </div>
    <div class="meta-media-list">${rows || `<p class="platform-empty">No authorized Instagram professional media was returned yet.</p>`}</div>
    ${issues ? `<div class="meta-sync-issues"><strong>Finish Meta access</strong><ul>${issues}</ul>${source.connectUrl ? `<a class="text-link" href="${escapeHtml(source.connectUrl)}">Review Meta access ↗</a>` : ""}</div>` : ""}
    <p class="platform-method">Post rows use authorized Instagram media insights and keep organic attention separate from account-level paid results. Meta can change metric availability by media type; missing values remain zero and sync issues stay visible.</p>`;
}

function renderMetaLeadImport(catalog) {
  const target = document.querySelector("#meta-lead-import");
  const form = document.querySelector("#meta-lead-import-form");
  const list = document.querySelector("#meta-lead-form-list");
  const source = catalog.social.find((item) => item.platform === "meta");
  if (source?.status !== "connected" || !source.account) {
    target.hidden = true;
    pendingMetaLeadImport = null;
    return;
  }
  const forms = Array.isArray(source.account.leadForms) ? source.account.leadForms : [];
  target.hidden = false;
  pendingMetaLeadImport = null;
  document.querySelector("#commit-meta-leads").disabled = true;
  document.querySelector("#meta-lead-authorized").checked = false;
  if (!forms.length) {
    list.innerHTML = "<legend>Authorized forms</legend><p class=\"platform-empty\">Meta returned no accessible Instant Forms. Create a lead form or grant Page lead access, then sync Meta again.</p>";
    form.querySelector("button[type=submit]").disabled = true;
    document.querySelector("#meta-lead-authorized").disabled = true;
    return;
  }
  document.querySelector("#meta-lead-authorized").disabled = false;
  form.querySelector("button[type=submit]").disabled = false;
  list.innerHTML = `<legend>Authorized forms</legend>${forms.slice(0, 10).map((leadForm) => `
    <label class="meta-form-option"><input type="checkbox" name="formIds" value="${escapeHtml(leadForm.id)}"><span><strong>${escapeHtml(leadForm.name)}</strong><small>${numberFormatter.format(leadForm.leadCount || 0)} known submissions · ${escapeHtml(leadForm.status || "status unavailable")}</small></span></label>
  `).join("")}`;
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
        <div class="connection-summary"><strong>${numberFormatter.format(source.account?.followers || 0)} followers</strong><span>${source.platform === "tiktok" ? `${numberFormatter.format(source.account?.recentVideoCount || 0)} posts · ${numberFormatter.format(source.account?.averageViews || 0)} avg views` : source.platform === "meta" ? `${numberFormatter.format(source.account?.pageCount || 0)} Pages · ${numberFormatter.format(source.account?.instagramAccountCount || 0)} Instagram` : `${numberFormatter.format(source.account?.adAccounts || 0)} ad accounts`}</span></div>
        <div class="connection-actions"><button class="connection-button" type="button" data-connection-sync="${escapeHtml(source.platform)}">Sync now</button><button class="connection-link" type="button" data-connection-disconnect="${escapeHtml(source.platform)}">Disconnect</button></div>
      ` : source.configured && source.connectUrl ? `
        <a class="connection-button" href="${escapeHtml(source.connectUrl)}">Connect ${escapeHtml(source.label)} ↗</a>
      ` : `
        <span class="connection-needed">Developer app needed</span>
      `}
    </article>
  `).join("");
  renderMetaPerformance(catalog);
  renderMetaLeadImport(catalog);
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

  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    await copyToClipboard(copyButton.dataset.copy);
    showToast(`${copyButton.dataset.copyLabel || "Link"} copied.`);
  }

  if (event.target.closest(".mobile-menu")) document.querySelector(".sidebar").classList.toggle("open");
  if (event.target.closest(".nav a")) document.querySelector(".sidebar").classList.remove("open");
});

document.querySelector("#fan-search").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  renderFans(fanRecords.filter((fan) =>
    fan.displayName.toLowerCase().includes(query) || fan.location.toLowerCase().includes(query),
  ));
});

function renderFanActivation(plan) {
  const result = document.querySelector("#campaign-result");
  const readiness = plan.readiness === "audience_ready" ? "Audience ready" : "Capture needed";
  const links = Object.entries(plan.links || {});
  const delivery = Object.entries(plan.delivery || {});
  result.className = "activation-result";
  result.innerHTML = `
    <div class="activation-heading">
      <div><p class="eyebrow">${escapeHtml(plan.id)}</p><h3>${escapeHtml(plan.title)}</h3></div>
      <span class="status ${plan.readiness === "audience_ready" ? "good" : "warning"}">${escapeHtml(readiness)}</span>
    </div>
    <div class="reach-summary">
      <span><small>Known fans</small><strong>${numberFormatter.format(plan.audience.identifiedFans)}</strong></span>
      <span><small>Platform only</small><strong>${numberFormatter.format(plan.audience.platformOnly)}</strong></span>
      <span><small>Direct eligible</small><strong>${numberFormatter.format(plan.audience.selectedEligible)}</strong></span>
      <span><small>Alert cohort</small><strong>${numberFormatter.format(plan.audience.reachableNow)}</strong></span>
    </div>
    <p class="activation-note">${escapeHtml(plan.audience.explanation)} ${numberFormatter.format(plan.audience.holdout)} fan${plan.audience.holdout === 1 ? "" : "s"} reserved for measurement.</p>
    <div class="activation-links">
      ${links.map(([channel, link]) => `
        <div class="activation-link">
          <span>${escapeHtml(channel)}</span>
          <input value="${escapeHtml(link)}" readonly aria-label="${escapeHtml(channel)} attribution link">
          <button type="button" data-copy="${escapeHtml(link)}" data-copy-label="${escapeHtml(channel)} link">Copy link</button>
        </div>
      `).join("")}
    </div>
    <div class="delivery-readiness">
      ${delivery.map(([channel, details]) => `
        <article><strong>${escapeHtml(channel)} · ${numberFormatter.format(details.eligible)} eligible</strong><p>${escapeHtml(details.explanation)}</p></article>
      `).join("")}
    </div>
    <div class="activation-steps">
      ${plan.steps.map((step) => `
        <div class="activation-step"><b>0${escapeHtml(step.order)}</b><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.detail)}</p></div>
      `).join("")}
    </div>
    <p class="guardrail"><strong>Delivery truth:</strong> This activation is saved, but no email or SMS has been sent. Connect a permitted provider before launch.</p>`;
}

document.querySelector("#campaign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type=submit]");
  const formData = new FormData(event.currentTarget);
  const input = {
    title: formData.get("title"),
    contentUrl: formData.get("contentUrl"),
    objective: formData.get("objective"),
    message: formData.get("message"),
    channels: formData.getAll("channels"),
    holdoutPercent: formData.get("holdoutPercent"),
    confirmedOwnedContent: formData.get("confirmedOwnedContent") === "on",
  };
  submitButton.disabled = true;
  submitButton.textContent = "Calculating real reach…";

  try {
    const response = await fetch("/api/v1/activations/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not prepare the fan alert");
    renderFanActivation(body.data);
    showToast(body.meta?.persisted ? "Fan alert saved to your workspace." : "Demo fan alert prepared.");
  } catch (error) {
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Prepare fan alert ↗";
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

function metaLeadImportInput(form) {
  const data = new FormData(form);
  return {
    formIds: data.getAll("formIds"),
    consentChannels: data.getAll("consentChannels"),
    confirmedAuthorized: document.querySelector("#meta-lead-authorized").checked,
    confirmedConsent: document.querySelector("#meta-lead-authorized").checked,
  };
}

function renderMetaLeadPreview(preview, { committed = false } = {}) {
  const target = document.querySelector("#meta-lead-preview");
  if (committed) {
    target.className = "import-preview success";
    target.innerHTML = `<strong>${numberFormatter.format(preview.accepted)} Meta leads committed</strong><span>${numberFormatter.format(preview.created)} new · ${numberFormatter.format(preview.updated)} updated · ${numberFormatter.format(preview.consentEventsAdded)} consent events added</span>`;
    return;
  }
  const errors = preview.invalid.slice(0, 5).map((item) => `<li>Submission ${numberFormatter.format(item.row)}: ${escapeHtml(item.reason)}</li>`).join("");
  target.className = `import-preview ${preview.summary.valid ? "ready" : "error"}`;
  target.innerHTML = `
    <div class="import-summary"><strong>${numberFormatter.format(preview.summary.valid)} ready</strong><span>${numberFormatter.format(preview.summary.invalid)} rejected · ${numberFormatter.format(preview.summary.duplicates)} duplicates</span></div>
    ${errors ? `<ul>${errors}</ul>` : "<span>Contact fields were validated server-side and were not returned in this preview.</span>"}`;
}

document.querySelector("#meta-lead-import-form").addEventListener("change", () => {
  pendingMetaLeadImport = null;
  document.querySelector("#commit-meta-leads").disabled = true;
});

document.querySelector("#meta-lead-import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const input = metaLeadImportInput(form);
  button.disabled = true;
  button.textContent = "Fetching secure preview…";
  pendingMetaLeadImport = null;
  document.querySelector("#commit-meta-leads").disabled = true;
  try {
    if (!input.formIds.length) throw new Error("Select at least one Meta Instant Form");
    if (!input.consentChannels.length) throw new Error("Choose at least one permitted contact channel");
    if (!input.confirmedConsent) throw new Error("Confirm the selected forms' contact disclosure");
    const response = await fetch("/api/v1/oauth/meta/leads/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not preview Meta leads");
    pendingMetaLeadImport = { input, preview: body.data };
    renderMetaLeadPreview(body.data);
    document.querySelector("#commit-meta-leads").disabled = body.data.summary.valid === 0;
  } catch (error) {
    const target = document.querySelector("#meta-lead-preview");
    target.className = "import-preview error";
    target.innerHTML = `<strong>Meta preview failed</strong><span>${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = false;
    button.textContent = "Preview Meta leads";
  }
});

document.querySelector("#commit-meta-leads").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!pendingMetaLeadImport) return;
  button.disabled = true;
  button.textContent = "Committing Meta leads…";
  try {
    const response = await fetch("/api/v1/oauth/meta/leads/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pendingMetaLeadImport.input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not commit Meta leads");
    renderMetaLeadPreview(body.data, { committed: true });
    pendingMetaLeadImport = null;
    await loadDashboard();
    showToast("Authorized Meta leads are now in your private workspace.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  } finally {
    button.textContent = "Commit accepted leads ↗";
  }
});

document.querySelector("#identity-import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const files = [...(form.elements.files.files || [])];
  const authorization = document.querySelector("#identity-import-authorized");
  const commitButton = document.querySelector("#commit-identity-import");
  button.disabled = true;
  authorization.checked = false;
  authorization.disabled = true;
  commitButton.disabled = true;
  pendingIdentityImport = null;
  try {
    if (!files.length) throw new Error("Choose an official JSON or CSV follower file first");
    if (files.some((file) => file.size > 40 * 1024 * 1024)) throw new Error("Each file must be smaller than 40 MB");
    const source = form.elements.source.value;
    const relationship = form.elements.relationship.value;
    let rows = [];
    for (const file of files) {
      button.textContent = `Reading ${file.name}…`;
      rows.push(...await identityRecordsFromFile(file, relationship));
    }
    if (rows.length > 250000) throw new Error("One import can contain up to 250,000 identities");
    const extracted = rows.length;
    rows = dedupeIdentityRows(rows).map((row) => ({ ...row, source, relationship }));
    const duplicates = extracted - rows.length;
    const batches = chunks(rows, 2000);
    const aggregate = { received: rows.length, valid: 0, invalid: 0, duplicates, invalidRows: [] };
    for (let index = 0; index < batches.length; index += 1) {
      button.textContent = `Checking batch ${index + 1} of ${batches.length}…`;
      const response = await fetch("/api/v1/imports/identities/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, relationship, rows: batches[index] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Could not preview this platform export");
      aggregate.valid += body.data.summary.valid;
      aggregate.invalid += body.data.summary.invalid;
      aggregate.duplicates += body.data.summary.duplicates;
      aggregate.invalidRows.push(...body.data.invalid.map((item) => ({ ...item, row: item.row + (index * 2000) })));
      renderIdentityImport(aggregate, { progress: `Checked ${numberFormatter.format(Math.min((index + 1) * 2000, rows.length))} of ${numberFormatter.format(rows.length)} identities…` });
    }
    pendingIdentityImport = { source, relationship, batches, preview: aggregate };
    renderIdentityImport(aggregate);
    authorization.disabled = aggregate.valid === 0;
  } catch (error) {
    const target = document.querySelector("#identity-import-preview");
    target.className = "import-preview error";
    target.innerHTML = `<strong>Preview failed</strong><span>${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = false;
    button.textContent = "Preview official export";
  }
});

document.querySelector("#identity-import-authorized").addEventListener("change", (event) => {
  document.querySelector("#commit-identity-import").disabled = !event.currentTarget.checked || !pendingIdentityImport?.preview?.valid;
});

document.querySelector("#commit-identity-import").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!pendingIdentityImport || !document.querySelector("#identity-import-authorized").checked) return;
  button.disabled = true;
  const totals = { accepted: 0, created: 0, updated: 0 };
  try {
    const { source, relationship, batches } = pendingIdentityImport;
    for (let index = 0; index < batches.length; index += 1) {
      button.textContent = `Saving batch ${index + 1} of ${batches.length}…`;
      const response = await fetch("/api/v1/imports/identities/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source,
          relationship,
          rows: batches[index],
          confirmedAuthorized: true,
          confirmedOfficialExport: true,
          finalBatch: index === batches.length - 1,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || `Batch ${index + 1} could not be saved`);
      totals.accepted += body.data.accepted;
      totals.created += body.data.created;
      totals.updated += body.data.updated;
      renderIdentityImport({ ...totals, valid: totals.accepted, invalid: 0, duplicates: 0 }, { progress: `Saved ${numberFormatter.format(totals.accepted)} platform identities…` });
    }
    renderIdentityImport(totals, { committed: true });
    pendingIdentityImport = null;
    document.querySelector("#identity-import-authorized").checked = false;
    document.querySelector("#identity-import-authorized").disabled = true;
    await loadDashboard();
    showToast("Official platform identities are now in your private workspace.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  } finally {
    button.textContent = "Commit platform identities ↗";
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
