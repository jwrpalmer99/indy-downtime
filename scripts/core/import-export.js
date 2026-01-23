import {
  DEFAULT_HEADER_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_PHASE_CONFIG,
  DEFAULT_STATE,
  DEFAULT_TAB_LABEL,
  DEFAULT_TRACKER_NAME,
  MODULE_ID,
  TRACKERS_SETTING,
  DEFAULT_TAB_ICON
} from "../constants.js";
import { parseJsonPayload } from "./parse.js";
import {
  parseRestrictedActorUuids,
  sanitizeLabel,
  saveJsonToFile,
} from "./labels.js";
import {
  getCurrentTrackerId,
  getTrackers,
  setCurrentTrackerId,
  setTrackerPhaseConfig,
  updateTrackerSettings,
} from "./tracker.js";
import { normalizeProjectState, setWorldState } from "./state.js";
import { getPhaseConfig, normalizePhaseConfig } from "./phase.js";

function getSettingsExportPayload() {
  const trackers = getTrackers().map((tracker) => ({
    id: tracker.id,
    name: tracker.name,
    headerLabel: tracker.headerLabel,
    tabLabel: tracker.tabLabel,
    intervalLabel: tracker.intervalLabel,
    tabIcon: tracker.tabIcon,
    hideDcFromPlayers: tracker.hideDcFromPlayers,
    showLockedChecksToPlayers: tracker.showLockedChecksToPlayers,
    restrictedActorUuids: tracker.restrictedActorUuids ?? [],
    phaseConfig: tracker.phaseConfig ?? [],
  }));
  return {
    module: MODULE_ID,
    version: game.modules.get(MODULE_ID)?.version ?? "",
    exportedAt: new Date().toISOString(),
    settings: {
      trackers,
    },
  };
}


function getStateExportPayload() {
  const trackers = getTrackers().map((tracker) => ({
    id: tracker.id,
    state: tracker.state ?? {},
  }));
  return {
    module: MODULE_ID,
    version: game.modules.get(MODULE_ID)?.version ?? "",
    exportedAt: new Date().toISOString(),
    state: {
      activeTrackerId: getCurrentTrackerId(),
      trackers,
    },
  };
}


async function applySettingsImportPayload(payload) {
  const settings = payload?.settings ?? payload;
  if (!settings || typeof settings !== "object") return;
  if (Array.isArray(settings.trackers)) {
    const existingStates = new Map(
      getTrackers().map((tracker) => [tracker.id, tracker.state])
    );
    const nextTrackers = settings.trackers.map((tracker, index) => {
      const id =
        typeof tracker?.id === "string" && tracker.id.trim()
          ? tracker.id.trim()
          : `tracker-${index + 1}`;
      const phaseConfig = normalizePhaseConfig(
        Array.isArray(tracker?.phaseConfig) && tracker.phaseConfig.length
          ? tracker.phaseConfig
          : DEFAULT_PHASE_CONFIG
      );
      const state = normalizeProjectState(
        existingStates.get(id) ?? DEFAULT_STATE,
        phaseConfig
      );
      return {
        id,
        name: sanitizeLabel(tracker?.name, DEFAULT_TRACKER_NAME),
        headerLabel: sanitizeLabel(tracker?.headerLabel, DEFAULT_HEADER_LABEL),
        tabLabel: sanitizeLabel(tracker?.tabLabel, DEFAULT_TAB_LABEL),
        intervalLabel: sanitizeLabel(
          tracker?.intervalLabel,
          DEFAULT_INTERVAL_LABEL
        ),
        tabIcon: sanitizeLabel(tracker?.tabIcon, DEFAULT_TAB_ICON),
        hideDcFromPlayers: Boolean(tracker?.hideDcFromPlayers),
        showLockedChecksToPlayers: tracker?.showLockedChecksToPlayers !== false,
        restrictedActorUuids: parseRestrictedActorUuids(
          tracker?.restrictedActorUuids
        ),
        phaseConfig,
        state,
      };
    });
    await game.settings.set(MODULE_ID, TRACKERS_SETTING, nextTrackers);
  } else {
    const trackerId = getCurrentTrackerId();
    const updates = {};
    if (typeof settings.headerLabel === "string") {
      updates.headerLabel = sanitizeLabel(
        settings.headerLabel,
        DEFAULT_HEADER_LABEL
      );
    }
    if (typeof settings.tabLabel === "string") {
      updates.tabLabel = sanitizeLabel(settings.tabLabel, DEFAULT_TAB_LABEL);
    }
    if (typeof settings.intervalLabel === "string") {
      updates.intervalLabel = sanitizeLabel(
        settings.intervalLabel,
        DEFAULT_INTERVAL_LABEL
      );
    }
    if (typeof settings.tabIcon === "string") {
      updates.tabIcon = sanitizeLabel(settings.tabIcon, DEFAULT_TAB_ICON);
    }
    if (typeof settings.hideDcFromPlayers !== "undefined") {
      updates.hideDcFromPlayers = Boolean(settings.hideDcFromPlayers);
    }
    if (typeof settings.showLockedChecksToPlayers !== "undefined") {
      updates.showLockedChecksToPlayers = Boolean(settings.showLockedChecksToPlayers);
    }
    if (Array.isArray(settings.restrictedActorUuids)) {
      updates.restrictedActorUuids = parseRestrictedActorUuids(
        settings.restrictedActorUuids
      );
    }
    if (Object.keys(updates).length) {
      updateTrackerSettings(trackerId, updates);
    }
    if (Array.isArray(settings.phaseConfig)) {
      setTrackerPhaseConfig(trackerId, settings.phaseConfig);
    }
  }
}


async function applyStateImportPayload(payload) {
  const state = payload?.state ?? payload;
  if (!state || typeof state !== "object") return;
  if (Array.isArray(state.trackers)) {
    const incoming = new Map(
      state.trackers
        .filter((entry) => entry && typeof entry.id === "string")
        .map((entry) => [entry.id, entry.state ?? {}])
    );
    const next = getTrackers().map((tracker) => {
      if (!incoming.has(tracker.id)) return tracker;
      const phaseConfig = tracker.phaseConfig ?? DEFAULT_PHASE_CONFIG;
      return {
        ...tracker,
        state: normalizeProjectState(incoming.get(tracker.id), phaseConfig),
      };
    });
    await game.settings.set(MODULE_ID, TRACKERS_SETTING, next);
    if (state.activeTrackerId) {
      setCurrentTrackerId(state.activeTrackerId);
    }
    return;
  }
  await setWorldState(state, getCurrentTrackerId());
}


export {
  getSettingsExportPayload,
  getStateExportPayload,
  applySettingsImportPayload,
  applyStateImportPayload,
};
