import {
  ACTIVE_TRACKER_SETTING,
  DEFAULT_HEADER_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_PHASE_CONFIG,
  DEFAULT_STATE,
  DEFAULT_TAB_ICON,
  DEFAULT_TAB_LABEL,
  DEFAULT_TRACKER_NAME,
  MODULE_ID,
  RESTRICTED_ACTORS_SETTING,
  TRACKERS_SETTING,
} from "../constants.js";
import { debugLog, parseRestrictedActorUuids, sanitizeLabel } from "./labels.js";

import { buildEmptyPhase1, normalizePhaseConfig } from "./phase.js";
import { normalizeProjectState } from "./state.js";
function getLegacySetting(key) {
  const settingKey = `${MODULE_ID}.${key}`;
  if (!game?.settings?.settings?.has(settingKey)) return undefined;
  return game.settings.get(MODULE_ID, key);
}


function canWriteSettings() {
  return Boolean(game?.ready);
}

function getTrackers() {
  let stored = game.settings.get(MODULE_ID, TRACKERS_SETTING);
  if (!Array.isArray(stored) || !stored.length) {
    const legacy = buildDefaultTrackerFromLegacy();
    stored = [legacy];
    if (canWriteSettings()) {
      game.settings.set(MODULE_ID, TRACKERS_SETTING, stored);
    }
  }
  return normalizeTrackers(stored);
}


function getCurrentTrackerId() {
  const trackers = getTrackers();
  const stored = game.settings.get(MODULE_ID, ACTIVE_TRACKER_SETTING);
  if (stored && trackers.some((tracker) => tracker.id === stored)) {
    return stored;
  }
  const first = trackers[0]?.id ?? "tracker-1";
  if (canWriteSettings()) {
    game.settings.set(MODULE_ID, ACTIVE_TRACKER_SETTING, first);
  }
  return first;
}


function setCurrentTrackerId(trackerId) {
  if (!trackerId) return;
  if (!canWriteSettings()) return;
  game.settings.set(MODULE_ID, ACTIVE_TRACKER_SETTING, trackerId);
}


function getCurrentTracker() {
  return getTrackerById(getCurrentTrackerId()) ?? getTrackers()[0];
}


function getTrackerById(trackerId) {
  return getTrackers().find((tracker) => tracker.id === trackerId);
}


function normalizeTrackers(trackers) {
  return trackers.map((tracker, index) => {
    const id =
      typeof tracker?.id === "string" && tracker.id.trim()
        ? tracker.id.trim()
        : `tracker-${index + 1}`;
    const phaseConfig = normalizePhaseConfig(
      Array.isArray(tracker?.phaseConfig) && tracker.phaseConfig.length
        ? tracker.phaseConfig
        : DEFAULT_PHASE_CONFIG
    );
    const state = normalizeProjectState(tracker?.state, phaseConfig);
    return {
      id,
      name:
        typeof tracker?.name === "string" && tracker.name.trim()
          ? tracker.name.trim()
          : DEFAULT_TRACKER_NAME,
      headerLabel: sanitizeLabel(
        tracker?.headerLabel,
        DEFAULT_HEADER_LABEL
      ),
      tabLabel: sanitizeLabel(tracker?.tabLabel, DEFAULT_TAB_LABEL),
      intervalLabel: sanitizeLabel(
        tracker?.intervalLabel,
        DEFAULT_INTERVAL_LABEL
      ),
      tabIcon: sanitizeLabel(tracker?.tabIcon, DEFAULT_TAB_ICON),
      hideDcFromPlayers: Boolean(tracker?.hideDcFromPlayers),
      showLockedChecksToPlayers: tracker?.showLockedChecksToPlayers !== false,
      showPhasePlanToPlayers: Boolean(tracker?.showPhasePlanToPlayers),
      showFlowRelationships: tracker?.showFlowRelationships !== false,
      showFlowLines: tracker?.showFlowLines !== false,
      restrictedActorUuids: parseRestrictedActorUuids(
        tracker?.restrictedActorUuids
      ),
      phaseConfig,
      state,
    };
  });
}


function updateTrackerSettings(trackerId, updates) {
  if (!trackerId) return;
  const trackers = getTrackers();
  const index = trackers.findIndex((tracker) => tracker.id === trackerId);
  if (index < 0) return;
  trackers[index] = {
    ...trackers[index],
    ...updates,
  };
  game.settings.set(MODULE_ID, TRACKERS_SETTING, trackers);
}


function setTrackerPhaseConfig(trackerId, phaseConfig) {
  updateTrackerSettings(trackerId, { phaseConfig });
}


function setTrackerState(trackerId, state) {
  updateTrackerSettings(trackerId, { state });
}


function addTracker() {
  const trackers = getTrackers();
  const existing = new Set(trackers.map((tracker) => tracker.id));
  let index = trackers.length + 1;
  let id = `tracker-${index}`;
  while (existing.has(id)) {
    index += 1;
    id = `tracker-${index}`;
  }
  const blankPhase = buildEmptyPhase1();
  const tracker = {
    id,
    name: `Tracker ${trackers.length + 1}`,
    headerLabel: DEFAULT_HEADER_LABEL,
    tabLabel: `Downtime ${trackers.length + 1}`,
    intervalLabel: DEFAULT_INTERVAL_LABEL,
    tabIcon: DEFAULT_TAB_ICON,
    hideDcFromPlayers: false,
    showLockedChecksToPlayers: true,
    showPhasePlanToPlayers: false,
    showFlowRelationships: true,
    showFlowLines: true,
    restrictedActorUuids: [],
    phaseConfig: [blankPhase],
    state: normalizeProjectState(DEFAULT_STATE, [blankPhase]),
  };
  trackers.push(tracker);
  game.settings.set(MODULE_ID, TRACKERS_SETTING, trackers);
  setCurrentTrackerId(tracker.id);
}


async function removeCurrentTracker() {
  const trackers = getTrackers();
  if (trackers.length <= 1) return;
  const currentId = getCurrentTrackerId();
  debugLog("Removing tracker", {
    currentId,
    before: trackers.map((tracker) => tracker.id),
  });
  const next = trackers.filter((tracker) => tracker.id !== currentId);
  await game.settings.set(MODULE_ID, TRACKERS_SETTING, next);
  setCurrentTrackerId(next[0]?.id ?? "");
  debugLog("Tracker removed", {
    after: next.map((tracker) => tracker.id),
  });
}


function buildDefaultTrackerFromLegacy() {
  const legacyPhaseConfig = getLegacySetting("phaseConfig");
  const phaseConfig = normalizePhaseConfig(
    Array.isArray(legacyPhaseConfig) && legacyPhaseConfig.length
      ? legacyPhaseConfig
      : DEFAULT_PHASE_CONFIG
  );
  const legacyState = getLegacySetting("projectState");
  const state = normalizeProjectState(
    legacyState ?? DEFAULT_STATE,
    phaseConfig
  );
  return {
    id: "tracker-1",
    name: DEFAULT_TRACKER_NAME,
    headerLabel: getLegacySetting("headerLabel") || DEFAULT_HEADER_LABEL,
    tabLabel: getLegacySetting("tabLabel") || DEFAULT_TAB_LABEL,
    intervalLabel: getLegacySetting("intervalLabel") || DEFAULT_INTERVAL_LABEL,
    tabIcon: DEFAULT_TAB_ICON,
    hideDcFromPlayers: false,
    showLockedChecksToPlayers: true,
    showPhasePlanToPlayers: false,
    showFlowRelationships: true,
    showFlowLines: true,
    restrictedActorUuids: parseRestrictedActorUuids(
      getLegacySetting(RESTRICTED_ACTORS_SETTING)
    ),
    phaseConfig,
    state,
  };
}


export {
  getTrackers,
  getCurrentTrackerId,
  setCurrentTrackerId,
  getCurrentTracker,
  getTrackerById,
  normalizeTrackers,
  updateTrackerSettings,
  setTrackerPhaseConfig,
  setTrackerState,
  addTracker,
  removeCurrentTracker,
  buildDefaultTrackerFromLegacy,
};


