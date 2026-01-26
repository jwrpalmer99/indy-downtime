import {
  DEFAULT_PHASE_CONFIG,
  DEFAULT_STATE,
  MODULE_ID,
  SOCKET_EVENT_REQUEST,
  SOCKET_EVENT_STATE,
} from "../constants.js";
import { clampNumber, getSkillLabel, getCheckRollMode } from "./labels.js";
import {
  buildCheckProgressMap,
  getFirstPhaseId,
  getPhaseCheckById,
  getPhaseCheckLabel,
  getPhaseCheckTarget,
  getPhaseConfig,
  getPhaseDc,
  getDifficultyLabel,
  getPhaseProgress,
  getPhaseChecks,
  isGroupComplete,
  isPhaseComplete,
  pickLineForCheck,
  pickLineForGroup,
} from "./phase.js";
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
    if (Array.isArray(stored?.log) && stored.log.length) {
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
    const fallback = { progress: 0, completed: false, failuresInRow: 0, checkProgress: {} };
    const existing = foundry.utils.mergeObject(
      fallback,
      state.phases[phase.id] ?? {},
      { inplace: false, overwrite: true }
    );
    if (!existing.checkProgress || typeof existing.checkProgress !== "object") {
      existing.checkProgress = {};
    }
    existing.checkProgress = migrateLegacyCheckProgress(phase, existing);
    existing.progress = Math.min(
      getPhaseProgress(phase, existing.checkProgress),
      Number(phase.target ?? 0)
    );
    existing.completed = isPhaseComplete({ ...phase, progress: existing.progress });
    state.phases[phase.id] = existing;
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

function migrateLegacyCheckProgress(phase, phaseState) {
  const progress = buildCheckProgressMap(phase, phaseState.checkProgress);
  const legacy = phaseState.skillProgress;
  if (legacy && typeof legacy === "object") {
    for (const check of getPhaseChecks(phase)) {
      const value = Number(legacy?.[check.skill] ?? 0);
      if (!Number.isFinite(value)) continue;
      if (check.step) {
        progress[check.id] = value >= check.step ? 1 : 0;
      } else {
        progress[check.id] = clampNumber(value, 0, getPhaseCheckTarget(check));
      }
    }
  }
  return progress;
}

function applyStateOverridesFromForm(state, formData, phaseConfig) {
  if (!state || !formData || !Array.isArray(phaseConfig)) return;
  const checkCount = Number(formData.checkCount);
  if (Number.isFinite(checkCount)) {
    state.checkCount = Math.max(0, checkCount);
  }

  const checkProgressData = formData.checkProgress ?? {};

  for (const phase of phaseConfig) {
    const phaseState = state.phases[phase.id] ?? {
      progress: 0,
      completed: false,
      failuresInRow: 0,
      checkProgress: {},
    };
    const failureValue = Number(formData[`${phase.id}FailuresInRow`]);
    if (Number.isFinite(failureValue)) {
      phaseState.failuresInRow = Math.max(0, failureValue);
    }

    const nextProgress = buildCheckProgressMap(phase, phaseState.checkProgress);
    const overrides = checkProgressData?.[phase.id] ?? {};
    for (const check of getPhaseChecks(phase)) {
      const value = Number(overrides?.[check.id]);
      if (Number.isFinite(value)) {
        nextProgress[check.id] = clampNumber(value, 0, getPhaseCheckTarget(check));
      }
    }
    phaseState.checkProgress = nextProgress;
    phaseState.progress = Math.min(
      getPhaseProgress(phase, nextProgress),
      Number(phase.target ?? 0)
    );

    if (formData[`${phase.id}Completed`] !== undefined) {
      phaseState.completed = Boolean(formData[`${phase.id}Completed`]);
    } else {
      phaseState.completed = isPhaseComplete({ ...phase, progress: phaseState.progress });
    }

    state.phases[phase.id] = phaseState;
  }
}

function recalculateStateFromLog(state, trackerId) {
  const phaseConfig = getPhaseConfig(trackerId);
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
      checkProgress: buildCheckProgressMap(phase, {}),
    };
  }

  const sorted = [...(state.log ?? [])].sort(
    (a, b) => getLogSortValue(a) - getLogSortValue(b)
  );
  const rebuiltLog = [];
  for (const entry of sorted) {
    rebuiltLog.push(
      applyLogEntryToState(entry, rebuilt, phaseConfig)
    );
  }

  for (const phase of phaseConfig) {
    const phaseState = rebuilt.phases[phase.id];
    phaseState.progress = Math.min(
      getPhaseProgress(phase, phaseState.checkProgress),
      Number(phase.target ?? 0)
    );
    phaseState.completed = isPhaseComplete({ ...phase, progress: phaseState.progress });
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

function applyLogEntryToState(entry, state, phaseConfig) {
  if (entry?.type === "phase-complete") {
    return entry;
  }
  const phase =
    phaseConfig.find((candidate) => candidate.id === entry.phaseId) ??
    phaseConfig[0];
  const phaseState = state.phases[phase.id];
  const resolved = resolveCheckFromEntry(entry, phase);
  const check = resolved.check;
  const checkId = check?.id ?? entry.checkId ?? "";
  const groupId = check?.groupId ?? entry.groupId ?? "";
  const skillKey = check?.skill ?? entry.skillKey ?? entry.skillChoice ?? "";
  const skillLabel = skillKey ? getSkillLabel(skillKey) : "";
  const success = Boolean(entry.success);
  const rollMode = getCheckRollMode();
  const dc = getPhaseDc(phase, check);
  const difficulty = entry.difficulty ?? check?.difficulty ?? "";
  let dcLabel = entry.dcLabel ?? "";
  let dcLabelType = entry.dcLabelType ?? "";
  if (rollMode === "d100") {
    dcLabel = dcLabel || (difficulty ? getDifficultyLabel(difficulty) : "");
    dcLabelType = "Difficulty";
  } else {
    dcLabel = dcLabel || (Number.isFinite(dc) ? String(dc) : "");
    dcLabelType = dcLabelType || "DC";
  }

  let progressGained = 0;
  let criticalBonusApplied = Boolean(entry.criticalBonusApplied);
  let successLine = entry.successLine ?? "";
  let failureLine = entry.failureLine ?? "";
  let failureEvent = Boolean(entry.failureEvent);
  const beforeGroupComplete = isGroupComplete(phase, groupId, phaseState.checkProgress);

  if (check) {
    const currentValue = phaseState.checkProgress?.[check.id] ?? 0;
    const target = getPhaseCheckTarget(check);
    if (success) {
      if (currentValue < target) {
        const increment = Number.isFinite(Number(entry.progressGained))
          ? Number(entry.progressGained)
          : 1;
        const nextValue = clampNumber(currentValue + increment, 0, target);
        progressGained = nextValue - currentValue;
        phaseState.checkProgress[check.id] = nextValue;
      } else {
        criticalBonusApplied = false;
      }
      phaseState.failuresInRow = 0;
      const afterGroupComplete = isGroupComplete(phase, groupId, phaseState.checkProgress);
      if (!successLine && !beforeGroupComplete && afterGroupComplete) {
        successLine = pickLineForGroup(phase.successLines, groupId);
      }
      if (!successLine) {
        successLine = pickLineForCheck(phase.successLines, checkId, groupId, { allowGroup: false });
      }
      failureLine = "";
      failureEvent = false;
    } else {
      criticalBonusApplied = false;
      phaseState.failuresInRow = Number(phaseState.failuresInRow ?? 0) + 1;
      if (!failureLine) {
        failureLine = pickLineForCheck(phase.failureLines, checkId, groupId);
      }
      failureEvent = Boolean(phase.failureEvents);
    }
  }

  return {
    ...entry,
    phaseId: phase.id,
    phaseName: phase.name,
    checkId,
    checkName: check ? getPhaseCheckLabel(check) : entry.checkName ?? "",
    groupId,
    groupName: check?.groupName ?? entry.groupName ?? "",
    skillKey,
    skillLabel,
    dc,
    dcLabel,
    dcLabelType,
    difficulty,
    success,
    progressGained,
    criticalBonusApplied,
    successLine,
    failureLine,
    failureEvent,
  };
}

function resolveCheckFromEntry(entry, phase) {
  if (entry?.checkId) {
    const check = getPhaseCheckById(phase, entry.checkId);
    if (check) return { check };
  }
  const skillChoice = entry?.skillChoice;
  if (skillChoice) {
    const check = getPhaseChecks(phase).find((candidate) => candidate.skill === skillChoice);
    if (check) return { check };
  }
  const skillKey = entry?.skillKey;
  if (skillKey) {
    const check = getPhaseChecks(phase).find((candidate) => candidate.skill === skillKey);
    if (check) return { check };
  }
  return { check: getPhaseChecks(phase)[0] ?? null };
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
      checkProgress: buildCheckProgressMap(phase, {}),
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
  resetPhaseState,
  getNextIncompletePhaseId,
};
