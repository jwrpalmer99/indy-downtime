import {
  DEFAULT_PHASE_CONFIG,
  DEFAULT_STATE,
  MODULE_ID,
  SOCKET_EVENT_REQUEST,
  SOCKET_EVENT_STATE,
  TRACKERS_SETTING,
} from "../constants.js";
import { clampNumber, debugLog, getSkillAliases, getSkillLabel } from "./labels.js";
import {
  buildEmptySkillProgress,
  getDefaultSkills,
  getFirstPhaseId,
  getPhase1ContextNote,
  getPhase1Narrative,
  getPhase1SkillProgress,
  getPhase1TotalProgress,
  getPhaseConfig,
  getPhaseDc,
  getPhaseDefinition,
  getPhaseNumber,
  getPhaseSkillList,
  getPhaseSkillTarget,
  getPhaseTotalTarget,
  hasForcedSkillRule,
  isPhaseComplete,
} from "./phase.js";
import { resolveSkillKey } from "./labels.js";
import { pickFailureLine } from "./labels.js";
import {
  getCurrentTracker,
  getCurrentTrackerId,
  getTrackerById,
  setTrackerState,
} from "./tracker.js";

function getWorldState(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  const resolvedTrackerId = tracker?.id ?? trackerId;
  return normalizeProjectState(
    tracker?.state ?? DEFAULT_STATE,
    getPhaseConfig(resolvedTrackerId)
  );
}


async function setWorldState(state, trackerId) {
  if (!game.user?.isGM) {
    requestStateUpdate(state, trackerId);
    return;
  }
  const trackerKey = trackerId ?? getCurrentTrackerId();
  setTrackerState(trackerKey, state);
  notifyStateUpdated(trackerKey);
}


function normalizeProjectState(source, phaseConfig) {
  const stored = source ?? {};
  const state = foundry.utils.mergeObject(DEFAULT_STATE, stored, {
    inplace: false,
    overwrite: true,
  });
  if (!Number.isFinite(state.checkCount)) {
    if (Number.isFinite(stored?.windowDaysUsed)) {
      state.checkCount = stored.windowDaysUsed;
    } else if (Number.isFinite(stored?.daysElapsed)) {
      state.checkCount = stored.daysElapsed;
    } else if (Array.isArray(stored?.log) && stored.log.length) {
      const maxLogged = stored.log.reduce((max, entry) => {
        const value = Number(entry?.checkNumber ?? entry?.windowDay ?? 0);
        return Number.isFinite(value) ? Math.max(max, value) : max;
      }, 0);
      state.checkCount = maxLogged;
    } else {
      state.checkCount = 0;
    }
  }
  const resolvedConfig = Array.isArray(phaseConfig)
    ? phaseConfig
    : getPhaseConfig();
  state.phases = state.phases ?? {};
  for (const phase of resolvedConfig) {
    const fallback = { progress: 0, completed: false, failuresInRow: 0 };
    state.phases[phase.id] = foundry.utils.mergeObject(
      fallback,
      state.phases[phase.id] ?? {},
      { inplace: false, overwrite: true }
    );
    if (phase.id === "phase1") {
      const existing = state.phases[phase.id];
      if (!existing.skillProgress) {
        existing.skillProgress = migratePhase1Progress(
          existing.progress ?? 0,
          phase
        );
      }
      existing.progress = getPhase1TotalProgress(existing);
      existing.completed = isPhaseComplete({ ...phase, ...existing });
    } else if (state.phases[phase.id].progress >= phase.target) {
      state.phases[phase.id].completed = true;
    }
  }
  if (!stored?.phases && Number.isFinite(stored?.progress)) {
    const phase1 = state.phases.phase1;
    const phase1Config =
      resolvedConfig.find((phase) => phase.id === "phase1") ??
      DEFAULT_PHASE_CONFIG[0];
    const target = phase1Config?.target ?? 0;
    phase1.progress = target
      ? Math.min(stored.progress, target)
      : stored.progress;
    phase1.completed = Boolean(stored.completed);
    if (target && phase1.progress >= target) {
      phase1.completed = true;
    }
    phase1.skillProgress = migratePhase1Progress(phase1.progress, phase1Config);
  }
  const firstPhaseId = getFirstPhaseId(null, resolvedConfig);
  if (!resolvedConfig.some((phase) => phase.id === state.activePhaseId)) {
    state.activePhaseId = firstPhaseId;
  }
  if (!isPhaseUnlocked(state.activePhaseId, state, null, resolvedConfig)) {
    state.activePhaseId =
      getNextIncompletePhaseId(state, null, resolvedConfig) ?? firstPhaseId;
  }
  return state;
}


function applyStateOverridesFromForm(state, formData, phaseConfig) {
  if (!state || !formData || !Array.isArray(phaseConfig)) return;
  const checkCount = Number(formData.checkCount);
  if (Number.isFinite(checkCount)) {
    state.checkCount = Math.max(0, checkCount);
  }

  for (const phase of phaseConfig) {
    const phaseState = state.phases[phase.id] ?? {
      progress: 0,
      completed: false,
      failuresInRow: 0,
    };
    const failureValue = Number(formData[`${phase.id}FailuresInRow`]);
    if (Number.isFinite(failureValue)) {
      phaseState.failuresInRow = Math.max(0, failureValue);
    }

    if (phase.id === "phase1") {
      const skillProgress = buildEmptySkillProgress(phase);
      for (const key of getPhaseSkillList(phase)) {
        const value = Number(formData[`phase1Skill_${key}`]);
        if (Number.isFinite(value)) {
          const target = getPhaseSkillTarget(phase, key);
          skillProgress[key] = clampNumber(value, 0, target);
        }
      }
      phaseState.skillProgress = skillProgress;
      phaseState.progress = getPhase1TotalProgress({
        ...phase,
        skillProgress,
      });
    } else {
      const progressValue = Number(formData[`${phase.id}Progress`]);
      if (Number.isFinite(progressValue)) {
        phaseState.progress = clampNumber(progressValue, 0, phase.target ?? 0);
      }
    }

    if (formData[`${phase.id}Completed`] !== undefined) {
      phaseState.completed = Boolean(formData[`${phase.id}Completed`]);
    } else {
      phaseState.completed = isPhaseComplete({ ...phase, ...phaseState });
    }

    state.phases[phase.id] = phaseState;
  }
}


function recalculateStateFromLog(state, trackerId) {
  const phaseConfig = getPhaseConfig(trackerId);
  const skillAliases = getSkillAliases();
  const rebuilt = {
    ...state,
    phases: {},
    log: [],
    checkCount: 0,
  };

  for (const phase of phaseConfig) {
    rebuilt.phases[phase.id] = {
      progress: 0,
      completed: false,
      failuresInRow: 0,
      skillProgress: phase.id === "phase1" ? buildEmptySkillProgress(phase) : undefined,
    };
  }

  const sorted = [...(state.log ?? [])].sort(
    (a, b) => getLogSortValue(a) - getLogSortValue(b)
  );
  const rebuiltLog = [];
  for (const entry of sorted) {
    rebuiltLog.push(
      applyLogEntryToState(entry, rebuilt, phaseConfig, skillAliases)
    );
  }

  for (const phase of phaseConfig) {
    const phaseState = rebuilt.phases[phase.id];
    phaseState.completed = isPhaseComplete({ ...phase, ...phaseState });
  }

  rebuilt.log = rebuiltLog.sort(
    (a, b) => getLogSortValue(b) - getLogSortValue(a)
  );
  rebuilt.checkCount = deriveCheckCount(rebuilt.log);
  if (!phaseConfig.some((phase) => phase.id === rebuilt.activePhaseId)) {
    rebuilt.activePhaseId = getFirstPhaseId(null, phaseConfig);
  }
  if (!isPhaseUnlocked(rebuilt.activePhaseId, rebuilt, null, phaseConfig)) {
    rebuilt.activePhaseId =
      getNextIncompletePhaseId(rebuilt, null, phaseConfig) ??
        getFirstPhaseId(null, phaseConfig);
  }
  return rebuilt;
}


function applyLogEntryToState(entry, state, phaseConfig, skillAliases) {
  if (entry?.type === "phase-complete") {
    return entry;
  }
  const phase =
    phaseConfig.find((candidate) => candidate.id === entry.phaseId) ??
    phaseConfig[0];
  const phaseState = state.phases[phase.id];
  const skillChoice = resolveSkillChoice(entry, phase, skillAliases);
  const skillKey = entry.skillKey ?? resolveSkillKey(skillChoice, skillAliases);
  const skillLabel = getSkillLabel(skillKey);
  const success = Boolean(entry.success);
  const dc = getPhaseDc(phase, skillChoice);

  let progressGained = 0;
  let criticalBonusApplied = Boolean(entry.criticalBonusApplied);
  let narrative = null;
  let contextNote = "";
  let failureLine = entry.failureLine ?? "";
  let failureEvent = Boolean(entry.failureEvent);

  if (success) {
    if (phase.id === "phase1") {
      const skillTarget = getPhaseSkillTarget(phase, skillChoice);
      const currentValue = phaseState.skillProgress?.[skillChoice] ?? 0;
      if (currentValue < skillTarget) {
        progressGained = 1;
        let nextValue = Math.min(currentValue + 1, skillTarget);
        if (phase.allowCriticalBonus && criticalBonusApplied) {
          const boosted = Math.min(nextValue + 1, skillTarget);
          if (boosted > nextValue) {
            nextValue = boosted;
            progressGained += 1;
          }
        }
        phaseState.skillProgress[skillChoice] = nextValue;
        narrative = getPhase1Narrative(
          phase,
          skillChoice,
          phaseState.skillProgress
        );
        contextNote = getPhase1ContextNote(
          skillChoice,
          phaseState.skillProgress,
          progressGained > 0
        );
      } else {
        criticalBonusApplied = false;
      }
      phaseState.progress = getPhase1TotalProgress({
        ...phase,
        skillProgress: phaseState.skillProgress,
      });
    } else {
      if (phaseState.progress < phase.target) {
        progressGained = 1;
        let nextValue = Math.min(phaseState.progress + 1, phase.target);
        if (phase.allowCriticalBonus && criticalBonusApplied) {
          const boosted = Math.min(nextValue + 1, phase.target);
          if (boosted > nextValue) {
            nextValue = boosted;
            progressGained += 1;
          }
        }
        phaseState.progress = nextValue;
        narrative = phase.progressNarrative?.[phaseState.progress] ?? null;
      } else {
        criticalBonusApplied = false;
      }
    }
    phaseState.failuresInRow = 0;
    failureLine = "";
    failureEvent = false;
  } else {
    criticalBonusApplied = false;
    if (hasForcedSkillRule(phase)) {
      phaseState.failuresInRow += 1;
    }
    if (!failureLine) {
      failureLine = pickFailureLine(phase.failureLines);
    }
    failureEvent = Boolean(phase.failureEvents);
  }

  return {
    ...entry,
    phaseId: phase.id,
    phaseName: phase.name,
    skillChoice,
    skillKey,
    skillLabel,
    dc,
    success,
    progressGained,
    criticalBonusApplied,
    narrativeTitle: narrative?.title ?? "",
    narrativeText: narrative?.text ?? "",
    contextNote,
    failureLine,
    failureEvent,
  };
}


function resolveSkillChoice(entry, phase, skillAliases) {
  const allowed = getPhaseSkillList(phase);
  if (entry.skillChoice && allowed.includes(entry.skillChoice)) {
    return entry.skillChoice;
  }
  const key = entry.skillKey;
  if (key) {
    for (const choice of allowed) {
      if (resolveSkillKey(choice, skillAliases) === key) return choice;
    }
  }
  return allowed[0] ?? getDefaultSkills()[0] ?? "";
}


function getLogSortValue(entry) {
  const value = Number(entry?.checkNumber ?? entry?.timestamp ?? 0);
  return Number.isFinite(value) ? value : 0;
}


function deriveCheckCount(log) {
  let maxValue = 0;
  for (const entry of log ?? []) {
    const value = Number(entry?.checkNumber ?? 0);
    if (Number.isFinite(value)) {
      maxValue = Math.max(maxValue, value);
    }
  }
  return maxValue || (log?.length ?? 0);
}


function resetPhaseState(state, phaseConfig) {
  const config = Array.isArray(phaseConfig) ? phaseConfig : getPhaseConfig();
  state.phases = state.phases ?? {};
  for (const phase of config) {
    state.phases[phase.id] = {
      progress: 0,
      completed: false,
      failuresInRow: 0,
      skillProgress:
        phase.id === "phase1" ? buildEmptySkillProgress(phase) : undefined,
    };
  }
}


function getNextIncompletePhaseId(state, trackerId, phaseConfig) {
  const config = Array.isArray(phaseConfig)
    ? phaseConfig
    : getPhaseConfig(trackerId);
  for (const phase of config) {
    if (!state.phases[phase.id]?.completed) return phase.id;
  }
  return "";
}


function isPhaseUnlocked(phaseId, state, trackerId, phaseConfig) {
  const config = Array.isArray(phaseConfig)
    ? phaseConfig
    : getPhaseConfig(trackerId);
  const index = config.findIndex((phase) => phase.id === phaseId);
  if (index <= 0) return true;
  for (let i = 0; i < index; i += 1) {
    const prevId = config[i].id;
    if (!state.phases[prevId]?.completed) return false;
  }
  return true;
}




function migratePhase1Progress(total, phase) {
  let remaining = Math.max(0, Number(total) || 0);
  const progress = buildEmptySkillProgress(phase);
  const skills = getPhaseSkillList(phase);
  for (const key of skills) {
    if (remaining <= 0) break;
    const target = getPhaseSkillTarget(phase, key);
    const value = Math.min(target, remaining);
    progress[key] = value;
    remaining -= value;
  }
  return progress;
}


function buildPhase1ProgressLine(progress, targets, skills) {
  if (!progress || !targets) return "";
  const list = Array.isArray(skills) && skills.length ? skills : getDefaultSkills();
  const parts = list.map((key) => {
    const target = Number(targets?.[key] ?? 0);
    const value = Math.min(progress[key] ?? 0, target);
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    return `${label} ${value}/${target}`;
  });
  return parts.join(", ");
}


function notifyStateUpdated(trackerId) {
  if (!game?.socket || !game.user?.isGM) return;
  game.socket.emit(`module.${MODULE_ID}`, {
    type: SOCKET_EVENT_STATE,
    userId: game.user.id,
    trackerId,
  });
}


function requestStateUpdate(state, trackerId) {
  if (!game?.socket) return;
  game.socket.emit(`module.${MODULE_ID}`, {
    type: SOCKET_EVENT_REQUEST,
    userId: game.user?.id,
    state,
    trackerId,
  });
  ui.notifications.info("Indy Downtime Tracker: update sent to GM.");
}


export {
  getWorldState,
  setWorldState,
  normalizeProjectState,
  applyStateOverridesFromForm,
  recalculateStateFromLog,
  applyLogEntryToState,
  resolveSkillChoice,
  getLogSortValue,
  deriveCheckCount,
  resetPhaseState,
  getNextIncompletePhaseId,
  isPhaseUnlocked,
  migratePhase1Progress,
  buildPhase1ProgressLine,
  notifyStateUpdated,
  requestStateUpdate,
};
