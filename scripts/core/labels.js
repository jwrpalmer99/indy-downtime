import {
  DEBUG_SETTING,
  DEFAULT_HEADER_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_TAB_ICON,
  DEFAULT_TAB_LABEL,
  LAST_ACTOR_IDS_SETTING,
  LAST_SKILL_CHOICES_SETTING,
  MODULE_ID,
  RESTRICTED_ACTORS_SETTING,
} from "../constants.js";
import { getCurrentTracker, getTrackerById } from "./tracker.js";

function getLegacySetting(key) {
  const settingKey = `${MODULE_ID}.${key}`;
  if (!game?.settings?.settings?.has(settingKey)) return undefined;
  return game.settings.get(MODULE_ID, key);
}


function debugLog(message, data = {}) {
  try {
    if (!game?.settings?.get(MODULE_ID, DEBUG_SETTING)) return;
  } catch (error) {
    return;
  }
  const payload = Object.keys(data).length ? data : "";
  console.log(`[%s] %s`, MODULE_ID, message, payload);
}


function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  if (Number.isFinite(max)) {
    return Math.min(Math.max(numeric, min), max);
  }
  return Math.max(numeric, min);
}


function sanitizeLabel(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}


function saveJsonToFile(data, filename) {
  try {
    const blob = new Blob([data], { type: "application/json" });
    saveDataToFile(blob, "application/json", filename);
  } catch (error) {
    console.error(error);
    ui.notifications.warn("Indy Downtime Tracker: failed to save file.");
  }
}


function getHeaderLabel(trackerId) {
  return (
    getTrackerById(trackerId)?.headerLabel ||
    getLegacySetting("headerLabel") ||
    DEFAULT_HEADER_LABEL
  );
}


function getTabLabel(trackerId) {
  return (
    getTrackerById(trackerId)?.tabLabel ||
    getLegacySetting("tabLabel") ||
    DEFAULT_TAB_LABEL
  );
}


function getIntervalLabel(trackerId) {
  return (
    getTrackerById(trackerId)?.intervalLabel ||
    getLegacySetting("intervalLabel") ||
    DEFAULT_INTERVAL_LABEL
  );
}


function getTabIcon(trackerId) {
  return getTrackerById(trackerId)?.tabIcon || DEFAULT_TAB_ICON;
}


function shouldHideDc(trackerId) {
  return Boolean(getTrackerById(trackerId)?.hideDcFromPlayers);
}


function shouldShowLockedChecks(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  return tracker?.showLockedChecksToPlayers !== false;
}


function shouldShowPhasePlan(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  return Boolean(tracker?.showPhasePlanToPlayers);
}




function getRestrictedActorUuids(trackerId) {
  const stored = getTrackerById(trackerId)?.restrictedActorUuids ??
    getLegacySetting(RESTRICTED_ACTORS_SETTING);
  if (!Array.isArray(stored)) return [];
  return stored.filter((uuid) => typeof uuid === "string" && uuid.trim().length);
}


function parseRestrictedActorUuids(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length);
  }
  return String(raw)
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter((value) => value.length);
}


function getLastSkillChoice(trackerId) {
  const stored = game.settings.get(MODULE_ID, LAST_SKILL_CHOICES_SETTING) ?? {};
  return stored?.[trackerId] ?? "";
}


function setLastSkillChoice(trackerId, value) {
  if (!trackerId) return;
  const stored = game.settings.get(MODULE_ID, LAST_SKILL_CHOICES_SETTING) ?? {};
  stored[trackerId] = value;
  game.settings.set(MODULE_ID, LAST_SKILL_CHOICES_SETTING, stored);
}


function getLastActorId(trackerId) {
  const stored = game.settings.get(MODULE_ID, LAST_ACTOR_IDS_SETTING) ?? {};
  return stored?.[trackerId] ?? "";
}


function setLastActorId(trackerId, value) {
  if (!trackerId) return;
  const stored = game.settings.get(MODULE_ID, LAST_ACTOR_IDS_SETTING) ?? {};
  stored[trackerId] = value;
  game.settings.set(MODULE_ID, LAST_ACTOR_IDS_SETTING, stored);
}


function getSkillOptions() {
  const skills = CONFIG.PF2E?.skills ?? CONFIG.DND5E?.skills ?? {};
  const abilities =
    CONFIG.PF2E?.abilities ??
    CONFIG.PF2E?.abilityAbbreviations ??
    CONFIG.DND5E?.abilities ??
    {};

  const skillOptions = Object.entries(skills).map(([key, labelKey]) => ({
    key,
    label: localizeSkillLabel(labelKey, key),
  }));

  const abilityOptions = Object.entries(abilities).map(([key, labelKey]) => ({
    key: `ability:${key}`,
    label: `${localizeSkillLabel(labelKey, key)} (Ability)`,
  }));

  return [...skillOptions, ...abilityOptions].sort((a, b) =>
    a.label.localeCompare(b.label)
  );
}


function getSkillLabel(skillKey) {
  if (typeof skillKey === "string" && skillKey.startsWith("ability:")) {
    const abilityKey = skillKey.split(":")[1] ?? "";
    const abilities =
      CONFIG.PF2E?.abilities ??
      CONFIG.PF2E?.abilityAbbreviations ??
      CONFIG.DND5E?.abilities ??
      {};
    const labelKey = abilities[abilityKey];
    return localizeSkillLabel(labelKey, abilityKey);
  }
  const skills = CONFIG.PF2E?.skills ?? CONFIG.DND5E?.skills ?? {};
  const labelKey = skills[skillKey];
  return localizeSkillLabel(labelKey, skillKey);
}


function localizeSkillLabel(labelKey, fallback) {
  if (!labelKey) return fallback;
  if (typeof labelKey === "string") {
    return game.i18n.localize(labelKey);
  }
  if (typeof labelKey === "object") {
    const label = labelKey.label || labelKey.name;
    if (typeof label === "string") {
      return game.i18n.localize(label);
    }
  }
  return String(labelKey ?? fallback);
}





export {
  debugLog,
  clampNumber,
  sanitizeLabel,
  saveJsonToFile,
  getHeaderLabel,
  getTabLabel,
  getIntervalLabel,
  getTabIcon,
  shouldHideDc,
  shouldShowLockedChecks,
  shouldShowPhasePlan,
  getRestrictedActorUuids,
  parseRestrictedActorUuids,
  getLastSkillChoice,
  setLastSkillChoice,
  getLastActorId,
  setLastActorId,
  getSkillOptions,
  getSkillLabel,
};


