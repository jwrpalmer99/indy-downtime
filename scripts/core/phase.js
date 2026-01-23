import { DEFAULT_PHASE_CONFIG } from "../constants.js";
import { parseList } from "./parse.js";
import { getSkillLabel, clampNumber } from "./labels.js";
import { getCurrentTracker, getTrackerById } from "./tracker.js";

const DEFAULT_CHECK_TARGET = 1;
const DEFAULT_CHECK_DC = 13;
const DEPENDENCY_TYPES = new Set([
  "block",
  "harder",
  "advantage",
  "disadvantage",
  "override",
]);

function getPhaseConfig(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  const stored = tracker?.phaseConfig;
  if (!Array.isArray(stored) || !stored.length) {
    return normalizePhaseConfig(DEFAULT_PHASE_CONFIG);
  }
  return normalizePhaseConfig(stored);
}

function normalizePhaseConfig(config) {
  const normalizePhaseEntry = (entry, fallback) => {
    const merged = foundry.utils.mergeObject(fallback, entry ?? {}, {
      inplace: false,
      overwrite: true,
    });
    merged.image = typeof merged.image === "string" ? merged.image : "";
    merged.allowCriticalBonus = Boolean(merged.allowCriticalBonus);
    merged.failureEvents = Boolean(merged.failureEvents);
    merged.failureEventTable =
      typeof merged.failureEventTable === "string"
        ? merged.failureEventTable
        : fallback.failureEventTable ?? "";

    merged.groups = normalizePhaseGroups(merged, fallback);
    merged.successLines = normalizePhaseLines(
      merged.successLines ?? fallback.successLines
    );
    merged.failureLines = normalizePhaseLines(
      merged.failureLines ?? fallback.failureLines
    );

    const totalTarget = getPhaseTotalTarget(merged);
    const target = Number(merged.target);
    merged.target = Number.isFinite(target) && target > 0
      ? Math.min(target, totalTarget)
      : totalTarget;

    return merged;
  };

  if (!Array.isArray(config) || !config.length) {
    return DEFAULT_PHASE_CONFIG.map((phase) =>
      normalizePhaseEntry(phase, phase)
    );
  }

  const output = [];
  const existingIds = new Set();
  for (const entry of config) {
    if (!entry || typeof entry !== "object") continue;
    const id =
      typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : "";
    const fallback =
      DEFAULT_PHASE_CONFIG.find((phase) => phase.id === id) ??
      DEFAULT_PHASE_CONFIG[1] ??
      DEFAULT_PHASE_CONFIG[0];
    const merged = normalizePhaseEntry(entry, fallback);
    merged.id = id || merged.id || `phase${output.length + 1}`;
    existingIds.add(merged.id);
    output.push(merged);
  }

  if (!existingIds.has("phase1")) {
    output.unshift(foundry.utils.deepClone(DEFAULT_PHASE_CONFIG[0]));
  }
  return output;
}

function parsePhaseConfig(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      ui.notifications.error(
        "Indy Downtime Tracker: phase configuration must be a JSON array."
      );
      return null;
    }
    return normalizePhaseConfig(parsed);
  } catch (error) {
    console.error(error);
    ui.notifications.error(
      "Indy Downtime Tracker: phase configuration JSON is invalid."
    );
    return null;
  }
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
    return {
      id,
      name,
      checks,
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
      target,
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
      const id = entry.trim();
      if (!id) continue;
      output.push({ id, type: "block" });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) continue;
    const type = DEPENDENCY_TYPES.has(entry.type) ? entry.type : "block";
    const dcPenaltyRaw = Number(entry.dcPenalty ?? entry.penalty ?? entry.dcDelta ?? 0);
    const dcPenalty = Number.isFinite(dcPenaltyRaw) ? dcPenaltyRaw : 0;
    const overrideSkill =
      typeof entry.overrideSkill === "string" ? entry.overrideSkill.trim() : "";
    const overrideDcRaw = Number(entry.overrideDc);
    const overrideDc = Number.isFinite(overrideDcRaw) ? overrideDcRaw : null;
    output.push({
      id,
      type,
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
  const definition = getPhaseDefinition(state.activePhaseId, trackerId) ?? {
    ...DEFAULT_PHASE_CONFIG[0],
  };
  const phaseState = state.phases[definition.id] ?? {
    progress: 0,
    completed: false,
    failuresInRow: 0,
    checkProgress: {},
  };
  const merged = {
    ...definition,
    ...phaseState,
  };
  merged.checkProgress = buildCheckProgressMap(merged, phaseState.checkProgress);
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
  return DEFAULT_PHASE_CONFIG[0]?.groups?.[0]?.checks?.map((check) => check.skill).filter(Boolean) ?? ["insight", "persuasion", "religion"];
}

function getPhaseGroups(phase) {
  return Array.isArray(phase?.groups) ? phase.groups : [];
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
  const group = getPhaseGroups(phase).find((entry) => entry.id === groupId);
  if (!group) return false;
  return (group.checks ?? []).every((check) => isCheckComplete(check, checkProgress));
}

function isDependencyComplete(phase, depId, checkProgress) {
  if (!depId) return true;
  const depCheck = getPhaseCheckById(phase, depId);
  if (!depCheck) return true;
  const target = getPhaseCheckTarget(depCheck);
  const current = Number(checkProgress?.[depId] ?? 0);
  return current >= target;
}

function getCheckDependencyEffects(phase, check, checkProgress) {
  const deps = getCheckDependencies(check);
  let dcPenalty = 0;
  let advantage = false;
  let disadvantage = false;
  let overrideSkill = "";
  let overrideDc = null;
  for (const dep of deps) {
    const complete = isDependencyComplete(phase, dep.id, checkProgress);
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
          if (Number.isFinite(dep.overrideDc)) overrideDc = dep.overrideDc;
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

function getCheckDependencyDetails(phase, check, checkProgress) {
  const deps = getCheckDependencies(check);
  const details = [];
  for (const dep of deps) {
    const sourceCheck = getPhaseCheckById(phase, dep.id);
    const sourceLabel = getPhaseCheckLabel(sourceCheck) || dep.id;
    const sourceId = dep.id;
    const complete = isDependencyComplete(phase, dep.id, checkProgress);
    if (dep.type === "harder") {
      const penalty = Number.isFinite(dep.dcPenalty) && dep.dcPenalty > 0 ? dep.dcPenalty : 1;
      if (!complete) {
        details.push({ type: "harder", dcPenalty: penalty, source: sourceLabel, sourceId });
      }
      continue;
    }
    if (dep.type === "advantage") {
      if (complete) {
        details.push({ type: "advantage", source: sourceLabel, sourceId });
      }
      continue;
    }
    if (dep.type === "disadvantage") {
      if (!complete) {
        details.push({ type: "disadvantage", source: sourceLabel, sourceId });
      }
      continue;
    }
  }
  return details;
}

function getCheckRollData(phase, check, checkProgress) {
  const effects = getCheckDependencyEffects(phase, check, checkProgress);
  const baseDc = getPhaseDc(phase, check);
  let dc = baseDc;
  if (Number.isFinite(effects.overrideDc)) {
    dc = effects.overrideDc;
  }
  if (effects.dcPenalty) {
    dc += effects.dcPenalty;
  }
  const skill = effects.overrideSkill || check?.skill || "";
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

function isCheckUnlocked(phase, check, checkProgress) {
  const deps = getCheckDependencies(check);
  const blockers = deps.filter((dep) => dep.type === "block");
  if (!blockers.length) return true;
  return blockers.every((dep) => isDependencyComplete(phase, dep.id, checkProgress));
}

function getPhaseDc(phase, checkId) {
  const check = typeof checkId === "object" ? checkId : getPhaseCheckById(phase, checkId);
  if (!check) return DEFAULT_CHECK_DC;
  const dc = Number(check.dc);
  return Number.isFinite(dc) ? dc : DEFAULT_CHECK_DC;
}

function getPhaseCheckChoices(phase, checkProgress) {
  return getPhaseChecks(phase).map((check) => {
    const complete = isCheckComplete(check, checkProgress);
    const unlocked = isCheckUnlocked(phase, check, checkProgress);
    const rollData = getCheckRollData(phase, check, checkProgress);
    const skillLabel = rollData.skill ? getSkillLabel(rollData.skill) : "";
    return {
      key: check.id,
      label: getPhaseCheckLabel(check),
      description: check.description ?? "",
      skill: rollData.skill,
      skillLabel,
      dc: rollData.dc,
      groupId: check.groupId,
      groupName: check.groupName,
      complete,
      locked: !unlocked || complete,
      dependsOn: getCheckDependencies(check).map((dep) => dep.id),
      advantage: rollData.advantage,
      disadvantage: rollData.disadvantage,
    };
  });
}

function getPhaseAvailableChecks(phase, checkProgress) {
  return getPhaseChecks(phase).filter((check) => {
    if (isCheckComplete(check, checkProgress)) return false;
    return isCheckUnlocked(phase, check, checkProgress);
  });
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
  parsePhaseConfig,
  buildEmptyPhase1,
  buildNewPhase,
  getActivePhase,
  getPhaseDefinition,
  initializePhaseState,
  getPhaseNumber,
  normalizeCheckDependencies,
  getCheckDependencies,
  getCheckRollData,
  getCheckDependencyDetails,
  getFirstPhaseId,
  getDefaultSkills,
  getPhaseGroups,
  getPhaseChecks,
  getPhaseCheckById,
  getPhaseCheckLabel,
  getPhaseCheckTarget,
  getPhaseTotalTarget,
  buildCheckProgressMap,
  getPhaseProgress,
  isCheckComplete,
  isGroupComplete,
  isCheckUnlocked,
  getPhaseDc,
  getPhaseCheckChoices,
  getPhaseAvailableChecks,
  pickLineForCheck,
  pickLineForGroup,
  isPhaseComplete,
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
    groups: [],
    successLines: [],
    failureLines: [],
  };
}

function buildNewPhase(baseIndex) {
  const template = DEFAULT_PHASE_CONFIG[1] ?? DEFAULT_PHASE_CONFIG[0];
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
      groups: [],
      successLines: [],
      failureLines: [],
    },
    { inplace: false, overwrite: true }
  );
}