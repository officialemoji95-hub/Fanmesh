const numberFormatter = new Intl.NumberFormat("en-US");
const toast = document.querySelector(".toast");
let toastTimer;
let fanRecords = [];

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

function channelMarkup(channels) {
  return `<div class="channels">${channels.map((channel) =>
    `<span class="channel ${escapeHtml(channel)}" title="${escapeHtml(channel)}">${escapeHtml(channel.slice(0, 2))}</span>`,
  ).join("")}</div>`;
}

function renderFans(records) {
  const table = document.querySelector("#fan-table");
  if (!records.length) {
    table.innerHTML = '<tr><td colspan="6" class="loading">No fans match that search.</td></tr>';
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

function renderConnections(catalog) {
  const sourceGrid = document.querySelector("#source-grid");
  const sources = [...catalog.social.slice(0, 4), ...catalog.imports.slice(0, 1)];
  sourceGrid.innerHTML = sources.map((source) => `
    <article class="source-card">
      <div class="source-icon ${escapeHtml(source.platform)}">${escapeHtml(source.platform.slice(0, 2))}</div>
      <div class="source-info"><strong>${escapeHtml(source.label)}</strong><span>${escapeHtml(source.status.replaceAll("_", " "))}</span></div>
      <button class="icon-button source-action" data-toast="${escapeHtml(source.authMethod === "oauth" ? "OAuth connection setup is the next production step." : "Use an official export with consent provenance.")}" aria-label="About ${escapeHtml(source.label)}">•••</button>
      <p>${escapeHtml(source.caveat || "Import only records you are authorized to use.")}</p>
      <div class="source-tags">${source.capabilities.slice(0, 2).map((capability) => `<span>${escapeHtml(capabilityLabel(capability))}</span>`).join("")}</div>
    </article>
  `).join("");
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

async function loadDashboard() {
  try {
    const [insightsResponse, fansResponse, connectionsResponse] = await Promise.all([
      fetch("/api/v1/insights"),
      fetch("/api/v1/fans?limit=20"),
      fetch("/api/v1/connections"),
    ]);
    if (!insightsResponse.ok || !fansResponse.ok || !connectionsResponse.ok) throw new Error("Dashboard API unavailable");
    const [{ data: insights }, { data: fans }, { data: connections }] = await Promise.all([
      insightsResponse.json(),
      fansResponse.json(),
      connectionsResponse.json(),
    ]);

    const { snapshot } = insights;
    document.querySelector("#total-followers").textContent = numberFormatter.format(snapshot.totalFollowers);
    document.querySelector("#identified-fans").textContent = numberFormatter.format(snapshot.identifiedFans);
    document.querySelector("#direct-connections").textContent = numberFormatter.format(snapshot.directConnections);
    document.querySelector("#view-rate").textContent = `${snapshot.viewRate}%`;
    renderRecommendations(insights.recommendations);
    renderConnections(connections);
    fanRecords = fans;
    renderFans(fanRecords);
  } catch (error) {
    document.querySelector("#recommendations").innerHTML = `<p class="loading">${escapeHtml(error.message)}</p>`;
    document.querySelector("#fan-table").innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(error.message)}</td></tr>`;
  }
}

document.addEventListener("click", (event) => {
  const toastTrigger = event.target.closest("[data-toast]");
  if (toastTrigger) showToast(toastTrigger.dataset.toast);

  const scrollTrigger = event.target.closest("[data-scroll]");
  if (scrollTrigger) document.getElementById(scrollTrigger.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });

  if (event.target.closest(".notice button")) event.target.closest(".notice").remove();

  const rowAction = event.target.closest("[data-fan]");
  if (rowAction) {
    const fan = fanRecords.find((item) => item.id === rowAction.dataset.fan);
    showToast(`${fan.displayName}: score ${fan.fanScore.score}, led by ${fan.fanScore.strongestSignals[0].signal}.`);
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
    candidateCounts: { followers: 118000, adLeads: 0, optedInFans: 1926 },
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

loadDashboard();
