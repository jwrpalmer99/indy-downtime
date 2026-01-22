import {
  DEBUG_SETTING,
  DEFAULT_HEADER_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_SKILL_ALIASES,
  DEFAULT_TAB_ICON,
  DEFAULT_TAB_LABEL,
  LAST_ACTOR_IDS_SETTING,
  LAST_SKILL_CHOICES_SETTING,
  MODULE_ID,
  RESTRICTED_ACTORS_SETTING,
} from "../constants.js";
import { parseList } from "./parse.js";
import { getCurrentTracker, getTrackerById } from "./tracker.js";

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
    game.settings.get(MODULE_ID, "headerLabel") ||
    DEFAULT_HEADER_LABEL
  );
}


function getTabLabel(trackerId) {
  return (
    getTrackerById(trackerId)?.tabLabel ||
    game.settings.get(MODULE_ID, "tabLabel") ||
    DEFAULT_TAB_LABEL
  );
}


function getIntervalLabel(trackerId) {
  return (
    getTrackerById(trackerId)?.intervalLabel ||
    game.settings.get(MODULE_ID, "intervalLabel") ||
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


function getRestrictedActorUuids(trackerId) {
  const stored = getTrackerById(trackerId)?.restrictedActorUuids ??
    game.settings.get(MODULE_ID, RESTRICTED_ACTORS_SETTING);
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


function getSkillAliases() {
  let stored = game.settings.get(MODULE_ID, "skillAliases");
  if (!stored) {
    try {
      stored = game.settings.get(MODULE_ID, "skillKeys");
    } catch (error) {
      stored = null;
    }
  }
  return foundry.utils.mergeObject(DEFAULT_SKILL_ALIASES, stored ?? {}, {
    inplace: false,
    overwrite: true,
  });
}


function parseSkillAliases(raw) {
  if (!raw) return getSkillAliases();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      ui.notifications.error(
        "Indy Downtime Tracker: skill aliases must be a JSON object."
      );
      return null;
    }
    return parsed;
  } catch (error) {
    console.error(error);
    ui.notifications.error(
      "Indy Downtime Tracker: skill aliases JSON is invalid."
    );
    return null;
  }
}


function getSkillOptions() {
  const skills = CONFIG.DND5E?.skills ?? {};
  return Object.entries(skills)
    .map(([key, labelKey]) => ({
      key,
      label: localizeSkillLabel(labelKey, key),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}


function getSkillLabel(skillKey) {
  const skills = CONFIG.DND5E?.skills ?? {};
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


function resolveSkillKey(skillChoice, skillAliases) {
  if (skillAliases && typeof skillAliases[skillChoice] === "string") {
    return skillAliases[skillChoice];
  }
  return skillChoice;
}



function pickFailureLine(lines) {
  if (!lines || !lines.length) return "";
  return lines[Math.floor(Math.random() * lines.length)];
}

export {
  pickFailureLine,
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
  getRestrictedActorUuids,
  parseRestrictedActorUuids,
  getLastSkillChoice,
  setLastSkillChoice,
  getLastActorId,
  setLastActorId,
  getSkillAliases,
  parseSkillAliases,
  getSkillOptions,
  getSkillLabel,
  localizeSkillLabel,
  resolveSkillKey,
};
