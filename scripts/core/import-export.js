import {
  DEFAULT_HEADER_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_PHASE_CONFIG,
  DEFAULT_STATE,
  DEFAULT_TAB_LABEL,
  DEFAULT_TRACKER_NAME,
  CHECK_ROLL_MODE_SETTING,
  INJECT_INTO_SHEET_SETTING,
  MANUAL_ROLL_SETTING,
  MODULE_ID,
  TRACKERS_SETTING,
  DEFAULT_TAB_ICON,
  MANUAL_SKILL_OVERRIDES_SETTING,
} from "../constants.js";
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
import { normalizePhaseConfig } from "./phase.js";

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
    showPhasePlanToPlayers: tracker.showPhasePlanToPlayers,
    showFuturePlansToPlayers: tracker.showFuturePlansToPlayers,
    showCheckTooltipsToPlayers: tracker.showCheckTooltipsToPlayers,
    showFlowRelationships: tracker.showFlowRelationships,
    showFlowLines: tracker.showFlowLines,
    restrictedActorUuids: tracker.restrictedActorUuids ?? [],
    phaseConfig: tracker.phaseConfig ?? [],
  }));
  return {
    module: MODULE_ID,
    version: game.modules.get(MODULE_ID)?.version ?? "",
    exportedAt: new Date().toISOString(),
    settings: {
      injectIntoSheet: game.settings.get(MODULE_ID, INJECT_INTO_SHEET_SETTING),
      manualRollEnabled: game.settings.get(MODULE_ID, MANUAL_ROLL_SETTING),
      checkRollMode: game.settings.get(MODULE_ID, CHECK_ROLL_MODE_SETTING),
      trackers,
      manualSkillOverrides: game.settings.get(MODULE_ID, MANUAL_SKILL_OVERRIDES_SETTING) ?? { skills: {}, abilities: {} },
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
  const getLegacyTrackerSetting = (key) => {
    if (!Array.isArray(settings.trackers)) return undefined;
    const match = settings.trackers.find((tracker) =>
      Object.prototype.hasOwnProperty.call(tracker ?? {}, key)
    );
    return match ? match[key] : undefined;
  };
  const injectedSetting = typeof settings.injectIntoSheet !== "undefined"
    ? settings.injectIntoSheet
    : getLegacyTrackerSetting("injectIntoSheet");
  if (typeof injectedSetting !== "undefined") {
    await game.settings.set(
      MODULE_ID,
      INJECT_INTO_SHEET_SETTING,
      Boolean(injectedSetting)
    );
  }
  const manualRollSetting = typeof settings.manualRollEnabled !== "undefined"
    ? settings.manualRollEnabled
    : getLegacyTrackerSetting("manualRollEnabled");
  if (typeof manualRollSetting !== "undefined") {
    await game.settings.set(
      MODULE_ID,
      MANUAL_ROLL_SETTING,
      Boolean(manualRollSetting)
    );
  }
  if (typeof settings.checkRollMode === "string") {
    await game.settings.set(
      MODULE_ID,
      CHECK_ROLL_MODE_SETTING,
      settings.checkRollMode
    );
  }
  if (Array.isArray(settings.trackers)) {
    const existingStates = new Map(
      getTrackers().map((tracker) => [tracker.id, tracker.state])
    );
    if (settings.manualSkillOverrides && typeof settings.manualSkillOverrides === "object") {
      await game.settings.set(MODULE_ID, MANUAL_SKILL_OVERRIDES_SETTING, settings.manualSkillOverrides);
    }
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
        showPhasePlanToPlayers: Boolean(tracker?.showPhasePlanToPlayers),
        showFuturePlansToPlayers: Boolean(tracker?.showFuturePlansToPlayers),
        showCheckTooltipsToPlayers: Boolean(tracker?.showCheckTooltipsToPlayers),
        showFlowRelationships: tracker?.showFlowRelationships !== false,
        showFlowLines: tracker?.showFlowLines !== false,
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
    if (typeof settings.showPhasePlanToPlayers !== "undefined") {
      updates.showPhasePlanToPlayers = Boolean(settings.showPhasePlanToPlayers);
    }
    if (typeof settings.showFuturePlansToPlayers !== "undefined") {
      updates.showFuturePlansToPlayers = Boolean(settings.showFuturePlansToPlayers);
    }
    if (typeof settings.showCheckTooltipsToPlayers !== "undefined") {
      updates.showCheckTooltipsToPlayers = Boolean(settings.showCheckTooltipsToPlayers);
    }
    if (typeof settings.showFlowRelationships !== "undefined") {
      updates.showFlowRelationships = Boolean(settings.showFlowRelationships);
    }
    if (typeof settings.showFlowLines !== "undefined") {
      updates.showFlowLines = Boolean(settings.showFlowLines);
    }
    if (settings.manualSkillOverrides && typeof settings.manualSkillOverrides === "object") {
      await game.settings.set(MODULE_ID, MANUAL_SKILL_OVERRIDES_SETTING, settings.manualSkillOverrides);
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
