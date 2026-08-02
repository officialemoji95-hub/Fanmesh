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
let organicPostRecords = [];
let contentMeshRecords = [];
let releasePlanRecords = [];
let pendingReleaseMeshId = "";
let pendingOutreachPlan = null;

const APP_ROUTES = Object.freeze({
  overview: {
    breadcrumb: "Overview",
    title: "Your audience, finally visible.",
    description: "See the relationship you control and the reach still trapped behind platform gates.",
  },
  audience: {
    breadcrumb: "Audience",
    title: "Know who is actually in your mesh.",
    description: "Search consented fan records, identity signals, relationship strength, and recent activity.",
  },
  outreach: {
    breadcrumb: "Outreach",
    title: "Move a post through channels you control.",
    description: "Preview a permissioned lead cohort, verify delivery readiness, then launch with measurable holdouts.",
  },
  organic: {
    breadcrumb: "Organic Pulse",
    title: "Find the posts worth another push.",
    description: "Rank recent authorized post signals across every connected creator platform and save a clean organic baseline.",
  },
  "reach-lab": {
    breadcrumb: "Reach Lab",
    title: "See where the same content wins—or disappears.",
    description: "Match your content across platforms, find honest organic performance gaps, and choose the next native move.",
  },
  release: {
    breadcrumb: "Release Command",
    title: "Plan it. Release it. Learn what actually moved.",
    description: "Turn one Content Mesh idea into native platform actions, a consent-safe audience step, and honest 24/72-hour learning.",
  },
  connections: {
    breadcrumb: "Connections",
    title: "Bring every authorized signal into one system.",
    description: "Manage official OAuth connections, data downloads, ad-lead imports, and the provider rollout.",
  },
  developer: {
    breadcrumb: "Developer",
    title: "Build on the FanMesh audience layer.",
    description: "Use the API contract without exposing platform tokens, private contact fields, or delivery credentials.",
  },
});

const LEGACY_ROUTES = Object.freeze({
  campaign: "outreach",
  "organic-pulse": "organic",
});

function routeFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  const route = LEGACY_ROUTES[raw] || raw;
  return APP_ROUTES[route] ? route : "overview";
}

function renderRoute(route = routeFromHash(), { syncHash = false } = {}) {
  const current = APP_ROUTES[route] ? route : "overview";
  const copy = APP_ROUTES[current];
  document.body.dataset.route = current;
  document.querySelectorAll("[data-page]").forEach((section) => {
    section.hidden = section.dataset.page !== current;
  });
  document.querySelectorAll(".nav [data-route]").forEach((link) => {
    const active = link.dataset.route === current;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelector("#page-breadcrumb").textContent = copy.breadcrumb;
  document.querySelector("#page-title").textContent = copy.title;
  document.querySelector("#page-description").textContent = copy.description;
  document.querySelector(".sidebar").classList.remove("open");
  document.title = `${copy.breadcrumb} · FanMesh`;
  if (syncHash && window.location.hash !== `#/${current}`) {
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#/${current}`);
  }
}

function navigateToRoute(route, targetId = "") {
  const current = APP_ROUTES[route] ? route : "overview";
  const nextHash = `#/${current}`;
  if (window.location.hash === nextHash) renderRoute(current);
  else window.location.hash = nextHash;
  window.requestAnimationFrame(() => {
    if (targetId) document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

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

function safePlatformUrl(value, platform) {
  const allowed = platform === "youtube" ? ["youtube.com", "youtu.be"] : platform === "threads" ? ["threads.com", "threads.net"] : ["x.com"];
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    if (!allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return "";
    return url.href;
  } catch {
    return "";
  }
}

function safeOAuthAuthorizationUrl(value, platform) {
  const allowedHosts = {
    meta: "www.facebook.com",
    tiktok: "www.tiktok.com",
    snapchat: "accounts.snapchat.com",
    youtube: "accounts.google.com",
    x: "x.com",
    threads: "threads.com",
  };
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === allowedHosts[platform] ? url.href : "";
  } catch {
    return "";
  }
}

function durationLabel(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
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

function renderYouTubePerformance(catalog) {
  const target = document.querySelector("#youtube-performance");
  const source = catalog.social.find((item) => item.platform === "youtube");
  if (source?.status !== "connected" || !source.account) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const account = source.account;
  const report = account.analytics28d || {};
  const videos = Array.isArray(account.recentVideos) ? account.recentVideos.slice(0, 8) : [];
  const rows = videos.map((video) => {
    const url = safePlatformUrl(video.shareUrl, "youtube");
    const title = escapeHtml(video.title || "Untitled YouTube video");
    return `<article class="meta-media-row">
      <div class="meta-media-title">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title} ↗</a>` : `<strong>${title}</strong>`}<small>${escapeHtml(shortDate(video.createdAt))}${video.privacyStatus ? ` · ${escapeHtml(video.privacyStatus)}` : ""}</small></div>
      <span><b>${numberFormatter.format(video.views || 0)}</b><small>views</small></span>
      <span><b>${numberFormatter.format(video.likes || 0)}</b><small>likes</small></span>
      <span><b>${numberFormatter.format(video.comments || 0)}</b><small>comments</small></span>
      <span><b>${percent(video.views ? ((video.likes || 0) + (video.comments || 0)) / video.views * 100 : 0)}</b><small>engagement / view</small></span>
    </article>`;
  }).join("");
  const issues = Array.isArray(account.syncIssues) ? account.syncIssues : [];
  const netSubscribers = (report.subscribersGained || 0) - (report.subscribersLost || 0);
  target.hidden = false;
  target.innerHTML = `
    <div class="platform-performance-heading">
      <div><p class="eyebrow">YouTube creator analytics</p><h3>Channel health and recent upload performance</h3></div>
      <span class="status ${issues.length ? "warning" : "good"}">${issues.length ? `${issues.length} access note${issues.length === 1 ? "" : "s"}` : "Official analytics synced"}</span>
    </div>
    <div class="platform-performance-metrics">
      <span><small>${account.hiddenSubscribers ? "Subscribers hidden" : "Subscribers"}</small><strong>${account.hiddenSubscribers ? "Private" : numberFormatter.format(account.followers || 0)}</strong></span>
      <span><small>Lifetime channel views</small><strong>${numberFormatter.format(account.channelViews || 0)}</strong></span>
      <span><small>Channel videos</small><strong>${numberFormatter.format(account.videoCount || 0)}</strong></span>
      <span><small>Recent-video median</small><strong>${numberFormatter.format(account.medianViews || 0)}</strong></span>
    </div>
    <div class="meta-ad-strip">
      <span><small>Views · 28d</small><strong>${numberFormatter.format(report.views || 0)}</strong></span>
      <span><small>Watch time · 28d</small><strong>${numberFormatter.format(report.estimatedMinutesWatched || 0)} min</strong></span>
      <span><small>Average view duration</small><strong>${durationLabel(report.averageViewDuration)}</strong></span>
      <span><small>Subscribers · net 28d</small><strong>${netSubscribers > 0 ? "+" : ""}${numberFormatter.format(netSubscribers)}</strong></span>
      <span><small>Interactions · 28d</small><strong>${numberFormatter.format((report.likes || 0) + (report.comments || 0) + (report.shares || 0))}</strong></span>
    </div>
    <div class="meta-media-list">${rows || `<p class="platform-empty">The channel is connected, but YouTube returned no recent uploads.</p>`}</div>
    ${issues.length ? `<div class="meta-sync-issues"><strong>YouTube access notes</strong><ul>${issues.map((issue) => `<li><strong>${escapeHtml(capabilityLabel(issue.area))}:</strong> ${escapeHtml(issue.message)}</li>`).join("")}</ul></div>` : ""}
    <p class="platform-method">Creator reporting uses the official YouTube Data and YouTube Analytics APIs. The 28-day window ends yesterday so incomplete current-day data does not distort the comparison. Google Ads remains a separate connection.</p>`;
}

function renderTextPlatformPerformance(catalog, platform) {
  const target = document.querySelector(`#${platform}-performance`);
  const source = catalog.social.find((item) => item.platform === platform);
  if (source?.status !== "connected" || !source.account) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const account = source.account;
  const posts = Array.isArray(account.recentPosts) ? account.recentPosts.slice(0, 8) : [];
  const label = platform === "x" ? "X" : "Threads";
  const rows = posts.map((post) => {
    const url = safePlatformUrl(post.permalink, platform);
    const postText = escapeHtml(post.text || `${label} post`);
    return `<article class="meta-media-row">
      <div class="meta-media-title">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${postText} ↗</a>` : `<strong>${postText}</strong>`}<small>${escapeHtml(shortDate(post.createdAt))}${post.mediaType ? ` · ${escapeHtml(capabilityLabel(post.mediaType))}` : ""}</small></div>
      <span><b>${numberFormatter.format(post.impressions || 0)}</b><small>${platform === "threads" ? "views" : "impressions"}</small></span>
      <span><b>${numberFormatter.format(post.likes || 0)}</b><small>likes</small></span>
      <span><b>${numberFormatter.format(post.replies || 0)}</b><small>replies</small></span>
      <span><b>${numberFormatter.format((post.reposts || 0) + (post.quotes || 0) + (post.shares || 0))}</b><small>reposts + shares</small></span>
    </article>`;
  }).join("");
  const issues = Array.isArray(account.syncIssues) ? account.syncIssues : [];
  target.hidden = false;
  target.innerHTML = `
    <div class="platform-performance-heading">
      <div><p class="eyebrow">${label} creator signals</p><h3>Recent posts and authorized performance</h3></div>
      <span class="status ${issues.length ? "warning" : "good"}">${issues.length ? `${issues.length} access note${issues.length === 1 ? "" : "s"}` : "Official account synced"}</span>
    </div>
    <div class="platform-performance-metrics">
      <span><small>Followers</small><strong>${platform === "threads" && !account.followers ? "Not provided" : numberFormatter.format(account.followers || 0)}</strong></span>
      <span><small>Posts measured</small><strong>${numberFormatter.format(account.recentPostCount || 0)}</strong></span>
      <span><small>${platform === "threads" ? "Views" : "Impressions"}</small><strong>${numberFormatter.format(account.recentPostImpressions || 0)}</strong></span>
      <span><small>Engagement / view</small><strong>${percent(account.postEngagementRate)}</strong></span>
    </div>
    <div class="meta-media-list">${rows || `<p class="platform-empty">${label} returned no recent posts for this authorization.</p>`}</div>
    ${issues.length ? `<div class="meta-sync-issues"><strong>${label} access notes</strong><ul>${issues.map((issue) => `<li><strong>${escapeHtml(capabilityLabel(issue.area))}:</strong> ${escapeHtml(issue.message)}</li>`).join("")}</ul></div>` : ""}
    <p class="platform-method">FanMesh reads only the posts and metrics granted by the official ${label} creator API. This measures performance; it does not force feed placement. ${platform === "x" ? "X Ads is a separately approved product." : "Threads authorization remains separate from Instagram."}</p>`;
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

function renderSnapchatLeadCapture(catalog) {
  const target = document.querySelector("#snapchat-lead-capture");
  const form = document.querySelector("#snapchat-lead-form");
  const list = document.querySelector("#snapchat-lead-form-list");
  const stats = document.querySelector("#snapchat-lead-stats");
  const status = document.querySelector("#snapchat-lead-status");
  const source = catalog.social.find((item) => item.platform === "snapchat");
  if (source?.status !== "connected" || !source.account) {
    target.hidden = true;
    return;
  }
  const forms = Array.isArray(source.account.leadForms) ? source.account.leadForms : [];
  const active = forms.filter((item) => item.webhookStatus === "active");
  const captured = forms.reduce((sum, item) => sum + (Number(item.capturedLeads) || 0), 0);
  target.hidden = false;
  stats.innerHTML = `
    <span><small>Ad accounts</small><strong>${numberFormatter.format(source.account.adAccounts || 0)}</strong></span>
    <span><small>Lead forms</small><strong>${numberFormatter.format(forms.length)}</strong></span>
    <span><small>Live forms</small><strong>${numberFormatter.format(active.length)}</strong></span>
    <span><small>Captured leads</small><strong>${numberFormatter.format(captured)}</strong></span>`;
  const available = forms.filter((item) => item.webhookStatus !== "active");
  if (!forms.length) {
    list.innerHTML = "<legend>Authorized Snap forms</legend><p class=\"platform-empty\">Snapchat returned no Lead Generation Forms. Create a lead form in Ads Manager or confirm this login has access to the correct ad account, then sync again.</p>";
  } else {
    list.innerHTML = `<legend>Authorized Snap forms</legend>${forms.map((leadForm) => {
      const isActive = leadForm.webhookStatus === "active";
      const channels = (leadForm.contactFields || []).map((field) => field === "EMAIL" ? "email" : field === "PHONE_NUMBER" ? "SMS" : field).join(" + ") || "no email/phone field";
      const disclosure = leadForm.hasLegalDisclosure ? `${numberFormatter.format(leadForm.requiredConsentCount || 0)} required consent item${leadForm.requiredConsentCount === 1 ? "" : "s"}` : "review disclosure before enabling";
      return `<label class="meta-form-option ${isActive ? "is-live" : ""}"><input type="checkbox" name="formIds" value="${escapeHtml(leadForm.id)}" ${isActive ? "checked disabled" : ""}><span><strong>${escapeHtml(leadForm.name)}</strong><small>${escapeHtml(channels)} · ${escapeHtml(disclosure)} · ${isActive ? `${numberFormatter.format(leadForm.capturedLeads || 0)} captured` : "not live"}</small></span></label>`;
    }).join("")}`;
  }
  form.querySelector("button[type=submit]").disabled = available.length === 0;
  document.querySelector("#snapchat-lead-authorized").disabled = available.length === 0;
  status.className = `import-preview ${active.length ? "success" : ""}`;
  status.innerHTML = active.length
    ? `<strong>${numberFormatter.format(active.length)} live Snap form${active.length === 1 ? "" : "s"}</strong><span>${numberFormatter.format(captured)} verified lead${captured === 1 ? "" : "s"} captured since FanMesh webhooks were enabled.</span>`
    : "<strong>No live forms enabled</strong><span>Select a form and confirm its disclosure. Existing historical leads must be imported from an official export.</span>";
}

function renderSnapchatReadiness(catalog) {
  const target = document.querySelector("#snapchat-readiness");
  const grid = document.querySelector("#snapchat-readiness-grid");
  const actions = document.querySelector("#snapchat-readiness-actions");
  const status = document.querySelector("#snapchat-readiness-status");
  const source = catalog.social.find((item) => item.platform === "snapchat");
  if (!source) {
    target.hidden = true;
    return;
  }
  const setup = source.setup || {};
  const forms = Array.isArray(source.account?.leadForms) ? source.account.leadForms : [];
  const connected = source.status === "connected";
  const steps = [
    { ready: setup.developerCredentialsReady, title: "Snap developer app", detail: "SNAPCHAT_CLIENT_ID and SNAPCHAT_CLIENT_SECRET are stored in Render." },
    { ready: setup.callbackReady && setup.tokenEncryptionReady, title: "Secure OAuth callback", detail: "The HTTPS callback and encrypted token vault are configured." },
    { ready: setup.webhookSchemaReady, title: "Supabase webhook tables", detail: "The 202607310002 Snapchat migration has been applied." },
    { ready: setup.serviceRoleReady, title: "Verified webhook writer", detail: "The server-only Supabase service-role secret is available to signed webhooks." },
    { ready: connected && forms.length > 0, title: "Authorized lead forms", detail: connected ? `${numberFormatter.format(forms.length)} Lead Generation Form${forms.length === 1 ? "" : "s"} discovered.` : "Connect the Snapchat organization that owns the ad account." },
  ];
  const complete = steps.filter((step) => step.ready).length;
  target.hidden = false;
  status.className = `status ${complete === steps.length ? "good" : "warning"}`;
  status.textContent = `${complete} of ${steps.length} ready`;
  grid.innerHTML = steps.map((step, index) => `
    <article class="snapchat-readiness-step ${step.ready ? "ready" : "pending"}">
      <i>${step.ready ? "✓" : index + 1}</i><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.detail)}</span>
    </article>`).join("");
  const connectAction = source.configured && source.connectUrl && !connected
    ? `<a class="connection-button" href="${escapeHtml(source.connectUrl)}">Connect Snapchat ↗</a>`
    : "";
  actions.innerHTML = `
    <a class="connection-button" href="https://business.snapchat.com/" target="_blank" rel="noopener noreferrer">Open Snap Business Manager ↗</a>
    ${connectAction}
    ${source.callbackUrl ? `<code>${escapeHtml(source.callbackUrl)}</code>` : ""}`;
}

function renderSnapchatPerformance(catalog) {
  const target = document.querySelector("#snapchat-performance");
  const source = catalog.social.find((item) => item.platform === "snapchat");
  if (source?.status !== "connected" || !source.account) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const account = source.account;
  const campaigns = (Array.isArray(account.snapchatCampaigns) ? account.snapchatCampaigns : [])
    .slice()
    .sort((first, second) => Date.parse(second.updatedAt || second.createdAt || "") - Date.parse(first.updatedAt || first.createdAt || ""));
  const adSquads = Array.isArray(account.snapchatAdSquads) ? account.snapchatAdSquads : [];
  const ads = Array.isArray(account.snapchatAds) ? account.snapchatAds : [];
  const summary = account.snapchatCampaignSummaryLifetime || {};
  const issues = (Array.isArray(account.syncIssues) ? account.syncIssues : []).filter((issue) => /campaign|ad_squad|ads:|campaign_stats/.test(issue.area || ""));
  const rows = campaigns.slice(0, 12).map((campaign) => {
    const squads = adSquads.filter((item) => item.campaignId === campaign.id);
    const campaignAds = ads.filter((item) => item.campaignId === campaign.id);
    const stats = campaign.stats || {};
    const objective = campaign.objectiveType || campaign.objective || "Objective unavailable";
    const delivery = campaign.deliveryStatus?.[0] || campaign.creationState || campaign.status || "Status unavailable";
    const squadDetails = squads.slice(0, 3).map((squad) => `<span><b>${escapeHtml(squad.name)}</b><small>${escapeHtml(capabilityLabel(squad.optimizationGoal || squad.type || squad.status || "ad squad"))}</small></span>`).join("");
    const adDetails = campaignAds.slice(0, 4).map((ad) => `<span><b>${escapeHtml(ad.name)}</b><small>${escapeHtml(capabilityLabel(ad.reviewStatus || ad.status || ad.type || "ad"))}</small></span>`).join("");
    return `<article class="snapchat-campaign-row">
      <div class="snapchat-campaign-heading">
        <div><strong>${escapeHtml(campaign.name)}</strong><small>${escapeHtml(campaign.adAccountName)} · ${escapeHtml(capabilityLabel(objective))} · updated ${escapeHtml(shortDate(campaign.updatedAt || campaign.createdAt))}</small></div>
        <span class="status ${campaign.status === "ACTIVE" ? "good" : "warning"}">${escapeHtml(capabilityLabel(delivery))}</span>
      </div>
      <div class="snapchat-campaign-metrics">
        <span><small>Spend · lifetime</small><strong>${escapeHtml(formatMoney(stats.spend, campaign.currency))}</strong></span>
        <span><small>Impressions</small><strong>${numberFormatter.format(stats.impressions || 0)}</strong></span>
        <span><small>Swipe-ups</small><strong>${numberFormatter.format(stats.swipes || 0)}</strong></span>
        <span><small>Native leads</small><strong>${numberFormatter.format(stats.nativeLeads || 0)}</strong></span>
        <span><small>Purchases + sign-ups</small><strong>${numberFormatter.format(stats.conversions || 0)}</strong></span>
      </div>
      <div class="snapchat-delivery-counts"><b>${numberFormatter.format(squads.length)}</b> ad squad${squads.length === 1 ? "" : "s"} · <b>${numberFormatter.format(campaignAds.length)}</b> ad${campaignAds.length === 1 ? "" : "s"}</div>
      ${squadDetails ? `<div class="snapchat-entity-list"><small>Ad squads</small>${squadDetails}</div>` : ""}
      ${adDetails ? `<div class="snapchat-entity-list"><small>Ads</small>${adDetails}</div>` : ""}
    </article>`;
  }).join("");
  const issueList = issues.map((issue) => `<li><strong>${escapeHtml(capabilityLabel(issue.area.split(":")[0]))}:</strong> ${escapeHtml(issue.message)}</li>`).join("");
  target.hidden = false;
  target.innerHTML = `
    <div class="snapchat-performance-heading">
      <div><p class="eyebrow">Snapchat Ads reporting</p><h3>Campaigns, delivery structure, and paid results</h3></div>
      <span class="status ${issues.length || !campaigns.length ? "warning" : "good"}">${campaigns.length ? `${numberFormatter.format(campaigns.length)} campaign${campaigns.length === 1 ? "" : "s"} synced` : "No campaigns returned"}</span>
    </div>
    <div class="snapchat-performance-metrics">
      <span><small>Spend · lifetime</small><strong>${escapeHtml(formatMoney(summary.spend, summary.currency))}</strong></span>
      <span><small>Impressions</small><strong>${numberFormatter.format(summary.impressions || 0)}</strong></span>
      <span><small>Swipe-ups</small><strong>${numberFormatter.format(summary.swipes || 0)}</strong></span>
      <span><small>Native leads</small><strong>${numberFormatter.format(summary.nativeLeads || 0)}</strong></span>
      <span><small>Purchases + sign-ups</small><strong>${numberFormatter.format(summary.conversions || 0)}</strong></span>
      <span><small>Ads inventoried</small><strong>${numberFormatter.format(account.adCount || ads.length)}</strong></span>
    </div>
    <div class="snapchat-campaign-list">${rows || `<p class="platform-empty">The Snapchat account is authorized, but the Marketing API returned no campaigns. Confirm the campaign belongs to one of the connected ad accounts, then sync again.</p>`}</div>
    ${campaigns.length > 12 ? `<p class="snapchat-more">Showing the 12 most recently updated campaigns out of ${numberFormatter.format(campaigns.length)} synchronized.</p>` : ""}
    ${issueList ? `<div class="meta-sync-issues"><strong>Snapchat access notes</strong><ul>${issueList}</ul></div>` : ""}
    <p class="platform-method">Lifetime campaign reporting comes from Snapchat’s official Marketing API and is normally refreshed by Snap about every 15 minutes. Spend is converted from micro-currency; purchases and sign-ups are shown as separate tracked conversion types and summed only in the clearly labeled total.</p>`;
}

function renderOrganicPulse(organic = {}) {
  const list = document.querySelector("#organic-post-list");
  const summary = document.querySelector("#organic-summary");
  const status = document.querySelector("#organic-pulse-status");
  const method = document.querySelector("#organic-method");
  organicPostRecords = Array.isArray(organic.posts) ? organic.posts : [];
  const details = organic.summary || {};
  summary.innerHTML = `
    <span><small>Posts analyzed</small><strong>${numberFormatter.format(details.postsAnalyzed || 0)}</strong></span>
    <span><small>High priority</small><strong>${numberFormatter.format(details.highPriority || 0)}</strong></span>
    <span><small>Platforms</small><strong>${numberFormatter.format((details.platforms || []).length)}</strong></span>`;
  status.className = `status ${organicPostRecords.length ? "good" : "warning"}`;
  status.textContent = organicPostRecords.length ? `${organicPostRecords.length} recent posts` : "Sync needed";
  method.textContent = organic.methodology || "Sync a supported creator platform to compare recent organic post performance.";
  if (!organicPostRecords.length) {
    list.innerHTML = `<article class="organic-empty"><strong>No eligible recent posts yet</strong><p>Connect or sync Instagram, TikTok, YouTube, X, or Threads. FanMesh needs a public post URL and authorized performance metrics before it can capture an organic baseline.</p><button class="button secondary" type="button" data-scroll="connections">Review connections ↑</button></article>`;
    return;
  }
  list.innerHTML = organicPostRecords.slice(0, 6).map((post) => `
    <article class="organic-post ${escapeHtml(post.priority)}">
      <div class="organic-post-heading">
        <span class="organic-platform ${escapeHtml(post.platform)}">${escapeHtml(post.platform)}</span>
        <span class="organic-score"><b>${numberFormatter.format(post.opportunityScore)}</b>/100 opportunity</span>
      </div>
      <a class="organic-title" href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(post.title)} ↗</a>
      <p class="organic-account">${post.account ? `@${escapeHtml(post.account.replace(/^@/, ""))} · ` : ""}${escapeHtml(shortDate(post.publishedAt))} · ${escapeHtml(post.recoveryWindow)}</p>
      <div class="organic-metrics">
        <span><small>${escapeHtml(post.reachMetric)}</small><strong>${numberFormatter.format(post.currentReach)}</strong></span>
        <span><small>${escapeHtml(post.benchmarkLabel)}</small><strong>${numberFormatter.format(post.benchmark)}</strong></span>
        <span><small>Follower coverage</small><strong>${post.followersAvailable ? percent(post.followerCoverageRate) : "Not provided"}</strong></span>
        <span><small>Interactions</small><strong>${numberFormatter.format(post.interactions)}</strong></span>
      </div>
      <p class="organic-reason">${escapeHtml(post.reasons?.join(" · ") || "Keep measuring this post organically.")}</p>
      <button class="button primary organic-activate" type="button" data-organic-activate="${escapeHtml(post.key)}">Prepare organic pulse ↗</button>
    </article>`).join("");
}

function renderReachLab(mesh = {}) {
  const list = document.querySelector("#reach-lab-list");
  const summary = document.querySelector("#reach-lab-summary");
  const status = document.querySelector("#reach-lab-status");
  const method = document.querySelector("#reach-lab-method");
  const groups = Array.isArray(mesh.content) ? mesh.content : [];
  contentMeshRecords = groups;
  const details = mesh.summary || {};
  summary.innerHTML = `
    <span><small>Organic posts</small><strong>${numberFormatter.format(details.postsAnalyzed || 0)}</strong></span>
    <span><small>Content ideas</small><strong>${numberFormatter.format(details.contentGroups || 0)}</strong></span>
    <span><small>Cross-platform matches</small><strong>${numberFormatter.format(details.crossPlatformGroups || 0)}</strong></span>
    <span><small>Recovery gaps</small><strong>${numberFormatter.format(details.recoveryGaps || 0)}</strong></span>`;
  status.className = `status ${groups.length ? "good" : "warning"}`;
  status.textContent = groups.length ? `${numberFormatter.format(groups.length)} ideas mapped` : "Sync needed";
  method.textContent = mesh.methodology || "Waiting for authorized organic post signals from connected platforms.";
  if (!groups.length) {
    list.innerHTML = `<article class="organic-empty"><strong>No content to mesh yet</strong><p>Sync at least one creator platform. Cross-platform comparison begins automatically when matching titles or captions appear on two connected platforms.</p><button class="button secondary" type="button" data-route="connections">Open connections ↗</button></article>`;
    renderReleaseBuilder();
    return;
  }
  list.innerHTML = groups.slice(0, 12).map((item) => {
    const comparisons = (item.posts || []).map((post) => `
      <a class="reach-platform-row" href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">
        <span class="organic-platform ${escapeHtml(post.platform)}">${escapeHtml(post.platform)}</span>
        <span><small>${escapeHtml(post.reachMetric)} / own benchmark</small><strong>${numberFormatter.format(post.currentReach)} / ${numberFormatter.format(post.benchmark)}</strong></span>
        <b>${post.performanceIndex === null ? "Building baseline" : `${numberFormatter.format(post.performanceIndex)}%`}</b>
      </a>`).join("");
    return `<article class="reach-card ${escapeHtml(item.priority)}">
      <div class="reach-card-heading">
        <span class="reach-state ${escapeHtml(item.status)}">${escapeHtml(item.status.replaceAll("_", " "))}</span>
        <span class="organic-score"><b>${numberFormatter.format(item.opportunityScore)}</b>/100 opportunity</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="reach-evidence">${escapeHtml(item.matchEvidence)}</p>
      <div class="reach-platforms">${comparisons}</div>
      <div class="reach-plan"><strong>Best next move</strong><ol>${(item.recommendations || []).map((recommendation) => `<li>${escapeHtml(recommendation)}</li>`).join("")}</ol></div>
      <button class="button primary reach-build" type="button" data-release-mesh="${escapeHtml(item.id)}">Build measured release ↗</button>
    </article>`;
  }).join("");
  renderReleaseBuilder();
}

function localDateTimeValue(value) {
  const date = value ? new Date(value) : new Date(Date.now() + 3600000);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function releaseTimeLabel(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Schedule pending";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function renderReleaseBuilder(preferredId = pendingReleaseMeshId) {
  const form = document.querySelector("#release-plan-form");
  if (!form) return;
  const select = form.elements.meshId;
  const previous = preferredId || select.value;
  select.innerHTML = contentMeshRecords.length
    ? contentMeshRecords.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title.slice(0, 90))} · ${numberFormatter.format(item.opportunityScore)} opportunity</option>`).join("")
    : '<option value="">No synchronized content ideas yet</option>';
  const selectedId = contentMeshRecords.some((item) => item.id === previous) ? previous : contentMeshRecords[0]?.id || "";
  select.value = selectedId;
  select.disabled = !selectedId;
  const item = contentMeshRecords.find((entry) => entry.id === selectedId);
  const changed = form.dataset.meshId !== selectedId;
  form.dataset.meshId = selectedId;
  if (changed) {
    form.elements.title.value = item?.title || "";
    form.elements.confirmedOwnedContent.checked = false;
    setReleaseFormFeedback();
  }
  if (!form.elements.releaseAt.value) form.elements.releaseAt.value = localDateTimeValue();
  form.elements.releaseAt.min = localDateTimeValue(new Date(Date.now() - (5 * 60000)));
  form.elements.releaseAt.max = localDateTimeValue(new Date(Date.now() + (180 * 86400000)));
  const available = new Set([...(item?.platforms || []), ...(item?.missingPlatforms || [])]);
  [...form.querySelectorAll('input[name="platforms"]')].forEach((field) => {
    field.disabled = !available.has(field.value);
    if (changed) field.checked = available.has(field.value);
  });
  form.querySelector('button[type="submit"]').disabled = !item;
  pendingReleaseMeshId = selectedId;
}

function checkpointMetricRows(plan) {
  return (plan.platforms || []).map((item) => `
    <div class="checkpoint-row" data-checkpoint-platform="${escapeHtml(item.platform)}">
      <span class="organic-platform ${escapeHtml(item.platform)}">${escapeHtml(item.platform)}</span>
      <label>${escapeHtml(item.baseline?.reachMetric || "views")}<input name="currentReach" type="number" min="0" step="1" required placeholder="${numberFormatter.format(item.baseline?.currentReach || 0)}"></label>
      <label>Interactions<input name="interactions" type="number" min="0" step="1" value="0"></label>
      <label>Link clicks<input name="linkClicks" type="number" min="0" step="1" value="0"></label>
      <label>Conversions<input name="conversions" type="number" min="0" step="1" value="0"></label>
    </div>`).join("");
}

function renderReleaseCommand(plan) {
  const target = document.querySelector("#release-command-result");
  if (!plan) {
    target.innerHTML = '<div class="empty-sequence"><span class="sequence-icon">▶</span><h3>Your command plan will appear here</h3><p>FanMesh will show exactly what is scheduled, what remains manual, and how the result will be judged.</p></div>';
    return;
  }
  const platforms = plan.platforms || [];
  const nextCheckpoint = (plan.checkpoints || []).some((item) => item.checkpoint === "24h") ? "72h" : "24h";
  const firstUrl = platforms.find((item) => item.baseline?.url)?.baseline?.url || "";
  const timeline = (plan.schedule || []).map((item) => `<li><time>${escapeHtml(releaseTimeLabel(item.scheduledAt))}</time><span>${escapeHtml(item.action)}</span></li>`).join("");
  const platformCards = platforms.map((item) => `
    <article class="release-platform-card">
      <header><span class="organic-platform ${escapeHtml(item.platform)}">${escapeHtml(item.platform)}</span><time>${escapeHtml(releaseTimeLabel(item.publishAt))}</time></header>
      <small>${escapeHtml(item.guidance?.sourceState?.replaceAll("_", " ") || "native version")}</small>
      <strong>${escapeHtml(item.guidance?.format || "Native platform version")}</strong>
      <p>${escapeHtml(item.guidance?.hook || "Adapt the opening for this platform.")}</p>
      <p>${escapeHtml(item.guidance?.followUp || "Measure before changing the creative.")}</p>
    </article>`).join("");
  target.innerHTML = `<div class="release-command">
    <div class="release-command-heading"><div><p class="eyebrow">${escapeHtml(plan.id)}</p><h3>${escapeHtml(plan.title)}</h3></div><span class="status ${plan.status === "completed" || plan.status === "active" ? "good" : "warning"}">${escapeHtml(plan.status)}</span></div>
    <p class="release-command-meta">Release ${escapeHtml(releaseTimeLabel(plan.releaseAt))} · ${escapeHtml(plan.objective)} · Primary metric: ${escapeHtml(plan.primaryMetric)}</p>
    <div class="release-kpis">
      <span><small>Platforms</small><strong>${numberFormatter.format(platforms.length)}</strong></span>
      <span><small>Direct eligible</small><strong>${numberFormatter.format(plan.audience?.eligibleDirect || 0)}</strong></span>
      <span><small>Holdout</small><strong>${numberFormatter.format(plan.audience?.heldOut || 0)}</strong></span>
      <span><small>Checkpoints</small><strong>${numberFormatter.format((plan.checkpoints || []).length)}/2</strong></span>
    </div>
    <div class="release-platform-plan">${platformCards}</div>
    <div class="release-timeline"><strong>Command timeline</strong><ol>${timeline}</ol></div>
    <div class="release-learning"><strong>${escapeHtml(plan.learning?.state?.replaceAll("_", " ") || "Awaiting data")}</strong><p>${escapeHtml(plan.learning?.nextAction || "Record the first organic checkpoint after 24 hours.")}</p></div>
    <div class="release-command-actions">
      ${firstUrl ? `<a class="button secondary" href="${escapeHtml(firstUrl)}" target="_blank" rel="noopener noreferrer">Open source post ↗</a>` : ""}
      <button class="button secondary" type="button" data-release-outreach="${escapeHtml(plan.databaseId || plan.id)}">Prepare consented outreach ↗</button>
    </div>
    ${plan.databaseId ? `<form class="checkpoint-form" data-release-checkpoint-form="${escapeHtml(plan.databaseId)}">
      <div class="checkpoint-heading"><strong>Record an organic checkpoint</strong><label>Window<select name="checkpoint"><option value="24h" ${nextCheckpoint === "24h" ? "selected" : ""}>24 hours</option><option value="72h" ${nextCheckpoint === "72h" ? "selected" : ""}>72 hours</option></select></label></div>
      <div class="checkpoint-metrics">${checkpointMetricRows(plan)}</div>
      <textarea name="notes" maxlength="500" placeholder="What changed in the hook, format, audience response, or timing?"></textarea>
      <label class="checkpoint-confirm"><input name="confirmedOrganicOnly" type="checkbox" required> These totals exclude paid ads, boosted delivery, and purchased traffic.</label>
      <button class="button primary" type="submit">Save checkpoint and learn ↗</button>
    </form>` : '<p class="guardrail"><strong>Demo preview:</strong> sign in to persist checkpoints.</p>'}
    <p class="guardrail"><strong>Delivery truth:</strong> A release plan schedules human and permitted actions. FanMesh has not published, messaged followers, or changed a platform feed.</p>
  </div>`;
}

function renderReleaseHistory(plans = releasePlanRecords) {
  const list = document.querySelector("#release-plan-list");
  const status = document.querySelector("#release-history-status");
  status.className = `status ${plans.length ? "good" : "warning"}`;
  status.textContent = plans.length ? `${numberFormatter.format(plans.length)} saved plans` : "No plans yet";
  if (!plans.length) {
    list.innerHTML = '<article class="organic-empty"><strong>No release history yet</strong><p>Build the first plan from a current Reach Lab idea. FanMesh will keep its checkpoints in your private workspace.</p></article>';
    return;
  }
  list.innerHTML = plans.slice(0, 9).map((plan) => `
    <article class="release-plan-card">
      <header><span class="status ${plan.status === "completed" || plan.status === "active" ? "good" : "warning"}">${escapeHtml(plan.status)}</span><small>${escapeHtml(releaseTimeLabel(plan.releaseAt))}</small></header>
      <h3>${escapeHtml(plan.title)}</h3>
      <div class="release-platform-chips">${(plan.platforms || []).map((item) => `<span>${escapeHtml(item.platform)}</span>`).join("")}</div>
      <p>${escapeHtml(plan.learning?.nextAction || "Awaiting the first organic checkpoint.")}</p>
      <button class="button secondary" type="button" data-release-open="${escapeHtml(plan.databaseId || plan.id)}">Open command plan ↗</button>
    </article>`).join("");
}

async function loadReleasePlans() {
  try {
    const response = await fetch("/api/v1/releases?limit=12");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Release history unavailable");
    releasePlanRecords = Array.isArray(body.data) ? body.data : [];
    renderReleaseHistory();
    if (releasePlanRecords.length && !document.querySelector("#release-command-result .release-command")) {
      renderReleaseCommand(releasePlanRecords[0]);
    }
  } catch (error) {
    document.querySelector("#release-history-status").textContent = "History unavailable";
    document.querySelector("#release-plan-list").innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
  }
}

function releasePlanInput(form) {
  const data = new FormData(form);
  const releaseAt = new Date(data.get("releaseAt"));
  return {
    meshId: data.get("meshId"),
    title: data.get("title"),
    releaseAt: Number.isNaN(releaseAt.getTime()) ? "" : releaseAt.toISOString(),
    objective: data.get("objective"),
    platforms: data.getAll("platforms"),
    channels: data.getAll("channels"),
    holdoutPercent: data.get("holdoutPercent"),
    confirmedOwnedContent: data.get("confirmedOwnedContent") === "on",
  };
}

function setReleaseFormFeedback(message = "", state = "") {
  const feedback = document.querySelector("#release-form-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `release-form-feedback${state ? ` ${state}` : ""}`;
}

function validateReleasePlanInput(input) {
  if (!input.meshId) return { field: "meshId", message: "Choose a synchronized content idea first." };
  if (!String(input.title || "").trim()) return { field: "title", message: "Give this release plan a title." };
  const releaseAt = Date.parse(input.releaseAt || "");
  const now = Date.now();
  if (!Number.isFinite(releaseAt)) return { field: "releaseAt", message: "Choose a valid release date and time." };
  if (releaseAt < now - (5 * 60000)) return { field: "releaseAt", message: "That release time has passed. Choose a current or future time." };
  if (releaseAt > now + (180 * 86400000)) return { field: "releaseAt", message: "Choose a release time within the next 180 days." };
  if (!input.platforms.length) return { field: "platforms", message: "Select at least one connected creator platform." };
  if (!input.confirmedOwnedContent) {
    return {
      field: "confirmedOwnedContent",
      message: "Check the ownership confirmation so FanMesh knows these are your content and creator accounts.",
    };
  }
  return null;
}

function focusReleaseField(form, name) {
  const field = [...form.querySelectorAll(`[name="${name}"]`)].find((item) => !item.disabled);
  field?.focus();
  field?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function releaseCheckpointInput(form) {
  const metrics = [...form.querySelectorAll("[data-checkpoint-platform]")].map((row) => ({
    platform: row.dataset.checkpointPlatform,
    currentReach: row.querySelector('[name="currentReach"]').value,
    interactions: row.querySelector('[name="interactions"]').value,
    linkClicks: row.querySelector('[name="linkClicks"]').value,
    conversions: row.querySelector('[name="conversions"]').value,
  }));
  return {
    checkpoint: form.elements.checkpoint.value,
    metrics,
    notes: form.elements.notes.value,
    confirmedOrganicOnly: form.elements.confirmedOrganicOnly.checked,
  };
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
        <div class="connection-summary"><strong>${source.platform === "snapchat" ? `${numberFormatter.format(source.account?.campaignCount || 0)} campaigns` : source.platform === "youtube" && source.account?.hiddenSubscribers ? "Subscribers private" : source.platform === "threads" ? "Followers not provided" : `${numberFormatter.format(source.account?.followers || 0)} followers`}</strong><span>${source.platform === "tiktok" ? `${numberFormatter.format(source.account?.recentVideoCount || 0)} posts · ${numberFormatter.format(source.account?.averageViews || 0)} avg views` : source.platform === "youtube" ? `${numberFormatter.format(source.account?.videoCount || 0)} channel videos · ${numberFormatter.format(source.account?.analyticsViews28d || 0)} views in 28d` : source.platform === "x" || source.platform === "threads" ? `${numberFormatter.format(source.account?.recentPostCount || 0)} recent posts · ${numberFormatter.format(source.account?.recentPostImpressions || 0)} ${source.platform === "threads" ? "views" : "impressions"}` : source.platform === "meta" ? `${numberFormatter.format(source.account?.pageCount || 0)} Pages · ${numberFormatter.format(source.account?.instagramAccountCount || 0)} Instagram` : source.platform === "snapchat" ? `${numberFormatter.format(source.account?.adAccounts || 0)} ad accounts · ${numberFormatter.format(source.account?.adCount || 0)} ads · ${numberFormatter.format(source.account?.leadFormCount || 0)} lead forms` : `${numberFormatter.format(source.account?.adAccounts || 0)} ad accounts`}</span></div>
        <div class="connection-actions"><button class="connection-button" type="button" data-connection-sync="${escapeHtml(source.platform)}">Sync now</button><button class="connection-link" type="button" data-connection-disconnect="${escapeHtml(source.platform)}">Disconnect</button></div>
      ` : source.configured && source.connectUrl ? `
        <button class="connection-button" type="button" data-connection-connect="${escapeHtml(source.platform)}">Connect ${escapeHtml(source.label)} ↗</button>
      ` : `
        <span class="connection-needed">Developer app needed</span>
      `}
    </article>
  `).join("");
  renderSnapchatReadiness(catalog);
  renderSnapchatPerformance(catalog);
  renderMetaPerformance(catalog);
  renderMetaLeadImport(catalog);
  renderSnapchatLeadCapture(catalog);
  renderTikTokPerformance(catalog);
  renderYouTubePerformance(catalog);
  renderTextPlatformPerformance(catalog, "x");
  renderTextPlatformPerformance(catalog, "threads");
}

async function startConnection(platform, button) {
  const label = button.textContent.replace(/^Connect\s+|\s+↗$/g, "") || platform;
  const original = button.textContent;
  const scrollTop = document.scrollingElement?.scrollTop || window.scrollY || 0;
  // Threads documents a native browser/webview authorization window. Keep
  // that flow in this tab so in-app browsers cannot silently block it as a
  // popup; the OAuth callback returns the creator to FanMesh afterward.
  const oauthWindow = platform === "threads" ? null : window.open("about:blank", "_blank");
  button.disabled = true;
  button.textContent = `Preparing ${label}…`;
  try {
    const response = await fetch(`/api/v1/oauth/${encodeURIComponent(platform)}/start`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `${label} authorization could not start`);
    const authorizationUrl = safeOAuthAuthorizationUrl(body.data?.redirectUrl, platform);
    if (!authorizationUrl) throw new Error(`${label} returned an unsafe authorization address`);

    if (platform === "threads") {
      window.location.assign(authorizationUrl);
      return;
    }

    const fallback = document.createElement("a");
    fallback.className = "connection-button";
    fallback.href = authorizationUrl;
    fallback.target = "_blank";
    fallback.rel = "noopener noreferrer";
    fallback.textContent = `Continue to ${label} ↗`;
    button.after(fallback);
    button.hidden = true;
    const restoreScroll = () => {
      if (document.scrollingElement) document.scrollingElement.scrollTop = scrollTop;
      else window.scrollTo({ top: scrollTop });
    };
    window.requestAnimationFrame(() => {
      restoreScroll();
      window.requestAnimationFrame(restoreScroll);
    });

    if (oauthWindow) {
      oauthWindow.opener = null;
      oauthWindow.location.replace(authorizationUrl);
      window.setTimeout(() => {
        try {
          if (!oauthWindow.closed && oauthWindow.location.href === "about:blank") {
            showToast(`Your browser blocked ${label}. Tap Continue to ${label} again.`);
          }
        } catch {
          // Cross-origin access is denied once the platform consent screen opens successfully.
        }
      }, 1200);
    } else {
      showToast(`Pop-ups are blocked. Tap Continue to ${label} to open the consent screen.`);
    }
  } catch (error) {
    if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
    button.disabled = false;
    button.textContent = original;
    showToast(error.message);
  }
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
    await Promise.all([loadDashboard(), loadReleasePlans(), loadOutreachReadiness()]);
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
    const { insights, fans, connections, organic, contentMesh, workspace } = body.data;
    const meta = body.meta;
    const { snapshot } = insights;
    fanRecords = fans;
    updateDashboardChrome(snapshot, workspace, meta);
    renderRecommendations(insights.recommendations);
    renderConnections(connections);
    renderOrganicPulse(organic);
    renderReachLab(contentMesh);
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
    await Promise.all([loadDashboard(), loadOutreachReadiness(), loadReleasePlans()]);
    handleOAuthReturn();
  } catch (error) {
    showAuthGate(true);
    document.querySelector("#auth-message").textContent = error.message;
  }
}

document.addEventListener("click", async (event) => {
  const toastTrigger = event.target.closest("[data-toast]");
  if (toastTrigger) showToast(toastTrigger.dataset.toast);

  const routeTrigger = event.target.closest("[data-route]");
  if (routeTrigger) {
    event.preventDefault();
    navigateToRoute(routeTrigger.dataset.route);
  }

  const scrollTrigger = event.target.closest("[data-scroll]");
  if (scrollTrigger) {
    const target = scrollTrigger.dataset.scroll;
    const route = { connections: "connections", audience: "audience", campaign: "outreach", "organic-pulse": "organic" }[target];
    if (route) navigateToRoute(route, target);
    else document.getElementById(target)?.scrollIntoView({ behavior: "smooth" });
  }

  if (event.target.closest(".notice button")) event.target.closest(".notice").remove();

  const rowAction = event.target.closest("[data-fan]");
  if (rowAction) {
    const fan = fanRecords.find((item) => item.id === rowAction.dataset.fan);
    if (fan) showToast(`${fan.displayName}: score ${fan.fanScore.score}, led by ${fan.fanScore.strongestSignals[0]?.signal || "recent activity"}.`);
  }

  const connectButton = event.target.closest("[data-connection-connect]");
  if (connectButton) await startConnection(connectButton.dataset.connectionConnect, connectButton);

  const syncButton = event.target.closest("[data-connection-sync]");
  if (syncButton) await runConnectionAction("sync", syncButton.dataset.connectionSync, syncButton);

  const disconnectButton = event.target.closest("[data-connection-disconnect]");
  if (disconnectButton) await runConnectionAction("disconnect", disconnectButton.dataset.connectionDisconnect, disconnectButton);

  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    await copyToClipboard(copyButton.dataset.copy);
    showToast(`${copyButton.dataset.copyLabel || "Link"} copied.`);
  }

  const organicButton = event.target.closest("[data-organic-activate]");
  if (organicButton) await activateOrganicPost(organicButton.dataset.organicActivate, organicButton);

  const releaseMeshButton = event.target.closest("[data-release-mesh]");
  if (releaseMeshButton) {
    pendingReleaseMeshId = releaseMeshButton.dataset.releaseMesh;
    renderReleaseBuilder(pendingReleaseMeshId);
    navigateToRoute("release", "release-command");
  }

  const releaseOpenButton = event.target.closest("[data-release-open]");
  if (releaseOpenButton) {
    const plan = releasePlanRecords.find((item) => (item.databaseId || item.id) === releaseOpenButton.dataset.releaseOpen);
    if (plan) {
      renderReleaseCommand(plan);
      navigateToRoute("release", "release-command");
    }
  }

  const releaseOutreachButton = event.target.closest("[data-release-outreach]");
  if (releaseOutreachButton) {
    const plan = releasePlanRecords.find((item) => (item.databaseId || item.id) === releaseOutreachButton.dataset.releaseOutreach);
    if (plan) {
      const sourceUrl = plan.platforms?.find((item) => item.baseline?.url)?.baseline?.url || "";
      const form = document.querySelector("#campaign-form");
      form.elements.title.value = plan.title;
      form.elements.contentUrl.value = sourceUrl;
      form.elements.message.value = `${plan.title} is live. Here is the direct link:`.slice(0, 500);
      form.elements.confirmedOwnedContent.checked = true;
      form.elements.confirmedAudienceRights.checked = false;
      navigateToRoute("outreach", "campaign");
      showToast("Release details copied. Confirm audience rights before previewing outreach.");
    }
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
  const baseline = plan.organicBaseline;
  const nativeActions = Array.isArray(plan.nativeActions) ? plan.nativeActions : [];
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
    ${baseline ? `<div class="organic-baseline">
      <div><p class="eyebrow">Organic baseline saved</p><strong>${numberFormatter.format(baseline.currentReach)} ${escapeHtml(baseline.reachMetric)}</strong><span>${numberFormatter.format(baseline.interactions)} interactions · ${percent(baseline.followerCoverageRate)} follower coverage</span></div>
      <p>${escapeHtml(baseline.note)}</p>
    </div>` : ""}
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
    ${nativeActions.length ? `<div class="native-actions"><strong>Do these native actions now</strong><ol>${nativeActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ol></div>` : ""}
    <p class="guardrail"><strong>Delivery truth:</strong> This activation is saved, but no email or SMS has been sent. Connect a permitted provider before launch.</p>`;
}

async function loadOutreachReadiness() {
  const badge = document.querySelector("#outreach-readiness");
  try {
    const response = await fetch("/api/v1/outreach/readiness");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Sender check failed");
    const ready = Object.values(body.data || {}).filter((provider) => provider.configured).length;
    badge.textContent = ready === 2 ? "Email + SMS ready" : ready === 1 ? "1 sender ready" : "Sender setup needed";
    badge.className = `status ${ready ? "good" : "warning"}`;
  } catch {
    badge.textContent = "Sender check unavailable";
    badge.className = "status warning";
  }
}

function outreachInput(form, { sending = false } = {}) {
  const data = new FormData(form);
  return {
    title: data.get("title"),
    contentUrl: data.get("contentUrl"),
    subject: data.get("subject"),
    message: data.get("message"),
    channels: data.getAll("channels"),
    sources: data.getAll("sources"),
    holdoutPercent: data.get("holdoutPercent"),
    confirmedOwnedContent: data.get("confirmedOwnedContent") === "on",
    confirmedAudienceRights: data.get("confirmedAudienceRights") === "on",
    confirmedSend: sending && data.get("confirmedSend") === "on",
    campaignId: pendingOutreachPlan?.id,
  };
}

function renderLeadOutreach(plan, { launched = false } = {}) {
  const result = document.querySelector("#campaign-result");
  const providers = Object.entries(plan.providers || {});
  const sources = Object.entries(plan.audience?.sources || {}).filter(([, count]) => count > 0);
  result.className = "activation-result";
  result.innerHTML = `
    <div class="activation-heading">
      <div><p class="eyebrow">${escapeHtml(plan.id)}</p><h3>${escapeHtml(plan.title)}</h3></div>
      <span class="status ${launched && plan.status !== "failed" ? "good" : plan.launchable ? "good" : "warning"}">${escapeHtml(launched ? plan.status : plan.launchable ? "Ready to launch" : "Setup needed")}</span>
    </div>
    <div class="reach-summary">
      <span><small>Eligible</small><strong>${numberFormatter.format(plan.audience.eligible || 0)}</strong></span>
      <span><small>Selected</small><strong>${numberFormatter.format(plan.audience.selected || 0)}</strong></span>
      <span><small>Holdout</small><strong>${numberFormatter.format(plan.audience.heldOut || 0)}</strong></span>
      <span><small>${launched ? "Sent" : "Suppressed"}</small><strong>${numberFormatter.format(launched ? plan.audience.sent || 0 : plan.audience.suppressed || 0)}</strong></span>
    </div>
    <p class="activation-note">${sources.length ? sources.map(([source, count]) => `${escapeHtml(source.replaceAll("_", " "))}: ${numberFormatter.format(count)}`).join(" · ") : "No matching consented leads found in the selected sources."}</p>
    <div class="provider-grid">
      ${providers.map(([channel, provider]) => `<article class="provider-card ${provider.configured ? "ready" : ""}"><strong>${escapeHtml(channel)} · ${escapeHtml(provider.provider || "provider")}</strong><span>${escapeHtml(provider.explanation || "Not configured")}</span></article>`).join("")}
    </div>
    <div class="activation-links">${Object.entries(plan.links || {}).map(([channel, link]) => `<div class="activation-link"><span>${escapeHtml(channel)}</span><input value="${escapeHtml(link)}" readonly><button type="button" data-copy="${escapeHtml(link)}" data-copy-label="${escapeHtml(channel)} link">Copy link</button></div>`).join("")}</div>
    <div class="native-actions"><strong>Controls applied</strong><ol>${(plan.guardrails || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></div>
    <p class="guardrail"><strong>Delivery truth:</strong> ${launched ? `${numberFormatter.format(plan.audience.sent || 0)} accepted by the configured provider; ${numberFormatter.format(plan.audience.failed || 0)} failed.` : "This is a preview. Nothing has been sent yet."}</p>`;
}

async function activateOrganicPost(postKey, button) {
  const post = organicPostRecords.find((item) => item.key === postKey);
  if (!post) return;
  const form = document.querySelector("#campaign-form");
  const channels = [...form.querySelectorAll('input[name="channels"]:checked')].map((field) => field.value);
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Saving organic baseline…";
  try {
    const response = await fetch("/api/v1/organic/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postKey,
        channels: channels.length ? channels : ["email"],
        holdoutPercent: form.elements.holdoutPercent.value || 10,
        objective: "evergreen",
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not start the organic pulse");
    form.elements.title.value = post.title;
    form.elements.contentUrl.value = post.url;
    form.elements.message.value = `${post.title} is worth another look:`.slice(0, 280);
    form.elements.confirmedOwnedContent.checked = true;
    renderFanActivation(body.data);
    navigateToRoute("outreach", "campaign");
    showToast("Organic baseline and activation saved. Start with the native actions shown.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.querySelector("#release-plan-form").addEventListener("change", (event) => {
  if (event.target.name !== "meshId") return;
  pendingReleaseMeshId = event.target.value;
  renderReleaseBuilder(pendingReleaseMeshId);
});

document.querySelector("#release-plan-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = releasePlanInput(form);
  const validation = validateReleasePlanInput(input);
  if (validation) {
    setReleaseFormFeedback(validation.message, "error");
    showToast(validation.message);
    focusReleaseField(form, validation.field);
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Building command plan…";
  setReleaseFormFeedback("Building your private command plan. Nothing is being published or sent.", "pending");
  try {
    const response = await fetch("/api/v1/releases/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Release plan could not be created");
    const plan = body.data;
    releasePlanRecords = [plan, ...releasePlanRecords.filter((item) => item.databaseId !== plan.databaseId)];
    renderReleaseCommand(plan);
    renderReleaseHistory();
    form.elements.confirmedOwnedContent.checked = false;
    setReleaseFormFeedback("Release plan saved below. Nothing was published or sent.", "success");
    showToast("Release plan saved. Nothing was published or sent.");
  } catch (error) {
    setReleaseFormFeedback(error.message, "error");
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-release-checkpoint-form]");
  if (!form) return;
  event.preventDefault();
  const databaseId = form.dataset.releaseCheckpointForm;
  const button = form.querySelector('button[type="submit"]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Comparing with baseline…";
  try {
    const response = await fetch(`/api/v1/releases/${encodeURIComponent(databaseId)}/checkpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(releaseCheckpointInput(form)),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Checkpoint could not be saved");
    const plan = body.data;
    releasePlanRecords = [plan, ...releasePlanRecords.filter((item) => item.databaseId !== plan.databaseId)];
    renderReleaseCommand(plan);
    renderReleaseHistory();
    showToast(`${plan.checkpoints.at(-1)?.checkpoint || "Release"} checkpoint saved. The next recommendation is ready.`);
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.textContent = original;
  }
});

document.querySelector("#campaign-form").addEventListener("change", (event) => {
  if (event.target.name === "confirmedSend") {
    document.querySelector("#launch-outreach").disabled = !pendingOutreachPlan?.launchable || !event.target.checked;
    return;
  }
  pendingOutreachPlan = null;
  document.querySelector("#launch-outreach").disabled = true;
  document.querySelector("#campaign-form").elements.confirmedSend.checked = false;
});

document.querySelector("#campaign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type=submit]");
  const input = outreachInput(event.currentTarget);
  submitButton.disabled = true;
  submitButton.textContent = "Checking consented leads…";
  pendingOutreachPlan = null;
  document.querySelector("#launch-outreach").disabled = true;
  event.currentTarget.elements.confirmedSend.checked = false;

  try {
    const response = await fetch("/api/v1/outreach/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not preview lead outreach");
    pendingOutreachPlan = body.data;
    renderLeadOutreach(body.data);
    showToast(body.data.launchable ? "Cohort ready. Review and confirm launch." : "Preview ready. Complete the sender setup shown.");
  } catch (error) {
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Preview eligible leads ↗";
  }
});

document.querySelector("#launch-outreach").addEventListener("click", async (event) => {
  const form = document.querySelector("#campaign-form");
  if (!pendingOutreachPlan) return showToast("Preview the cohort again before launch.");
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Sending through providers…";
  try {
    const response = await fetch("/api/v1/outreach/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(outreachInput(form, { sending: true })),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not launch outreach");
    pendingOutreachPlan = null;
    form.elements.confirmedSend.checked = false;
    renderLeadOutreach(body.data, { launched: true });
    showToast(`${numberFormatter.format(body.meta.messagesSent || 0)} message${body.meta.messagesSent === 1 ? "" : "s"} accepted by the delivery provider.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = true;
    button.textContent = "Launch outreach";
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

document.querySelector("#snapchat-lead-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  const authorized = document.querySelector("#snapchat-lead-authorized").checked;
  const input = {
    formIds: data.getAll("formIds"),
    consentChannels: data.getAll("consentChannels"),
    confirmedAuthorized: authorized,
    confirmedConsent: authorized,
  };
  const target = document.querySelector("#snapchat-lead-status");
  button.disabled = true;
  button.textContent = "Creating verified webhooks…";
  try {
    if (!input.formIds.length) throw new Error("Select at least one Snap Lead Generation Form");
    if (!input.consentChannels.length) throw new Error("Choose at least one permitted contact channel");
    if (!authorized) throw new Error("Confirm the selected forms' contact disclosure");
    const response = await fetch("/api/v1/oauth/snapchat/leads/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not enable live Snapchat leads");
    target.className = "import-preview success";
    target.innerHTML = `<strong>${numberFormatter.format(body.data.webhookCount || 0)} Snap form${body.data.webhookCount === 1 ? "" : "s"} enabled</strong><span>New verified submissions will enter Audience automatically. Historical submissions still require an official Snap export.</span>`;
    document.querySelector("#snapchat-lead-authorized").checked = false;
    await loadDashboard();
    showToast("Live Snapchat lead capture is enabled.");
  } catch (error) {
    target.className = "import-preview error";
    target.innerHTML = `<strong>Snap lead setup failed</strong><span>${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = form.querySelectorAll('input[name="formIds"]:not(:disabled)').length === 0;
    button.textContent = "Enable live Snap leads ↗";
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
    const officialExport = source !== "csv";
    const consentChannels = new FormData(form).getAll("consentChannels");
    const disclosureConfirmed = document.querySelector("#import-disclosure-confirmed").checked;
    if (officialExport && !consentChannels.length) throw new Error("Choose at least one channel permitted by the lead form");
    if (officialExport && !disclosureConfirmed) throw new Error("Confirm the official lead form disclosure before previewing contacts");
    const rows = recordsFromCsv(await file.text()).map((row) => ({ ...row, source }));
    const attestation = officialExport ? {
      confirmedAuthorized: true,
      confirmedConsent: true,
      consentChannels,
    } : {};
    const response = await fetch("/api/v1/imports/leads/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, rows, ...attestation }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Could not preview this import");
    pendingImport = { source, rows, preview: body.data, attestation };
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
      body: JSON.stringify({
        source: pendingImport.source,
        rows: pendingImport.rows,
        ...pendingImport.attestation,
        confirmedAuthorized: true,
      }),
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

document.querySelector("#audience-import-form select[name=source]").addEventListener("change", (event) => {
  const officialExport = event.currentTarget.value !== "csv";
  document.querySelector("#official-lead-attestation").hidden = !officialExport;
  if (!officialExport) document.querySelector("#import-disclosure-confirmed").checked = false;
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
    await Promise.all([loadDashboard(), loadReleasePlans(), loadOutreachReadiness()]);
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

window.addEventListener("hashchange", () => renderRoute(routeFromHash()));
renderRoute(routeFromHash(), { syncHash: true });
bootstrapAccount();
