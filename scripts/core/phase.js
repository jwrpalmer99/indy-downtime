import { DEFAULT_PHASE_CONFIG } from "../constants.js";
import {
  parseCheckOrder,
  parseCheckOrderToken,
  parseList,
  parseNumberList,
  parseNarrativeLines,
} from "./parse.js";
import { getSkillAliases, getSkillLabel, resolveSkillKey } from "./labels.js";
import { getCurrentTracker, getTrackerById } from "./tracker.js";

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
    merged.skills =
      Array.isArray(merged.skills) && merged.skills.length
        ? merged.skills
        : fallback.skills ?? getDefaultSkills();
    const perMissing = Number(merged.dcPenaltyPerMissing);
    merged.dcPenaltyPerMissing = Number.isFinite(perMissing)
      ? Math.max(0, perMissing)
      : Number(fallback.dcPenaltyPerMissing ?? 0);
    merged.dcPenaltySkill =
      typeof merged.dcPenaltySkill === "string"
        ? merged.dcPenaltySkill
        : fallback.dcPenaltySkill ?? "insight";
    if (!merged.skills.includes(merged.dcPenaltySkill)) {
      merged.dcPenaltySkill = merged.skills.includes("insight")
        ? "insight"
        : merged.skills[0] ?? "";
    }
    if (merged.id === "phase1") {
      if (merged.allowEmptyPhase) {
        merged.skillTargets = merged.skillTargets ?? {};
        merged.skillDcSteps = merged.skillDcSteps ?? {};
        merged.skillNarratives = merged.skillNarratives ?? {};
        if (!Number.isFinite(merged.target)) {
          merged.target = 0;
        }
      } else {
        merged.skillTargets = normalizeSkillTargets(merged, fallback);
        if (!Number.isFinite(merged.target) || merged.target <= 0) {
          merged.target = getPhaseTotalTarget(merged);
        }
        merged.skillDcSteps = merged.skillDcSteps ?? fallback.skillDcSteps;
        merged.skillNarratives =
          merged.skillNarratives ?? fallback.skillNarratives;
      }
    } else {
      merged.skillDcs = merged.skillDcs ?? fallback.skillDcs;
    }
    merged.failureEventTable =
      typeof merged.failureEventTable === "string"
        ? merged.failureEventTable
        : fallback.failureEventTable ?? "";
    merged.enforceCheckOrder = Boolean(merged.enforceCheckOrder);
    merged.checkOrder = normalizeCheckOrder(merged, merged.checkOrder);
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


function normalizeSkillTargets(phase, fallback) {
  const targets = {};
  const skills = Array.isArray(phase?.skills) && phase.skills.length
    ? phase.skills
    : fallback?.skills ?? getDefaultSkills();
  for (const key of skills) {
    const direct = phase?.skillTargets?.[key];
    const fallbackTarget = fallback?.skillTargets?.[key];
    const legacy = phase?.skillTarget;
    const resolved = Number.isFinite(direct)
      ? direct
      : Number.isFinite(fallbackTarget)
        ? fallbackTarget
        : Number.isFinite(legacy)
          ? legacy
          : 2;
    targets[key] = Math.max(0, resolved);
  }
  return targets;
}


function buildNewPhase(baseIndex) {
  const template =
    DEFAULT_PHASE_CONFIG[1] ?? DEFAULT_PHASE_CONFIG[0];
  const id = `phase${baseIndex}`;
  return foundry.utils.mergeObject(
    template,
    {
      id,
      name: `Phase ${baseIndex}`,
      target: 6,
      failureEvents: false,
      allowCriticalBonus: false,
      image: "",
      failureEventTable: "",
      progressNarrative: {},
      failureLines: ["Momentum slows, but nothing breaks."],
    },
    { inplace: false, overwrite: true }
  );
}


function buildEmptyPhase1() {
  return {
    id: "phase1",
    name: "New Phase",
    narrativeDuration: "",
    expectedGain: "",
    target: 0,
    allowCriticalBonus: false,
    failureEvents: false,
    skills: [],
    skillTargets: {},
    image: "",
    skillDcSteps: {},
    dcPenaltySkill: "",
    dcPenaltyPerMissing: 0,
    failureEventTable: "",
    skillNarratives: {},
    progressNarrative: {},
    failureLines: [],
    allowEmptyPhase: true,
  };
}


function getActivePhase(state, trackerId) {
  const definition = getPhaseDefinition(state.activePhaseId, trackerId) ?? {
    ...DEFAULT_PHASE_CONFIG[0],
  };
  const phaseState = state.phases[definition.id] ?? {
    progress: 0,
    completed: false,
    failuresInRow: 0,
  };
  const merged = {
    ...definition,
    ...phaseState,
  };
  if (definition.id === "phase1") {
    merged.skillProgress = getPhase1SkillProgress(merged);
    merged.progress = getPhase1TotalProgress(merged);
    merged.completed = isPhaseComplete(merged);
  }
  return merged;
}


function getPhaseDefinition(phaseId, trackerId) {
  return getPhaseConfig(trackerId).find((phase) => phase.id === phaseId);
}


function initializePhaseState(state, phase) {
  if (!state?.phases || !phase) return;
  const phaseState = {
    progress: 0,
    completed: false,
    failuresInRow: 0,
  };
  if (phase.id === "phase1") {
    phaseState.skillProgress = buildEmptySkillProgress(phase);
    phaseState.progress = getPhase1TotalProgress({
      ...phase,
      skillProgress: phaseState.skillProgress,
    });
  }
  state.phases[phase.id] = phaseState;
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
  return DEFAULT_PHASE_CONFIG[0]?.skills ?? [];
}


function getPhaseSkillList(phase) {
  if (Array.isArray(phase?.skills) && phase.skills.length) {
    return phase.skills;
  }
  if (phase?.allowEmptyPhase) return [];
  return getDefaultSkills();
}


function getPhaseSkillChoices(phase, skillAliases) {
  const skills = getPhaseSkillList(phase);
  return skills.map((key) => {
    const resolvedKey = resolveSkillKey(key, skillAliases);
    return {
      key,
      label: getSkillLabel(resolvedKey),
    };
  });
}


function buildEmptySkillProgress(phase) {
  const progress = {};
  for (const key of getPhaseSkillList(phase)) {
    progress[key] = 0;
  }
  return progress;
}


function getPhaseSkillTarget(phase, skillChoice) {
  const target = phase?.skillTargets?.[skillChoice];
  if (Number.isFinite(target) && target >= 0) return target;
  const legacy = Number(phase?.skillTarget);
  if (Number.isFinite(legacy) && legacy >= 0) return legacy;
  return 2;
}


function getPhaseTotalTarget(phase) {
  const skills = getPhaseSkillList(phase);
  return skills.reduce(
    (total, key) => total + getPhaseSkillTarget(phase, key),
    0
  );
}


function getForcedSkillChoice(phase) {
  if (!phase) return "";
  const forced = phase.forceSkillAfterFailures ?? "";
  if (!forced) return "";
  if (Number(phase.failuresInRow) >= 2) return forced;
  return "";
}


function hasForcedSkillRule(phase) {
  return Boolean(phase?.forceSkillAfterFailures);
}


function getPhase1SkillProgress(phase) {
  const skills = getPhaseSkillList(phase);
  const progress = {};
  for (const key of skills) {
    progress[key] = Number(phase?.skillProgress?.[key] ?? 0);
  }
  return progress;
}


function getPhase1TotalProgress(phase) {
  const progress = getPhase1SkillProgress(phase);
  return getPhaseSkillList(phase).reduce(
    (total, key) =>
      total + Math.min(progress[key] ?? 0, getPhaseSkillTarget(phase, key)),
    0
  );
}


function buildPhase1SkillData(phase, labels) {
  const progress = getPhase1SkillProgress(phase);
  return getPhaseSkillList(phase).map((key) => {
    const target = getPhaseSkillTarget(phase, key);
    const value = Math.min(progress[key] ?? 0, target);
    const percent = target > 0 ? Math.round((value / target) * 100) : 0;
    return {
      key,
      label: labels[key] ?? key,
      value,
      target,
      percent,
    };
  });
}


function getPhaseDc(phase, skillChoice) {
  if (!phase) return 13;
  const skills = getPhaseSkillList(phase);
  if (!skills.includes(skillChoice)) return 13;
  if (phase.id === "phase1") {
    const progress = getPhase1SkillProgress(phase);
    const target = getPhaseSkillTarget(phase, skillChoice);
    const maxIndex = Math.max(0, target - 1);
    const stepIndex = Math.min(progress[skillChoice] ?? 0, maxIndex);
    const steps = phase.skillDcSteps?.[skillChoice];
    let base = 13;
    if (Array.isArray(steps) && steps.length) {
      base = Number(steps[stepIndex] ?? steps[steps.length - 1] ?? 13);
    }
    const penalty = getPhaseOtherSkillPenalty(phase, skillChoice);
    return base + penalty;
  }
  const dc = phase.skillDcs?.[skillChoice];
  const base = Number.isFinite(dc) ? dc : 15;
  return base + getPhaseOtherSkillPenalty(phase, skillChoice);
}


function getPhase1Narrative(phase, skillChoice, skillProgress) {
  if (!skillProgress || !phase) return null;
  const value = skillProgress[skillChoice];
  return phase.skillNarratives?.[skillChoice]?.[value] ?? null;
}


function getPhase1ContextNote() {
  return "";
}


function getPenaltySkillKey(phase) {
  const skills = getPhaseSkillList(phase);
  if (phase?.dcPenaltySkill && skills.includes(phase.dcPenaltySkill)) {
    return phase.dcPenaltySkill;
  }
  if (skills.includes("insight")) return "insight";
  return skills[0] ?? "";
}


function getPhaseOtherSkillPenalty(phase, skillChoice) {
  if (!phase) return 0;
  const penaltySkill = getPenaltySkillKey(phase);
  if (!penaltySkill || skillChoice === penaltySkill) return 0;
  const perMissing = Number(phase.dcPenaltyPerMissing ?? 0);
  if (!Number.isFinite(perMissing) || perMissing <= 0) return 0;
  const progress =
    phase.id === "phase1" ? getPhase1SkillProgress(phase) : {};
  const target =
    phase.id === "phase1"
      ? getPhaseSkillTarget(phase, penaltySkill)
      : 0;
  const current = Number(progress[penaltySkill] ?? 0);
  return Math.max(0, target - current) * perMissing;
}


function getPhasePenaltyInfo(phase, skillLabels) {
  if (!phase) return "";
  const penaltySkill = getPenaltySkillKey(phase);
  if (!penaltySkill) return "";
  const label = skillLabels?.[penaltySkill] ?? penaltySkill;
  const penalty = getPhaseOtherSkillPenalty(phase, "");
  if (!penalty) return "";
  return `+${penalty} DC to other checks until ${label} reaches its target.`;
}


function getNextSkillTitle(phase, skillChoice, skillLabels) {
  if (!phase || !skillChoice) return "";
  if (phase.id !== "phase1") {
    return skillLabels?.[skillChoice] ?? skillChoice;
  }
  const progress = getPhase1SkillProgress(phase);
  const currentValue = Number(progress[skillChoice] ?? 0);
  const target = getPhaseSkillTarget(phase, skillChoice);
  if (currentValue >= target) {
    return skillLabels?.[skillChoice] ?? skillChoice;
  }
  const narrative =
    phase.skillNarratives?.[skillChoice]?.[currentValue + 1] ?? null;
  return narrative?.title ?? skillLabels?.[skillChoice] ?? skillChoice;
}


function buildDefaultCheckOrder(phase) {
  const skills = getPhaseSkillList(phase);
  if (!skills.length) return [];
  if (phase?.id === "phase1") {
    const order = [];
    for (const key of skills) {
      const target = getPhaseSkillTarget(phase, key);
      for (let step = 1; step <= target; step += 1) {
        order.push(`${key}:${step}`);
      }
    }
    return order;
  }
  return [...skills];
}


function normalizeCheckOrder(phase, order) {
  const skills = getPhaseSkillList(phase);
  if (!skills.length) return [];
  const list = Array.isArray(order) ? order : parseCheckOrder(order);
  if (!list.length) return buildDefaultCheckOrder(phase);

  const output = [];
  const seen = new Set();
  for (const entry of list) {
    const token = parseCheckOrderToken(entry);
    if (!token.skill || !skills.includes(token.skill)) continue;
    if (phase?.id === "phase1") {
      const target = getPhaseSkillTarget(phase, token.skill);
      const step = token.step ?? 0;
      if (step <= 0 || step > target) continue;
      const key = `${token.skill}:${step}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(key);
    } else {
      if (seen.has(token.skill)) continue;
      seen.add(token.skill);
      output.push(token.skill);
    }
  }

  return output.length ? output : buildDefaultCheckOrder(phase);
}


function getCheckOrderLabel(phase, token, skillAliases) {
  const parsed = parseCheckOrderToken(token);
  const skillKey = parsed.skill || token;
  const label = getSkillLabel(resolveSkillKey(skillKey, skillAliases));
  if (phase?.id === "phase1") {
    const step = parsed.step ?? 0;
    const title = phase?.skillNarratives?.[skillKey]?.[step]?.title ?? "";
    return title ? `${label} ${step}: ${title}` : `${label} ${step}`;
  }
  return label;
}


function getNextOrderedSkillChoice(phase) {
  if (!phase?.enforceCheckOrder) return "";
  const order = normalizeCheckOrder(phase, phase.checkOrder);
  if (!order.length) return "";
  if (phase.id !== "phase1") {
    return parseCheckOrderToken(order[0]).skill || order[0];
  }
  const progress = getPhase1SkillProgress(phase);
  for (const entry of order) {
    const token = parseCheckOrderToken(entry);
    if (!token.skill) continue;
    const target = getPhaseSkillTarget(phase, token.skill);
    const current = progress[token.skill] ?? 0;
    const step = token.step ?? 0;
    if (current < target && current < step) {
      return token.skill;
    }
  }
  return "";
}



function isPhaseComplete(phase) {
  if (!phase) return false;
  if (phase.id === "phase1") {
    const progress = getPhase1SkillProgress(phase);
    return getPhaseSkillList(phase).every(
      (key) => (progress[key] ?? 0) >= getPhaseSkillTarget(phase, key)
    );
  }
  return phase.progress >= phase.target;
}

export {
  isPhaseComplete,
  getPhaseConfig,
  normalizePhaseConfig,
  parsePhaseConfig,
  normalizeSkillTargets,
  buildNewPhase,
  buildEmptyPhase1,
  getActivePhase,
  getPhaseDefinition,
  initializePhaseState,
  getPhaseNumber,
  getFirstPhaseId,
  getDefaultSkills,
  getPhaseSkillList,
  getPhaseSkillChoices,
  buildEmptySkillProgress,
  getPhaseSkillTarget,
  getPhaseTotalTarget,
  getForcedSkillChoice,
  hasForcedSkillRule,
  getPhase1SkillProgress,
  getPhase1TotalProgress,
  buildPhase1SkillData,
  getPhaseDc,
  getPhase1Narrative,
  getPhase1ContextNote,
  getPenaltySkillKey,
  getPhaseOtherSkillPenalty,
  getPhasePenaltyInfo,
  getNextSkillTitle,
  buildDefaultCheckOrder,
  normalizeCheckOrder,
  getCheckOrderLabel,
  getNextOrderedSkillChoice,
};
