import { DEFAULT_PHASE_CONFIG } from "../constants.js";
import { parseList } from "./parse.js";
import { getSkillLabel, clampNumber, getCheckRollMode, normalizeNarrativeOutcome } from "./labels.js";
import { getCurrentTracker, getTrackerById } from "./tracker.js";

const DEFAULT_CHECK_TARGET = 1;
const DEFAULT_CHECK_DC = 13;
const D100_DIFFICULTY_LEVELS = ["easy", "regular", "hard", "extreme"];
const D100_DIFFICULTY_LABELS = {
  easy: "Easy",
  regular: "Regular",
  hard: "Hard",
  extreme: "Extreme",
};
const D100_DIFFICULTY_ALIASES = {
  difficult: "hard",
  normal: "regular",
};
const DEPENDENCY_TYPES = new Set([
  "block",
  "prevents",
  "harder",
  "advantage",
  "disadvantage",
  "override",
  "triumph",
  "success",
  "failure",
  "despair",
]);
const NARRATIVE_DEPENDENCY_TYPES = new Set(["triumph", "success", "failure", "despair"]);

function normalizeItemRewards(raw) {
  if (!raw) return [];
  let entries = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      entries = parsed;
    } catch (error) {
      return [];
    }
  }
  if (!Array.isArray(entries)) return [];
  const output = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (typeof entry === "string") {
      const uuid = entry.trim();
      if (!uuid) continue;
      output.push({ uuid, qty: 1 });
      continue;
    }
    if (typeof entry !== "object") continue;
    const uuid = String(entry.uuid ?? entry.itemUuid ?? entry.id ?? "").trim();
    if (!uuid) continue;
    const qtyRaw = Number(entry.qty ?? entry.quantity ?? entry.count ?? 1);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;
    output.push({ uuid, qty });
  }
  return output;
}

function normalizeGoldValue(raw) {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getPhaseConfig(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  const stored = tracker?.phaseConfig;
  if (!Array.isArray(stored) || !stored.length) {
    return normalizePhaseConfig(DEFAULT_PHASE_CONFIG);
  }
  return normalizePhaseConfig(stored);
}

function normalizeDifficulty(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) return "regular";
  if (D100_DIFFICULTY_ALIASES[value]) return D100_DIFFICULTY_ALIASES[value];
  if (D100_DIFFICULTY_LEVELS.includes(value)) return value;
  return "regular";
}

function getDifficultyLabel(raw) {
  const normalized = normalizeDifficulty(raw);
  return D100_DIFFICULTY_LABELS[normalized] ?? "Regular";
}

function getDifficultyIndex(raw) {
  const normalized = normalizeDifficulty(raw);
  return D100_DIFFICULTY_LEVELS.indexOf(normalized);
}

function getDifficultyByIndex(index) {
  if (!Number.isFinite(index)) return "regular";
  const clamped = Math.min(
    Math.max(0, Math.round(index)),
    D100_DIFFICULTY_LEVELS.length - 1
  );
  return D100_DIFFICULTY_LEVELS[clamped] ?? "regular";
}

function shiftDifficulty(raw, steps = 0) {
  if (!steps) return normalizeDifficulty(raw);
  const start = getDifficultyIndex(raw);
  const next = Number.isFinite(start) ? start + steps : steps;
  return getDifficultyByIndex(next);
}

function getDifficultyOptions() {
  return D100_DIFFICULTY_LEVELS.map((value) => ({
    value,
    label: getDifficultyLabel(value),
  }));
}

function getDefaultPhaseTemplate(id) {
  if (Array.isArray(DEFAULT_PHASE_CONFIG) && DEFAULT_PHASE_CONFIG.length) {
    if (id) {
      return DEFAULT_PHASE_CONFIG.find((phase) => phase.id === id)
        ?? DEFAULT_PHASE_CONFIG[1]
        ?? DEFAULT_PHASE_CONFIG[0];
    }
    return DEFAULT_PHASE_CONFIG[0];
  }
  return buildEmptyPhase1();
}

function normalizePhaseConfig(config) {
  const normalizePhaseEntry = (entry, fallback) => {
    const base = fallback && typeof fallback === "object" ? fallback : buildEmptyPhase1();
    const merged = foundry.utils.mergeObject(base, entry ?? {}, {
      inplace: false,
      overwrite: true,
    });
    merged.image = typeof merged.image === "string" ? merged.image : "";
    merged.allowCriticalBonus = Boolean(merged.allowCriticalBonus);
    merged.failureEvents = Boolean(merged.failureEvents);
    merged.failureEventTable =
      typeof merged.failureEventTable === "string"
        ? merged.failureEventTable
        : base.failureEventTable ?? "";
    merged.phaseCompleteItems = normalizeItemRewards(
      merged.phaseCompleteItems ?? base.phaseCompleteItems
    );
    merged.phaseCompleteGold = normalizeGoldValue(
      merged.phaseCompleteGold ?? base.phaseCompleteGold
    );
    merged.showRewardsOnSheet = Boolean(merged.showRewardsOnSheet);

    merged.groups = normalizePhaseGroups(merged, base);
    merged.successLines = normalizePhaseLines(
      merged.successLines ?? base.successLines
    );
    merged.failureLines = normalizePhaseLines(
      merged.failureLines ?? base.failureLines
    );

    const totalTarget = getPhaseTotalTarget(merged);
    const target = Number(merged.target);
    merged.target = Number.isFinite(target) && target > 0
      ? Math.min(target, totalTarget)
      : totalTarget;

    return merged;
  };

  if (!Array.isArray(config) || !config.length) {
    if (Array.isArray(DEFAULT_PHASE_CONFIG) && DEFAULT_PHASE_CONFIG.length) {
      return DEFAULT_PHASE_CONFIG.map((phase) =>
        normalizePhaseEntry(phase, phase)
      );
    }
    const fallback = buildEmptyPhase1();
    return [normalizePhaseEntry(fallback, fallback)];
  }

  const output = [];
  const existingIds = new Set();
  for (const entry of config) {
    if (!entry || typeof entry !== "object") continue;
    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : "";
    const fallback = getDefaultPhaseTemplate(id);
    const merged = normalizePhaseEntry(entry, fallback);
    merged.id = id || merged.id || `phase${output.length + 1}`;
    existingIds.add(merged.id);
    output.push(merged);
  }

  if (!existingIds.has("phase1")) {
    const fallback = getDefaultPhaseTemplate("phase1");
    output.unshift(normalizePhaseEntry(fallback, fallback));
  }
  return output;
}

function normalizePhaseGroups(phase, fallback) {
  if (Array.isArray(phase?.groups)) {
    return normalizeGroups(phase.groups);
  }
  const legacy = buildGroupsFromLegacyPhase(phase, fallback);
  return normalizeGroups(legacy);
}

function normalizeGroups(groups) {
  const usedGroupIds = new Set();
  const usedCheckIds = new Set();
  return (groups ?? []).map((group, index) => {
    const id = ensureUniqueId(
      typeof group?.id === "string" ? group.id : `group${index + 1}`,
      usedGroupIds
    );
    const name =
      typeof group?.name === "string" && group.name.trim()
        ? group.name.trim()
        : `Group ${index + 1}`;
    const checks = normalizeChecks(group?.checks ?? [], id, usedCheckIds);
    const maxChecksRaw = Number(group?.maxChecks);
    const maxChecks = Number.isFinite(maxChecksRaw) && maxChecksRaw > 0 ? maxChecksRaw : 0;
    return {
      id,
      name,
      checks,
      maxChecks,
    };
  });
}

function normalizeChecks(checks, groupId, usedCheckIds) {
  return (checks ?? []).map((check, index) => {
    const id = ensureUniqueId(
      typeof check?.id === "string" ? check.id : `${groupId}-check${index + 1}`,
      usedCheckIds
    );
    const name =
      typeof check?.name === "string" && check.name.trim()
        ? check.name.trim()
        : `Check ${index + 1}`;
    const skill =
      typeof check?.skill === "string" && check.skill.trim()
        ? check.skill.trim()
        : "";
    const dc = Number(check?.dc);
    const description =
      typeof check?.description === "string" ? check.description.trim() : "";
    const checkCompleteMacro =
      typeof check?.checkCompleteMacro === "string"
        ? check.checkCompleteMacro.trim()
        : "";
    const checkSuccessItems = normalizeItemRewards(
      check?.checkSuccessItems ?? check?.checkCompleteItems ?? []
    );
    const checkSuccessGold = normalizeGoldValue(
      check?.checkSuccessGold ?? check?.checkCompleteGold ?? 0
    );
    const target = DEFAULT_CHECK_TARGET;
    const dependsOn = normalizeCheckDependencies(
      check?.dependsOn ?? check?.dependsOnChecks ?? ""
    );
    return {
      id,
      name,
      skill,
      description,
      dc: Number.isFinite(dc) ? dc : DEFAULT_CHECK_DC,
      difficulty: normalizeDifficulty(check?.difficulty ?? check?.difficultyLevel ?? ""),
      target,
      completeGroupOnSuccess: Boolean(check?.completeGroupOnSuccess ?? check?.completeGroup ?? false),
      completePhaseOnSuccess: Boolean(check?.completePhaseOnSuccess ?? check?.completePhase ?? false),
      checkCompleteMacro,
      checkSuccessItems,
      checkSuccessGold,
      dependsOn,
      groupId,
      step: Number.isFinite(Number(check?.step)) ? Number(check.step) : null,
    };
  });
}

function normalizeCheckDependencies(raw) {
  let entries = raw;
  if (typeof raw === "string") {
    entries = parseList(raw);
  }
  if (!Array.isArray(entries)) return [];
  const output = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      let id = entry.trim();
      if (!id) continue;
      let kind = "check";
      if (id.startsWith("group:")) {
        kind = "group";
        id = id.slice("group:".length);
      }
      output.push({ id, type: "block", kind });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) continue;
    const type = DEPENDENCY_TYPES.has(entry.type) ? entry.type : "block";
    const kind = entry.kind === "group" || entry.scope === "group" ? "group" : "check";
    const dcPenaltyRaw = Number(entry.dcPenalty ?? entry.penalty ?? entry.dcDelta ?? 0);
    const dcPenalty = Number.isFinite(dcPenaltyRaw) ? dcPenaltyRaw : 0;
    const overrideSkill =
      typeof entry.overrideSkill === "string" ? entry.overrideSkill.trim() : "";
    let overrideDc = null;
    if (typeof entry.overrideDc === "string") {
      const raw = entry.overrideDc.trim();
      if (raw) {
        const numeric = Number(raw);
        overrideDc = Number.isFinite(numeric) ? numeric : normalizeDifficulty(raw);
      }
    } else {
      const overrideDcRaw = Number(entry.overrideDc);
      overrideDc = Number.isFinite(overrideDcRaw) ? overrideDcRaw : null;
    }
    output.push({
      id,
      type,
      kind,
      dcPenalty,
      overrideSkill,
      overrideDc,
    });
  }
  return output;
}

function getCheckDependencies(check) {
  return normalizeCheckDependencies(check?.dependsOn ?? []);
}

function normalizePhaseLines(lines) {
  const usedLineIds = new Set();
  return (lines ?? []).map((line, index) => {
    const id = ensureUniqueId(
      typeof line?.id === "string" ? line.id : `line${index + 1}`,
      usedLineIds
    );
    const text = typeof line?.text === "string" ? line.text.trim() : "";
    const dependsOnChecks = parseList(line?.dependsOnChecks ?? line?.dependsOn ?? "");
    const dependsOnGroups = parseList(line?.dependsOnGroups ?? "");
    return {
      id,
      text,
      dependsOnChecks,
      dependsOnGroups,
    };
  });
}

function buildGroupsFromLegacyPhase(phase, fallback) {
  const skills = Array.isArray(phase?.skills) && phase.skills.length
    ? phase.skills
    : Array.isArray(fallback?.skills) && fallback.skills.length
      ? fallback.skills
      : getDefaultSkills();
  const checks = [];
  const successLines = [];
  for (const skill of skills) {
    const label = getSkillLabel(skill);
    const steps = phase?.skillDcSteps?.[skill] ?? fallback?.skillDcSteps?.[skill];
    const targetValue = Number(phase?.skillTargets?.[skill] ?? fallback?.skillTargets?.[skill] ?? 1);
    const stepCount = Array.isArray(steps) && steps.length ? steps.length : 0;
    if (stepCount) {
      for (let step = 1; step <= stepCount; step += 1) {
        const dcValue = Number(steps[step - 1] ?? steps[steps.length - 1] ?? DEFAULT_CHECK_DC);
        const narrative = phase?.skillNarratives?.[skill]?.[step] ?? null;
        const name = narrative?.title || `${label} ${step}`;
        const id = `${skill}-${step}`;
        const dependsOn = step > 1 ? [{ id: `${skill}-${step - 1}`, type: "block" }] : [];
        checks.push({
          id,
          name,
          skill,
          dc: Number.isFinite(dcValue) ? dcValue : DEFAULT_CHECK_DC,
          target: DEFAULT_CHECK_TARGET,
          dependsOn,
          step,
        });
        if (narrative?.text) {
          successLines.push({
            id: `success-${id}`,
            text: narrative.title ? `${narrative.title}: ${narrative.text}` : narrative.text,
            dependsOnChecks: [id],
            dependsOnGroups: [],
          });
        }
      }
    } else {
      const dcValue = Number(phase?.skillDcs?.[skill] ?? fallback?.skillDcs?.[skill] ?? DEFAULT_CHECK_DC);
      const target = Number.isFinite(targetValue) && targetValue > 0 ? targetValue : DEFAULT_CHECK_TARGET;
      checks.push({
        id: skill,
        name: label,
        skill,
        dc: Number.isFinite(dcValue) ? dcValue : DEFAULT_CHECK_DC,
        target,
        dependsOn: [],
        step: null,
      });
    }
  }

  const group = {
    id: "group1",
    name: "Checks",
    checks,
  };

  if (Array.isArray(phase?.progressNarrative)) {
    for (const item of phase.progressNarrative) {
      if (item?.text) {
        successLines.push({
          id: `success-${successLines.length + 1}`,
          text: item.text,
          dependsOnChecks: [],
          dependsOnGroups: [],
        });
      }
    }
  } else if (phase?.progressNarrative && typeof phase.progressNarrative === "object") {
    for (const entry of Object.values(phase.progressNarrative)) {
      if (entry?.text) {
        successLines.push({
          id: `success-${successLines.length + 1}`,
          text: entry.text,
          dependsOnChecks: [],
          dependsOnGroups: [],
        });
      }
    }
  }

  if (!Array.isArray(phase?.successLines) && successLines.length) {
    phase.successLines = successLines;
  }

  if (!Array.isArray(phase?.failureLines) && Array.isArray(phase?.failureLines)) {
    phase.failureLines = phase.failureLines.map((text, index) => ({
      id: `failure-${index + 1}`,
      text,
      dependsOnChecks: [],
      dependsOnGroups: [],
    }));
  }

  if (Array.isArray(phase?.failureLines) && phase.failureLines.length && typeof phase.failureLines[0] === "string") {
    phase.failureLines = phase.failureLines.map((text, index) => ({
      id: `failure-${index + 1}`,
      text,
      dependsOnChecks: [],
      dependsOnGroups: [],
    }));
  }

  return [group];
}

function ensureUniqueId(raw, used) {
  let id = String(raw ?? "").trim() || "id";
  let suffix = 1;
  while (used.has(id)) {
    suffix += 1;
    id = `${id}-${suffix}`;
  }
  used.add(id);
  return id;
}

function getActivePhase(state, trackerId) {
  const fallback = DEFAULT_PHASE_CONFIG[0]
    ? foundry.utils.deepClone(DEFAULT_PHASE_CONFIG[0])
    : buildEmptyPhase1();
  const definition = getPhaseDefinition(state.activePhaseId, trackerId) ?? fallback;
  const phaseState = state.phases[definition.id] ?? {
    progress: 0,
    completed: false,
    failuresInRow: 0,
    checkProgress: {},
    resolvedChecks: {},
  };
  const merged = {
    ...definition,
    ...phaseState,
  };
  merged.checkProgress = buildCheckProgressMap(merged, phaseState.checkProgress);
  merged.resolvedChecks =
    phaseState.resolvedChecks && typeof phaseState.resolvedChecks === "object"
      ? phaseState.resolvedChecks
      : {};
  merged.progress = getPhaseProgress(merged, merged.checkProgress);
  merged.completed = isPhaseComplete({ ...merged });
  return merged;
}

function getPhaseDefinition(phaseId, trackerId) {
  return getPhaseConfig(trackerId).find((phase) => phase.id === phaseId);
}

function initializePhaseState(state, phase) {
  if (!state?.phases || !phase) return;
  state.phases[phase.id] = {
    progress: 0,
    completed: false,
    failuresInRow: 0,
    checkProgress: buildCheckProgressMap(phase, {}),
    resolvedChecks: {},
  };
}

function getPhaseNumber(phaseId, trackerId) {
  const config = getPhaseConfig(trackerId);
  const index = config.findIndex((phase) => phase.id === phaseId);
  return index >= 0 ? index + 1 : 1;
}

function getFirstPhaseId(trackerId, phaseConfig) {
  const config = Array.isArray(phaseConfig)
    ? phaseConfig
    : getPhaseConfig(trackerId);
  return config[0]?.id ?? "phase1";
}

function getDefaultSkills() {
  const skills = DEFAULT_PHASE_CONFIG[0]?.groups?.[0]?.checks
    ?.map((check) => check.skill)
    .filter(Boolean);
  return Array.isArray(skills) ? skills : [];
}

function getPhaseGroups(phase) {
  return Array.isArray(phase?.groups) ? phase.groups : [];
}

function resolveGroupByIdOrName(phase, groupIdOrName) {
  if (!phase || !groupIdOrName) return null;
  const groups = getPhaseGroups(phase);
  const direct = groups.find((entry) => entry.id === groupIdOrName);
  if (direct) return direct;
  const normalized =
    typeof groupIdOrName === "string" ? groupIdOrName.trim().toLowerCase() : "";
  if (!normalized) return null;
  return (
    groups.find(
      (entry) =>
        typeof entry?.name === "string" &&
        entry.name.trim().toLowerCase() === normalized
    ) ?? null
  );
}

function getPhaseChecks(phase) {
  const groups = getPhaseGroups(phase);
  const output = [];
  for (const group of groups) {
    for (const check of group.checks ?? []) {
      output.push({ ...check, groupId: group.id, groupName: group.name });
    }
  }
  return output;
}

function getPhaseCheckById(phase, checkId) {
  return getPhaseChecks(phase).find((check) => check.id === checkId) ?? null;
}

function getPhaseCheckLabel(check) {
  if (!check) return "";
  if (check.name) return check.name;
  const key = check.skill;
  if (!key) return "";
  return getSkillLabel(key);
}

function getPhaseCheckTarget() {
  return DEFAULT_CHECK_TARGET;
}

function getPhaseTotalTarget(phase) {
  return getPhaseChecks(phase).reduce(
    (total, check) => total + getPhaseCheckTarget(check),
    0
  );
}

function buildCheckProgressMap(phase, stored) {
  const progress = {};
  const checks = getPhaseChecks(phase);
  for (const check of checks) {
    const target = getPhaseCheckTarget(check);
    const current = Number(stored?.[check.id] ?? 0);
    progress[check.id] = clampNumber(current, 0, target);
  }
  return progress;
}

function getPhaseProgress(phase, checkProgress) {
  const progressMap = checkProgress ?? buildCheckProgressMap(phase, {});
  return getPhaseChecks(phase).reduce((total, check) => {
    const current = Math.min(progressMap[check.id] ?? 0, getPhaseCheckTarget(check));
    return total + current;
  }, 0);
}

function isCheckComplete(check, checkProgress) {
  const target = getPhaseCheckTarget(check);
  const current = Number(checkProgress?.[check.id] ?? 0);
  return current >= target;
}

function isGroupComplete(phase, groupId, checkProgress) {
  if (!phase || !groupId) return false;
  const group = resolveGroupByIdOrName(phase, groupId);
  if (!group) return false;
  const maxChecks = Number(group.maxChecks ?? 0);
  const completed = (group.checks ?? []).reduce(
    (total, check) => total + (isCheckComplete(check, checkProgress) ? 1 : 0),
    0
  );
  if (Number.isFinite(maxChecks) && maxChecks > 0) {
    return completed >= maxChecks;
  }
  return (group.checks ?? []).every((check) => isCheckComplete(check, checkProgress));
}

function isDependencyComplete(phase, dep, checkProgress, resolvedChecks = {}) {
  if (!dep) return true;
  const depId = typeof dep === "string" ? dep : dep.id;
  if (!depId) return true;
  const depType = dep?.type ?? "block";
  const kind = typeof dep === "object" && dep.kind === "group" ? "group" : "check";
  if (NARRATIVE_DEPENDENCY_TYPES.has(depType)) {
    const normalizedChecks =
      resolvedChecks && typeof resolvedChecks === "object" ? resolvedChecks : {};
    const matchesRequirement = (outcome, requirement) => {
      const normalized = normalizeNarrativeOutcome(outcome);
      if (!normalized) return false;
      if (requirement === "success") return normalized === "success";
      if (requirement === "failure") return normalized === "failure";
      return normalized === requirement;
    };
    if (kind === "group") {
      const group = resolveGroupByIdOrName(phase, depId);
      if (!group) return false;
      return (group.checks ?? []).some((check) =>
        matchesRequirement(normalizedChecks[check.id], depType)
      );
    }
    return matchesRequirement(normalizedChecks[depId], depType);
  }
  if (kind === "group") {
    return isGroupComplete(phase, depId, checkProgress);
  }
  const depCheck = getPhaseCheckById(phase, depId);
  if (!depCheck) {
    const group = resolveGroupByIdOrName(phase, depId);
    return group ? isGroupComplete(phase, depId, checkProgress) : true;
  }
  const target = getPhaseCheckTarget(depCheck);
  const current = Number(checkProgress?.[depId] ?? 0);
  return current >= target;
}

function getCheckDependencyEffects(phase, check, checkProgress, resolvedChecks = {}) {
  const deps = getCheckDependencies(check);
  let dcPenalty = 0;
  let advantage = false;
  let disadvantage = false;
  let overrideSkill = "";
  let overrideDc = null;
  for (const dep of deps) {
    const complete = isDependencyComplete(phase, dep, checkProgress, resolvedChecks);
    switch (dep.type) {
      case "harder": {
        const penalty = Number.isFinite(dep.dcPenalty) && dep.dcPenalty > 0 ? dep.dcPenalty : 1;
        if (!complete) dcPenalty += penalty;
        break;
      }
      case "advantage":
        if (complete) advantage = true;
        break;
      case "disadvantage":
        if (!complete) disadvantage = true;
        break;
      case "override":
        if (complete) {
          if (dep.overrideSkill) overrideSkill = dep.overrideSkill;
          if (typeof dep.overrideDc !== "undefined" && dep.overrideDc !== null) {
            overrideDc = dep.overrideDc;
          }
        }
        break;
      case "block":
      default:
        break;
    }
  }
  if (advantage && disadvantage) {
    advantage = false;
    disadvantage = false;
  }
  return {
    dcPenalty,
    advantage,
    disadvantage,
    overrideSkill,
    overrideDc,
  };
}

function getCheckDependencyDetails(phase, check, checkProgress, resolvedChecks = {}) {
  const deps = getCheckDependencies(check);
  const details = [];
  for (const dep of deps) {
    const sourceCheck = dep.kind === "group" ? null : getPhaseCheckById(phase, dep.id);
    const sourceGroup =
      dep.kind === "group"
        ? resolveGroupByIdOrName(phase, dep.id)
        : resolveGroupByIdOrName(phase, dep.id);
    const sourceLabel =
      dep.kind === "group"
        ? (sourceGroup?.name || dep.id)
        : (getPhaseCheckLabel(sourceCheck) || sourceGroup?.name || dep.id);
    const sourceId = dep.id;
    const complete = isDependencyComplete(phase, dep, checkProgress, resolvedChecks);
    if (dep.type === "harder") {
      const penalty = Number.isFinite(dep.dcPenalty) && dep.dcPenalty > 0 ? dep.dcPenalty : 1;
      if (!complete) {
        details.push({ type: "harder", dcPenalty: penalty, source: sourceLabel, sourceId, sourceKind: dep.kind, complete });
      }
      continue;
    }
    if (NARRATIVE_DEPENDENCY_TYPES.has(dep.type)) {
      if (!complete) {
        details.push({ type: dep.type, source: sourceLabel, sourceId, sourceKind: dep.kind, complete });
      }
      continue;
    }
    if (dep.type === "advantage") {
      if (complete) {
        details.push({ type: "advantage", source: sourceLabel, sourceId, sourceKind: dep.kind, complete });
      }
      continue;
    }
    if (dep.type === "disadvantage") {
      if (!complete) {
        details.push({ type: "disadvantage", source: sourceLabel, sourceId, sourceKind: dep.kind, complete });
      }
      continue;
    }
  }
  return details;
}

function getCheckRollData(phase, check, checkProgress, resolvedChecks = {}, trackerId = null) {
  const effects = getCheckDependencyEffects(phase, check, checkProgress, resolvedChecks);
  const skill = effects.overrideSkill || check?.skill || "";
  const rollMode = getCheckRollMode(trackerId);
  if (rollMode === "d100" || rollMode === "narrative") {
    let difficulty = normalizeDifficulty(check?.difficulty ?? "");
    if (typeof effects.overrideDc === "string") {
      difficulty = normalizeDifficulty(effects.overrideDc);
    }
    const penaltySteps = Number.isFinite(effects.dcPenalty)
      ? Math.max(0, Math.round(effects.dcPenalty))
      : 0;
    if (penaltySteps) {
      difficulty = shiftDifficulty(difficulty, penaltySteps);
    }
    return {
      skill,
      difficulty,
      difficultyLabel: getDifficultyLabel(difficulty),
      advantage: effects.advantage,
      disadvantage: effects.disadvantage,
      dcPenalty: effects.dcPenalty,
      overrideSkill: effects.overrideSkill,
      overrideDc: effects.overrideDc,
    };
  }
  const baseDc = getPhaseDc(phase, check);
  let dc = baseDc;
  if (Number.isFinite(effects.overrideDc)) {
    dc = effects.overrideDc;
  }
  if (effects.dcPenalty) {
    dc += effects.dcPenalty;
  }
  return {
    skill,
    dc,
    advantage: effects.advantage,
    disadvantage: effects.disadvantage,
    dcPenalty: effects.dcPenalty,
    overrideSkill: effects.overrideSkill,
    overrideDc: effects.overrideDc,
  };
}

function isCheckUnlocked(phase, check, checkProgress, resolvedChecks = {}) {
  if (resolvedChecks && resolvedChecks[check?.id]) return false;
  const deps = getCheckDependencies(check);
  const blockers = deps.filter((dep) => dep.type === "block");
  if (blockers.length && !blockers.every((dep) => isDependencyComplete(phase, dep, checkProgress, resolvedChecks))) {
    return false;
  }
  const narrativeDeps = deps.filter((dep) => NARRATIVE_DEPENDENCY_TYPES.has(dep.type));
  if (narrativeDeps.length && !narrativeDeps.some((dep) =>
    isDependencyComplete(phase, dep, checkProgress, resolvedChecks)
  )) {
    return false;
  }
  const lockouts = deps.filter((dep) => dep.type === "prevents");
  if (lockouts.some((dep) => isDependencyComplete(phase, dep, checkProgress, resolvedChecks))) {
    return false;
  }
  return true;
}

function getPhaseDc(phase, checkId) {
  const check = typeof checkId === "object" ? checkId : getPhaseCheckById(phase, checkId);
  if (!check) return DEFAULT_CHECK_DC;
  const dc = Number(check.dc);
  return Number.isFinite(dc) ? dc : DEFAULT_CHECK_DC;
}

function getPhaseCheckChoices(phase, checkProgress, options = {}) {
  const groupCounts = options.groupCounts ?? {};
  const resolvedChecks = options.resolvedChecks ?? {};
  const trackerId = options.trackerId ?? null;
  const rollMode = getCheckRollMode(trackerId);
  const isDifficultyMode = rollMode === "d100" || rollMode === "narrative";
  return getPhaseChecks(phase).map((check) => {
    const complete = isCheckComplete(check, checkProgress);
    const unlocked = isCheckUnlocked(phase, check, checkProgress, resolvedChecks);
    const group = getPhaseGroups(phase).find((entry) => entry.id === check.groupId);
    const groupLimit = Number(group?.maxChecks ?? 0);
    const groupUsed = Number(groupCounts?.[check.groupId] ?? 0);
    const groupAvailable = !groupLimit || groupUsed < groupLimit;
    const rollData = getCheckRollData(phase, check, checkProgress, resolvedChecks, trackerId);
    const skillLabel = rollData.skill ? getSkillLabel(rollData.skill) : "";
    const difficultyLabel = isDifficultyMode ? getDifficultyLabel(rollData.difficulty) : "";
    const dcLabel = isDifficultyMode
      ? difficultyLabel
      : (Number.isFinite(rollData.dc) ? `DC ${rollData.dc}` : "");
    return {
      key: check.id,
      label: getPhaseCheckLabel(check),
      description: check.description ?? "",
      skill: rollData.skill,
      skillLabel,
      dc: rollData.dc,
      dcLabel,
      difficulty: isDifficultyMode ? rollData.difficulty : "",
      difficultyLabel,
      groupId: check.groupId,
      groupName: check.groupName,
      complete,
      locked: !unlocked || complete || !groupAvailable,
      dependsOn: getCheckDependencies(check).map((dep) => dep.id),
      advantage: rollData.advantage,
      disadvantage: rollData.disadvantage,
    };
  });
}

function getPhaseAvailableChecks(phase, checkProgress, resolvedChecks = {}) {
  return getPhaseChecks(phase).filter((check) => {
    if (isCheckComplete(check, checkProgress)) return false;
    return isCheckUnlocked(phase, check, checkProgress, resolvedChecks);
  });
}

function completeGroupProgress(phase, groupId, checkProgress) {
  if (!phase || !groupId) return false;
  const group = resolveGroupByIdOrName(phase, groupId);
  if (!group) return false;
  const progress = checkProgress ?? {};
  let changed = false;
  for (const check of group.checks ?? []) {
    const target = getPhaseCheckTarget(check);
    const current = Number(progress?.[check.id] ?? 0);
    if (current < target) {
      progress[check.id] = target;
      changed = true;
    }
  }
  return changed;
}

function completePhaseProgress(phase, checkProgress) {
  if (!phase) return false;
  const progress = checkProgress ?? {};
  let changed = false;
  for (const check of getPhaseChecks(phase)) {
    const target = getPhaseCheckTarget(check);
    const current = Number(progress?.[check.id] ?? 0);
    if (current < target) {
      progress[check.id] = target;
      changed = true;
    }
  }
  return changed;
}

function pickLineForCheck(lines, checkId, groupId, options = {}) {
  if (!Array.isArray(lines) || !lines.length) return "";
  const allowGroup = options?.allowGroup !== false;
  const checkMatches = lines.filter((line) =>
    line?.text && Array.isArray(line.dependsOnChecks) && line.dependsOnChecks.includes(checkId)
  );
  if (checkMatches.length) {
    return checkMatches[Math.floor(Math.random() * checkMatches.length)].text;
  }
  if (allowGroup) {
    const groupMatches = lines.filter((line) =>
      line?.text &&
      (!line.dependsOnChecks?.length) &&
      Array.isArray(line.dependsOnGroups) &&
      line.dependsOnGroups.includes(groupId)
    );
    if (groupMatches.length) {
      return groupMatches[Math.floor(Math.random() * groupMatches.length)].text;
    }
  }
  const unconstrained = lines.filter((line) =>
    line?.text && (!line.dependsOnChecks?.length && !line.dependsOnGroups?.length)
  );
  if (!unconstrained.length) return "";
  return unconstrained[Math.floor(Math.random() * unconstrained.length)].text;
}

function pickLineForGroup(lines, groupId) {
  if (!Array.isArray(lines) || !lines.length) return "";
  const groupMatches = lines.filter((line) =>
    line?.text &&
    Array.isArray(line.dependsOnGroups) &&
    line.dependsOnGroups.includes(groupId)
  );
  if (!groupMatches.length) return "";
  return groupMatches[Math.floor(Math.random() * groupMatches.length)].text;
}

function isPhaseComplete(phase) {
  if (!phase) return false;
  return Number(phase.progress ?? 0) >= Number(phase.target ?? 0);
}

export {
  getPhaseConfig,
  normalizePhaseConfig,
  buildEmptyPhase1,
  buildNewPhase,
  getActivePhase,
  getPhaseDefinition,
  initializePhaseState,
  getPhaseNumber,
  normalizeCheckDependencies,
  getCheckRollData,
  getCheckDependencyDetails,
  getFirstPhaseId,
  getPhaseGroups,
  getPhaseChecks,
  getPhaseCheckById,
  getPhaseCheckLabel,
  getPhaseCheckTarget,
  buildCheckProgressMap,
  getPhaseProgress,
  isCheckComplete,
  isGroupComplete,
  isCheckUnlocked,
  getPhaseDc,
  getPhaseCheckChoices,
  getPhaseAvailableChecks,
  completeGroupProgress,
  completePhaseProgress,
  pickLineForCheck,
  pickLineForGroup,
  normalizeDifficulty,
  getDifficultyLabel,
  getDifficultyOptions,
  shiftDifficulty,
  isPhaseComplete,
  isDependencyComplete,
  normalizeItemRewards,
  normalizeGoldValue
};

function buildEmptyPhase1() {
  return {
    id: "phase1",
    name: "Phase 1",
    narrativeDuration: "",
    expectedGain: "",
    target: 1,
    allowCriticalBonus: false,
    failureEvents: false,
    failureEventTable: "",
    image: "",
    phaseCompleteMessage: "",
    phaseCompleteMacro: "",
    phaseCompleteItems: [],
    phaseCompleteGold: 0,
    showRewardsOnSheet: true,
    groups: [],
    successLines: [],
    failureLines: [],
  };
}

function buildNewPhase(baseIndex) {
  const template = getDefaultPhaseTemplate();
  const id = `phase${baseIndex}`;
  return foundry.utils.mergeObject(
    template,
    {
      id,
      name: `Phase ${baseIndex}`,
      target: 0,
      allowCriticalBonus: false,
      failureEvents: false,
      failureEventTable: "",
      image: "",
      phaseCompleteItems: [],
      phaseCompleteGold: 0,
      showRewardsOnSheet: true,
      groups: [],
      successLines: [],
      failureLines: [],
    },
    { inplace: false, overwrite: true }
  );
}
