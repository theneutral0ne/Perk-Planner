const CATEGORY_ACCENTS = {
  "Conditional Perks": "var(--conditional)",
  "Economic Perks": "var(--economic)",
  "Endurance Perks": "var(--endurance)",
  "Melee Perks": "var(--melee)",
  "Ranged Perks": "var(--ranged)",
};

const STORAGE_KEY = "perk-planner-state-v2";
const CATEGORY_ORDER = Object.keys(BOARD_IMAGES);
const EQUIPPED_VIEW = "__equipped";
const TIER_COUNT = 4;
const perkById = new Map(PERKS.map((perk) => [perk.id, perk]));
const tierByPerkId = new Map();

Object.entries(PERK_TIERS).forEach(([category, tiers]) => {
  tiers.forEach((ids, index) => {
    ids.forEach((id, slot) => tierByPerkId.set(id, { category, tier: index + 1, slot }));
  });
});

const state = {
  activeCategory: CATEGORY_ORDER[0],
  levels: {},
  pointLimit: null,
  search: "",
  includeConditional: true,
};

const els = {
  categoryTabs: document.getElementById("categoryTabs"),
  boardImage: document.getElementById("boardImage"),
  boardFrame: document.querySelector(".board-frame"),
  searchInput: document.getElementById("searchInput"),
  categoryEyebrow: document.getElementById("categoryEyebrow"),
  categoryTitle: document.getElementById("categoryTitle"),
  visibleCount: document.getElementById("visibleCount"),
  perkGrid: document.getElementById("perkGrid"),
  categoryBreakdown: document.getElementById("categoryBreakdown"),
  statSummary: document.getElementById("statSummary"),
  ruleSummary: document.getElementById("ruleSummary"),
  pointLimitInput: document.getElementById("pointLimitInput"),
  resetButton: document.getElementById("resetButton"),
  conditionalToggle: document.getElementById("conditionalToggle"),
  imageDialog: document.getElementById("imageDialog"),
  dialogImage: document.getElementById("dialogImage"),
  closeImageDialog: document.getElementById("closeImageDialog"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, "").replace(/\.$/, "");
}

function parsePointLimit(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function hasPointLimit(limit = state.pointLimit) {
  return Number.isFinite(limit);
}

function levelCost(level) {
  return PERK_LEVEL_COSTS.slice(0, level).reduce((sum, cost) => sum + cost, 0);
}

function nextLevelCost(level) {
  return PERK_LEVEL_COSTS[level] ?? Infinity;
}

function totalSpent(levels = state.levels) {
  return Object.entries(levels).reduce((sum, [, level]) => sum + levelCost(level), 0);
}

function categoryPoints(category, levels = state.levels) {
  return PERKS
    .filter((perk) => perk.category === category)
    .reduce((sum, perk) => sum + levelCost(levels[perk.id] || 0), 0);
}

function selectedPerks(levels = state.levels) {
  return PERKS.filter((perk) => (levels[perk.id] || 0) > 0);
}

function replacementMap(levels = state.levels) {
  const map = new Map();
  selectedPerks(levels).forEach((perk) => {
    (perk.replaces || []).forEach((targetId) => map.set(targetId, perk.id));
  });
  return map;
}

function lockMap(levels = state.levels) {
  const map = new Map();
  selectedPerks(levels).forEach((perk) => {
    [...(perk.locks || []), ...(perk.replaces || [])].forEach((targetId) => map.set(targetId, perk.id));
  });
  return map;
}

function activePerks(levels = state.levels) {
  const replaced = replacementMap(levels);
  return selectedPerks(levels).filter((perk) => !replaced.has(perk.id));
}

function getMutualExclusions(perkId) {
  const perk = perkById.get(perkId);
  const direct = new Set(perk?.mutuallyExclusive || []);
  PERKS.forEach((other) => {
    if ((other.mutuallyExclusive || []).includes(perkId)) direct.add(other.id);
  });
  return [...direct];
}

function requirementLabels(perk) {
  const labels = [];
  (perk.requiresMaxed || []).forEach((id) => labels.push(`Max ${perkById.get(id)?.name || id}`));
  (perk.requiresAnyMaxed || []).forEach((group) => {
    labels.push(`Max ${group.map((id) => perkById.get(id)?.name || id).join(" or ")}`);
  });
  (perk.requiresLevel || []).forEach((req) => labels.push(`${perkById.get(req.id)?.name || req.id} Lv ${req.level}+`));
  if (perk.categoryRequirement) labels.push(`${perk.categoryRequirement.points} ${perk.categoryRequirement.category} pts`);
  getMutualExclusions(perk.id).forEach((id) => labels.push(`Excludes ${perkById.get(id)?.name || id}`));
  if (perk.replaces?.length) labels.push(`Replaces ${perk.replaces.map((id) => perkById.get(id)?.name || id).join(", ")}`);
  if (perk.locks?.length) labels.push(`Locks ${perk.locks.map((id) => perkById.get(id)?.name || id).join(", ")}`);
  return labels;
}

function getIssues(levels = state.levels, pointLimit = state.pointLimit) {
  const issues = [];
  const spent = totalSpent(levels);
  if (hasPointLimit(pointLimit) && spent > pointLimit) {
    issues.push({ perkId: null, text: `Point limit exceeded by ${spent - pointLimit}.` });
  }

  const selected = selectedPerks(levels);
  const selectedIds = new Set(selected.map((perk) => perk.id));
  const seenMutual = new Set();

  selected.forEach((perk) => {
    (perk.requiresMaxed || []).forEach((id) => {
      if ((levels[id] || 0) < 3) {
        issues.push({ perkId: perk.id, text: `${perk.name} requires maxed ${perkById.get(id)?.name || id}.` });
      }
    });

    (perk.requiresAnyMaxed || []).forEach((group) => {
      const met = group.some((id) => (levels[id] || 0) >= 3);
      if (!met) {
        issues.push({ perkId: perk.id, text: `${perk.name} requires maxed ${group.map((id) => perkById.get(id)?.name || id).join(" or ")}.` });
      }
    });

    (perk.requiresLevel || []).forEach((req) => {
      if ((levels[req.id] || 0) < req.level) {
        issues.push({ perkId: perk.id, text: `${perk.name} requires ${perkById.get(req.id)?.name || req.id} level ${req.level}.` });
      }
    });

    if (perk.categoryRequirement) {
      const ownCost = levelCost(levels[perk.id] || 0);
      const categorySpent = categoryPoints(perk.categoryRequirement.category, levels) - ownCost;
      if (categorySpent < perk.categoryRequirement.points) {
        issues.push({
          perkId: perk.id,
          text: `${perk.name} needs ${perk.categoryRequirement.points} points invested in ${perk.categoryRequirement.category}; current eligible points: ${categorySpent}.`,
        });
      }
    }

    getMutualExclusions(perk.id).forEach((otherId) => {
      if (!selectedIds.has(otherId)) return;
      const key = [perk.id, otherId].sort().join("|");
      if (seenMutual.has(key)) return;
      seenMutual.add(key);
      issues.push({ perkId: perk.id, text: `${perk.name} is mutually-exclusive with ${perkById.get(otherId)?.name || otherId}.` });
    });
  });

  return issues;
}

function scaledEffect(effect, level) {
  if (Array.isArray(effect.levelValues)) {
    return effect.levelValues[Math.max(0, Math.min(effect.levelValues.length - 1, level - 1))];
  }
  if (effect.scales === false) {
    return effect.op === "x" ? effect.value : effect.value;
  }
  if (effect.op === "x") {
    return 100 + (effect.value - 100) * level;
  }
  return effect.value * level;
}

function effectDelta(effect, level) {
  if (effect.op === "x") return scaledEffect(effect, level) - 100;
  return scaledEffect(effect, level);
}

function formatEffect(effect, level) {
  const value = scaledEffect(effect, level);
  if (effect.op === "x") return `${effect.stat}: x${formatNumber(value)}${effect.unit}`;
  if (effect.stat === "Stamina Regen/Usage" && value > 0) return `${effect.stat}: +/-${formatNumber(value)}${effect.unit}`;
  const sign = value > 0 ? "+" : "";
  return `${effect.stat}: ${sign}${formatNumber(value)}${effect.unit}`;
}

function isPenaltyEffect(effect) {
  return (effect.tags || []).includes("penalty");
}

function isConditionalEffect(effect) {
  return (effect.tags || []).includes("conditional");
}

function groupForEffect(effect) {
  const tags = effect.tags || [];
  if (tags.includes("penalty")) return "Penalties";
  if (tags.includes("economy")) return "Economy";
  if (tags.includes("synergy")) return "Perk Interactions";
  if (tags.includes("conditional")) return "Conditional / Situational";
  if (tags.includes("combat")) return "Combat";
  if (tags.includes("survival")) return "Survival";
  if (tags.includes("mobility")) return "Mobility";
  return "Support & Utility";
}

function aggregateStats(levels = state.levels, includeConditional = state.includeConditional) {
  const groups = new Map();
  activePerks(levels).forEach((perk) => {
    const level = levels[perk.id] || 0;
    perk.effects.forEach((effect) => {
      if (!includeConditional && isConditionalEffect(effect)) return;
      const group = groupForEffect(effect);
      const key = `${group}|${effect.stat}|${effect.unit || ""}|${effect.op || "add"}`;
      if (!groups.has(group)) groups.set(group, new Map());
      const bucket = groups.get(group);
      if (!bucket.has(key)) {
        bucket.set(key, {
          stat: effect.stat,
          unit: effect.unit || "",
          op: effect.op || "add",
          value: effect.op === "x" ? 100 : 0,
          delta: 0,
          penalty: isPenaltyEffect(effect),
        });
      }
      const item = bucket.get(key);
      if (effect.op === "x") {
        item.delta += effectDelta(effect, level);
        item.value = 100 + item.delta;
      } else {
        item.value += scaledEffect(effect, level);
      }
    });
  });
  return groups;
}

function renderAggregatedValue(item) {
  if (item.op === "x") return `x${formatNumber(item.value)}${item.unit}`;
  if (item.stat === "Stamina Regen/Usage" && item.value > 0) return `+/-${formatNumber(item.value)}${item.unit}`;
  const sign = item.value > 0 ? "+" : "";
  return `${sign}${formatNumber(item.value)}${item.unit}`;
}

function canApplyLevel(perkId, nextLevel, levels = state.levels, budget = state.pointLimit) {
  const next = { ...levels };
  if (nextLevel <= 0) delete next[perkId];
  else next[perkId] = nextLevel;
  return getIssues(next, budget).length === 0;
}

function setPerkLevel(perkId, level) {
  const nextLevel = Math.max(0, Math.min(3, level));
  if (nextLevel === 0) delete state.levels[perkId];
  else state.levels[perkId] = nextLevel;
  saveState();
  render();
}

function categoryAccent(category) {
  return CATEGORY_ACCENTS[category] || "var(--warn)";
}

function perkTier(perk) {
  return tierByPerkId.get(perk.id)?.tier || 1;
}

function tierLabel(perk) {
  return `Tier ${perkTier(perk)}`;
}

function perkBoardSort(a, b) {
  const aInfo = tierByPerkId.get(a.id) || { tier: 1, slot: 0 };
  const bInfo = tierByPerkId.get(b.id) || { tier: 1, slot: 0 };
  const categoryDelta = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  if (categoryDelta) return categoryDelta;
  if (aInfo.tier !== bInfo.tier) return aInfo.tier - bInfo.tier;
  if (aInfo.slot !== bInfo.slot) return aInfo.slot - bInfo.slot;
  return a.name.localeCompare(b.name);
}

function isEquippedView() {
  return state.activeCategory === EQUIPPED_VIEW;
}

function renderCategoryTabs() {
  els.categoryTabs.innerHTML = "";
  const tabs = [
    { id: EQUIPPED_VIEW, label: "Equipped", count: selectedPerks().length, accent: "var(--warn)" },
    ...CATEGORY_ORDER.map((category) => ({
      id: category,
      label: category.replace(" Perks", ""),
      count: categoryPoints(category),
      accent: categoryAccent(category),
    })),
  ];

  tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-button";
    button.style.setProperty("--accent", tab.accent);
    button.setAttribute("aria-selected", String(state.activeCategory === tab.id));
    button.innerHTML = `
      <span class="tab-dot"></span>
      <span>${escapeHtml(tab.label)}</span>
      <span class="tab-count">${tab.count}</span>
    `;
    button.addEventListener("click", () => {
      state.activeCategory = tab.id;
      saveState();
      render();
    });
    els.categoryTabs.appendChild(button);
  });
}

function perkMatchesSearch(perk) {
  const query = state.search.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    perk.name,
    perk.category,
    ...(perk.description || []),
    ...(perk.conditions || []),
    ...(perk.synergies || []),
    ...perk.effects.map((effect) => `${effect.stat} ${effect.value} ${effect.unit || ""}`),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function buildIssueMap() {
  const issueByPerk = new Map();
  getIssues().forEach((issue) => {
    if (!issue.perkId) return;
    if (!issueByPerk.has(issue.perkId)) issueByPerk.set(issue.perkId, []);
    issueByPerk.get(issue.perkId).push(issue.text);
  });
  return issueByPerk;
}

function createPerkCard(perk, issueByPerk, locked, replaced) {
  const level = state.levels[perk.id] || 0;
  const previewLevel = Math.max(1, level);
  const card = document.createElement("article");
  const perkIssues = issueByPerk.get(perk.id) || [];
  const lockedBy = locked.get(perk.id);
  const replacedBy = replaced.get(perk.id);
  card.className = [
    "perk-card",
    level > 0 ? "is-selected" : "",
    perkIssues.length ? "is-invalid" : "",
    replacedBy ? "is-replaced" : "",
  ].filter(Boolean).join(" ");
  card.style.setProperty("--accent", categoryAccent(perk.category));
  card.dataset.perkId = perk.id;
  card.dataset.tier = String(perkTier(perk));

  const baseTags = [tierLabel(perk)];
  if (isEquippedView()) baseTags.push(perk.category.replace(" Perks", ""));
  const tags = [...baseTags, ...requirementLabels(perk)].slice(0, 5);
  const effectHtml = perk.effects
    .slice(0, 4)
    .map((effect) => `<li class="${isPenaltyEffect(effect) ? "penalty" : "positive"}">${escapeHtml(formatEffect(effect, previewLevel))}</li>`)
    .join("");
  const metaHtml = tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const note = [
    replacedBy ? `Stats replaced by ${perkById.get(replacedBy)?.name || replacedBy}.` : "",
    lockedBy && lockedBy !== replacedBy ? `Locked by ${perkById.get(lockedBy)?.name || lockedBy}.` : "",
    ...perkIssues,
  ].filter(Boolean)[0] || (perk.conditions?.[0] || perk.description?.[0] || "");

  const canDecrease = level > 0 && !lockedBy;
  const fitsPointLimit = !hasPointLimit() || totalSpent(state.levels) + nextLevelCost(level) <= state.pointLimit;
  const canIncrease = level < 3 && !lockedBy && fitsPointLimit && canApplyLevel(perk.id, level + 1);
  const iconSrc = perk.icon || perk.image.replace(/^perks\//, "icons/");

  card.innerHTML = `
    <button class="thumb-button" type="button" aria-label="View ${escapeHtml(perk.name)} card">
      <img src="${escapeHtml(iconSrc)}" alt="${escapeHtml(perk.name)} icon">
    </button>
    <div class="perk-body">
      <div class="perk-title-row">
        <h3>${escapeHtml(perk.name)}</h3>
        <span class="level-pill">Lv ${level}</span>
      </div>
      <ul class="effect-list">${effectHtml}</ul>
      <div class="perk-meta">${metaHtml}</div>
      <div class="card-note">${escapeHtml(note)}</div>
      <div class="perk-actions">
        <button class="level-button decrease" type="button" ${canDecrease ? "" : "disabled"}>-</button>
        <button class="level-button increase" type="button" ${canIncrease ? "" : "disabled"}>+</button>
        <button class="level-button max" type="button" ${level >= 3 || lockedBy ? "disabled" : ""}>Max</button>
        <button class="image-button" type="button">Card</button>
      </div>
    </div>
  `;

  card.querySelector(".thumb-button").addEventListener("click", () => showImage(perk.image));
  card.querySelector(".image-button").addEventListener("click", () => showImage(perk.image));
  card.querySelector(".decrease").addEventListener("click", () => setPerkLevel(perk.id, level - 1));
  card.querySelector(".increase").addEventListener("click", () => setPerkLevel(perk.id, level + 1));
  card.querySelector(".max").addEventListener("click", () => {
    let next = level;
    while (next < 3) {
      const candidateLevels = { ...state.levels, [perk.id]: next + 1 };
      if (hasPointLimit() && totalSpent(candidateLevels) > state.pointLimit) break;
      if (!canApplyLevel(perk.id, next + 1)) break;
      next += 1;
    }
    setPerkLevel(perk.id, next);
  });

  return card;
}

function appendPerkSection(title, detail, perks, context) {
  const section = document.createElement("section");
  section.className = "tier-section";
  section.innerHTML = `
    <div class="tier-head">
      <h3>${escapeHtml(title)}</h3>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;

  if (!perks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No matching perks in this tier.";
    section.appendChild(empty);
    els.perkGrid.appendChild(section);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "tier-grid";
  perks.forEach((perk) => grid.appendChild(createPerkCard(perk, context.issueByPerk, context.locked, context.replaced)));
  section.appendChild(grid);
  els.perkGrid.appendChild(section);
}

function renderEquippedPerks(context) {
  const visible = selectedPerks().filter(perkMatchesSearch).sort(perkBoardSort);
  els.visibleCount.textContent = `${visible.length} equipped`;

  if (!visible.length) {
    els.perkGrid.innerHTML = `<div class="empty-state">No equipped perks match that filter.</div>`;
    return;
  }

  CATEGORY_ORDER.forEach((category) => {
    const perks = visible.filter((perk) => perk.category === category);
    if (!perks.length) return;
    const points = categoryPoints(category);
    appendPerkSection(category.replace(" Perks", ""), `${perks.length} perks / ${points} pts`, perks, context);
  });
}

function renderCategoryPerks(context) {
  let shown = 0;
  const tiers = PERK_TIERS[state.activeCategory] || [];
  tiers.forEach((ids, index) => {
    const perks = ids
      .map((id) => perkById.get(id))
      .filter((perk) => perk && perk.category === state.activeCategory && perkMatchesSearch(perk))
      .sort(perkBoardSort);
    shown += perks.length;
    appendPerkSection(`Tier ${index + 1}`, `${perks.length} shown`, perks, context);
  });

  els.visibleCount.textContent = `${shown} shown / ${TIER_COUNT} tiers`;

  if (!shown && !tiers.length) {
    els.perkGrid.innerHTML = `<div class="empty-state">No perks match that filter.</div>`;
  }
}

function renderPerks() {
  const equipped = isEquippedView();
  els.boardFrame.classList.toggle("is-hidden", equipped);
  if (equipped) {
    els.boardImage.removeAttribute("src");
    els.categoryEyebrow.textContent = "Current build";
    els.categoryTitle.textContent = "Equipped Perks";
  } else {
    els.boardImage.src = BOARD_IMAGES[state.activeCategory];
    els.boardImage.alt = `${state.activeCategory} board`;
    els.categoryEyebrow.textContent = "Category";
    els.categoryTitle.textContent = state.activeCategory;
  }
  els.perkGrid.innerHTML = "";

  const context = {
    issueByPerk: buildIssueMap(),
    replaced: replacementMap(),
    locked: lockMap(),
  };

  if (equipped) renderEquippedPerks(context);
  else renderCategoryPerks(context);
}

function renderPointSummary() {
  const spent = totalSpent();
  const limit = state.pointLimit;
  const rows = [
    `
      <div class="category-row">
        <span>Points required</span>
        <strong>${spent}</strong>
      </div>
    `,
    `
      <div class="category-row">
        <span>Available points</span>
        <strong>${hasPointLimit(limit) ? limit : "Unlimited"}</strong>
      </div>
    `,
  ];

  if (hasPointLimit(limit)) {
    const remaining = limit - spent;
    rows.push(`
      <div class="category-row ${remaining < 0 ? "is-over" : ""}">
        <span>${remaining < 0 ? "Over by" : "Remaining"}</span>
        <strong>${Math.abs(remaining)}</strong>
      </div>
    `);
  }

  rows.push(`<div class="stat-group-title">By Category</div>`);
  CATEGORY_ORDER.forEach((category) => {
    rows.push(`
      <div class="category-row">
        <span>${escapeHtml(category.replace(" Perks", ""))}</span>
        <strong>${categoryPoints(category)}</strong>
      </div>
    `);
  });

  els.categoryBreakdown.innerHTML = rows.join("");
}

function renderStats() {
  const groups = aggregateStats();
  const order = ["Combat", "Survival", "Mobility", "Economy", "Support & Utility", "Conditional / Situational", "Perk Interactions", "Penalties"];
  const parts = [];
  order.forEach((group) => {
    const bucket = groups.get(group);
    if (!bucket || bucket.size === 0) return;
    parts.push(`<div class="stat-group-title">${escapeHtml(group)}</div>`);
    [...bucket.values()]
      .sort((a, b) => a.stat.localeCompare(b.stat))
      .forEach((item) => {
        parts.push(`
          <div class="stat-row">
            <span>${escapeHtml(item.stat)}</span>
            <strong>${escapeHtml(renderAggregatedValue(item))}</strong>
          </div>
        `);
      });
  });
  els.statSummary.innerHTML = parts.join("") || `<div class="empty-state">No selected perks yet.</div>`;
}

function renderRules() {
  const issues = getIssues();
  const lines = [];
  issues.forEach((issue) => lines.push(`<div class="penalty-text">${escapeHtml(issue.text)}</div>`));

  activePerks().forEach((perk) => {
    (perk.conditions || []).forEach((condition) => lines.push(`<div>${escapeHtml(perk.name)}: ${escapeHtml(condition)}</div>`));
    (perk.synergies || []).forEach((synergy) => lines.push(`<div>${escapeHtml(perk.name)}: ${escapeHtml(synergy)}</div>`));
    (perk.replaces || []).forEach((id) => lines.push(`<div>${escapeHtml(perk.name)} replaces ${escapeHtml(perkById.get(id)?.name || id)} modifiers.</div>`));
  });

  els.ruleSummary.innerHTML = lines.join("") || `<div class="empty-state">No rule conflicts or situational effects selected.</div>`;
}

function showImage(src) {
  els.dialogImage.src = src;
  if (typeof els.imageDialog.showModal === "function") {
    els.imageDialog.showModal();
  }
}

function saveState() {
  const snapshot = {
    activeCategory: state.activeCategory,
    levels: state.levels,
    pointLimit: state.pointLimit,
    includeConditional: state.includeConditional,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.activeCategory && [EQUIPPED_VIEW, ...CATEGORY_ORDER].includes(saved.activeCategory)) state.activeCategory = saved.activeCategory;
    if (saved.levels && typeof saved.levels === "object") state.levels = saved.levels;
    if (saved.pointLimit === null || Number.isFinite(saved.pointLimit)) state.pointLimit = saved.pointLimit;
    if (typeof saved.includeConditional === "boolean") state.includeConditional = saved.includeConditional;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function render() {
  els.pointLimitInput.value = hasPointLimit() ? state.pointLimit : "";
  els.conditionalToggle.checked = state.includeConditional;
  renderCategoryTabs();
  renderPerks();
  renderPointSummary();
  renderStats();
  renderRules();
}

els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderPerks();
});

els.pointLimitInput.addEventListener("input", (event) => {
  state.pointLimit = parsePointLimit(event.target.value);
  saveState();
  render();
});

els.conditionalToggle.addEventListener("change", (event) => {
  state.includeConditional = event.target.checked;
  saveState();
  renderStats();
});

els.resetButton.addEventListener("click", () => {
  state.levels = {};
  saveState();
  render();
});

els.closeImageDialog.addEventListener("click", () => els.imageDialog.close());

loadState();
render();
