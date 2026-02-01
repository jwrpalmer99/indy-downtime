import {
  DEBUG_SETTING,
  DEFAULT_HEADER_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_TAB_ICON,
  DEFAULT_TAB_LABEL,
  LAST_ACTOR_IDS_SETTING,
  LAST_SKILL_CHOICES_SETTING,
  CHECK_ROLL_MODE_SETTING,
  INJECT_INTO_SHEET_SETTING,
  MANUAL_ROLL_SETTING,
  MANUAL_SKILL_OVERRIDES_SETTING,
  MODULE_ID,
  RESTRICTED_ACTORS_SETTING,
} from "../constants.js";
import { getCurrentTracker, getTrackerById, normalizeManualSkillOverrides } from "./tracker.js";

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


function resolveHideDcSettings(trackerId) {
  const tracker = getTrackerById(trackerId);
  if (tracker && (typeof tracker.hideDcLockedFromPlayers !== "undefined" || typeof tracker.hideDcUnlockedFromPlayers !== "undefined")) {
    return {
      hideLocked: Boolean(tracker.hideDcLockedFromPlayers),
      hideUnlocked: Boolean(tracker.hideDcUnlockedFromPlayers),
    };
  }
  return {
    hideLocked: Boolean(tracker?.hideDcFromPlayers),
    hideUnlocked: Boolean(tracker?.hideDcFromPlayers),
  };
}

function shouldHideDc(trackerId) {
  const { hideLocked, hideUnlocked } = resolveHideDcSettings(trackerId);
  return hideLocked || hideUnlocked;
}

function shouldHideDcLocked(trackerId) {
  return resolveHideDcSettings(trackerId).hideLocked;
}

function shouldHideDcUnlocked(trackerId) {
  return resolveHideDcSettings(trackerId).hideUnlocked;
}


function shouldShowLockedChecks(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  return tracker?.showLockedChecksToPlayers !== false;
}


function shouldShowPhasePlan(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  return Boolean(tracker?.showPhasePlanToPlayers);
}

function shouldShowFuturePlans(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  return Boolean(tracker?.showFuturePlansToPlayers);
}

function shouldShowCheckTooltips(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  return Boolean(tracker?.showCheckTooltipsToPlayers);
}

function shouldShowPlanRewards(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  return Boolean(tracker?.showPlanRewardsToPlayers);
}

function shouldInjectIntoSheet(trackerId) {
  const settingKey = `${MODULE_ID}.${INJECT_INTO_SHEET_SETTING}`;
  if (game?.settings?.settings?.has(settingKey)) {
    return Boolean(game.settings.get(MODULE_ID, INJECT_INTO_SHEET_SETTING));
  }
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  if (!tracker) {
    return game.system?.id === "dnd5e" || game.system?.id === "pf2e";
  }
  if (Object.prototype.hasOwnProperty.call(tracker, "injectIntoSheet")) {
    return Boolean(tracker.injectIntoSheet);
  }
  return game.system?.id === "dnd5e" || game.system?.id === "pf2e";
}

function shouldUseManualRolls(trackerId) {
  if (getCheckRollMode(trackerId) === "narrative") return true;
  if (game.system?.id === "dnd5e" || game.system?.id === "pf2e") return false;
  const settingKey = `${MODULE_ID}.${MANUAL_ROLL_SETTING}`;
  if (game?.settings?.settings?.has(settingKey)) {
    return Boolean(game.settings.get(MODULE_ID, MANUAL_ROLL_SETTING));
  }
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  if (tracker && Object.prototype.hasOwnProperty.call(tracker, "manualRollEnabled")) {
    return Boolean(tracker.manualRollEnabled);
  }
  return true;
}

function getModuleCheckRollMode() {
  const settingKey = `${MODULE_ID}.${CHECK_ROLL_MODE_SETTING}`;
  if (game?.settings?.settings?.has(settingKey)) {
    return String(game.settings.get(MODULE_ID, CHECK_ROLL_MODE_SETTING) ?? "d20");
  }
  return "d20";
}

function getCheckRollMode(trackerId) {
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  const trackerMode = typeof tracker?.checkRollMode === "string"
    ? tracker.checkRollMode.trim().toLowerCase()
    : "";
  if (trackerMode === "d20" || trackerMode === "d100" || trackerMode === "narrative") {
    return trackerMode;
  }
  return getModuleCheckRollMode();
}

function isD100RollMode(trackerId) {
  return getCheckRollMode(trackerId) === "d100";
}

function isNarrativeRollMode(trackerId) {
  return getCheckRollMode(trackerId) === "narrative";
}

const NARRATIVE_OUTCOMES = ["triumph", "success", "failure", "despair"];
const NARRATIVE_OUTCOME_LABELS = {
  triumph: "Triumph",
  success: "Success",
  failure: "Failure",
  despair: "Despair",
};

function normalizeNarrativeOutcome(raw) {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return NARRATIVE_OUTCOMES.includes(value) ? value : "";
}

function isNarrativeOutcomeSuccess(outcome) {
  const normalized = normalizeNarrativeOutcome(outcome);
  return normalized === "triumph" || normalized === "success";
}

function getNarrativeOutcomeLabel(outcome) {
  const normalized = normalizeNarrativeOutcome(outcome);
  return normalized ? (NARRATIVE_OUTCOME_LABELS[normalized] ?? "") : "";
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


function normalizeOverrideMap(raw) {
  const output = {};
  if (!raw || typeof raw !== "object") return output;
  for (const [key, value] of Object.entries(raw)) {
    const trimmed = String(key ?? "").trim();
    if (!trimmed) continue;
    const label = typeof value === "string" && value.trim() ? value.trim() : trimmed;
    output[trimmed] = label;
  }
  return output;
}

function getManualSkillOverrides(trackerId) {
  const stored = game.settings.get(MODULE_ID, MANUAL_SKILL_OVERRIDES_SETTING) ?? {};
  const normalized = normalizeManualSkillOverrides(stored);
  if (Object.keys(normalized.skills).length || Object.keys(normalized.abilities).length) {
    return normalized;
  }
  const tracker = trackerId ? getTrackerById(trackerId) : getCurrentTracker();
  const legacy = normalizeManualSkillOverrides(tracker?.manualSkillOverrides ?? {});
  return legacy;
}

function normalizeSkillMap(raw) {
  const output = {};
  if (!raw) return output;
  if (raw instanceof Map) {
    for (const [key, value] of raw.entries()) {
      if (!key) continue;
      output[String(key)] = value;
    }
    return output;
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry) continue;
      const key = entry.key ?? entry.id ?? entry.value ?? entry.slug;
      if (!key) continue;
      const label = entry.label ?? entry.name ?? entry.title ?? entry;
      output[String(key)] = label;
    }
    return output;
  }
  if (typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (!key) continue;
      output[key] = value;
    }
  }
  return output;
}

function getConfiguredSkillMap() {
  const sources = [
    CONFIG.PF2E?.skills,
    CONFIG.DND5E?.skills,
    CONFIG.skills,
    game.system?.config?.skills,
  ];
  for (const source of sources) {
    const normalized = normalizeSkillMap(source);
    if (Object.keys(normalized).length) return normalized;
  }
  return {};
}

function getConfiguredAbilityMap() {
  const sources = [
    CONFIG.PF2E?.abilities,
    CONFIG.PF2E?.abilityAbbreviations,
    CONFIG.DND5E?.abilities,
    CONFIG.abilities,
    game.system?.config?.abilities,
  ];
  for (const source of sources) {
    const normalized = normalizeSkillMap(source);
    if (Object.keys(normalized).length) return normalized;
  }
  return {};
}

function normalizeActorEntries(raw) {
  const output = {};
  if (!raw) return output;
  if (raw instanceof Map) {
    for (const [key, value] of raw.entries()) {
      if (!key) continue;
      output[String(key)] = normalizeActorEntryValue(key, value);
    }
    return output;
  }
  if (typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (!key) continue;
      output[key] = normalizeActorEntryValue(key, value);
    }
  }
  return output;
}

function normalizeActorEntryValue(key, value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null) {
    const label =
      value.label ??
      value.name ??
      value.title ??
      value.value ??
      value.long ??
      value.short ??
      value.abbreviation ??
      "";
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  return key;
}

function extractSystemSkills(actor) {
  const sys = actor?.system ?? {};
  const direct = sys.skills;
  if (direct && typeof direct === "object" && Object.keys(direct).length) {
    return { entries: normalizeActorEntries(direct), source: "skills" };
  }
  const attrSkills = sys.attributes?.skills;
  if (attrSkills && typeof attrSkills === "object" && Object.keys(attrSkills).length) {
    return { entries: normalizeActorEntries(attrSkills), source: "attributes.skills" };
  }
  const attributes = sys.attributes;
  if (attributes && typeof attributes === "object" && Object.keys(attributes).length) {
    return { entries: normalizeActorEntries(attributes), source: "attributes" };
  }
  return { entries: {}, source: "" };
}

function extractItemSkills(actor) {
  const output = {};
  const rawItems = actor?.items;
  const items = rawItems?.values
    ? Array.from(rawItems.values())
    : (Array.isArray(rawItems) ? rawItems : []);
  for (const item of items) {
    if (!item || item.type !== "skill") continue;
    const key =
      item.system?.key ??
      item.system?.slug ??
      item.system?.id ??
      item.id ??
      item.name;
    if (!key) continue;
    output[String(key)] = item.name ?? key;
  }
  return output;
}

function collectFallbackActorMaps() {
  const actors = game?.actors ? Array.from(game.actors) : [];
  const aggregated = { skills: {}, abilities: {} };
  for (const actor of actors) {
    if (!actor) continue;
    const { entries: skillsFromSystem, source: skillsSource } = extractSystemSkills(actor);
    const skillsFromItems = extractItemSkills(actor);
    const abilitiesRaw =
      actor?.system?.abilities ??
      actor?.system?.attributes?.abilities ??
      actor?.abilities ??
      actor?.attributes?.abilities ??
      null;
    let abilities = normalizeActorEntries(abilitiesRaw);
    let systemSkills = skillsFromSystem;
    if (!Object.keys(abilities).length && skillsSource === "attributes") {
      abilities = skillsFromSystem;
      systemSkills = {};
    }
    const skillsRaw =
      actor?.system?.skills ??
      actor?.system?.attributes?.skills ??
      actor?.skills ??
      actor?.attributes?.skills ??
      null;
    Object.assign(
      aggregated.skills,
      normalizeActorEntries(skillsRaw),
      systemSkills,
      skillsFromItems
    );
    Object.assign(aggregated.abilities, abilities);
  }
  return aggregated;
}

function getFallbackSkillMaps() {
  return collectFallbackActorMaps();
}

function getResolvedSkillMaps() {
  const overrides = getManualSkillOverrides();
  const overrideSkills = normalizeOverrideMap(overrides.skills);
  const overrideAbilities = normalizeOverrideMap(overrides.abilities);
  const configuredSkills = getConfiguredSkillMap();
  const configuredAbilities = getConfiguredAbilityMap();
  if (Object.keys(configuredSkills).length && Object.keys(configuredAbilities).length) {
    return {
      skills: Object.keys(overrideSkills).length ? overrideSkills : configuredSkills,
      abilities: Object.keys(overrideAbilities).length ? overrideAbilities : configuredAbilities,
    };
  }
  const fallback = getFallbackSkillMaps();
  return {
    skills: Object.keys(overrideSkills).length
      ? overrideSkills
      : (Object.keys(configuredSkills).length ? configuredSkills : fallback.skills),
    abilities: Object.keys(overrideAbilities).length
      ? overrideAbilities
      : (Object.keys(configuredAbilities).length ? configuredAbilities : fallback.abilities),
  };
}

function getSkillOptions() {
  const { skills, abilities } = getResolvedSkillMaps();

  const options = [];
  const seenKeys = new Set();
  const seenLabels = new Set();
  const addOption = (key, label) => {
    const normalizedKey = String(key ?? "").trim().toLowerCase();
    if (!normalizedKey || seenKeys.has(normalizedKey)) return;
    const normalizedLabel = String(label ?? "").trim().toLowerCase();
    if (normalizedLabel && seenLabels.has(normalizedLabel)) return;
    seenKeys.add(normalizedKey);
    if (normalizedLabel) seenLabels.add(normalizedLabel);
    options.push({ key, label });
  };

  for (const [key, labelKey] of Object.entries(skills)) {
    addOption(key, localizeSkillLabel(labelKey, key));
  }

  for (const [key, labelKey] of Object.entries(abilities)) {
    const abilityKey = `ability:${key}`;
    addOption(abilityKey, `${localizeSkillLabel(labelKey, key)} (Ability)`);
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}


function getSkillLabel(skillKey) {
  const { skills, abilities } = getResolvedSkillMaps();
  if (typeof skillKey === "string" && skillKey.startsWith("ability:")) {
    const abilityKey = skillKey.split(":")[1] ?? "";
    const labelKey = abilities[abilityKey];
    return localizeSkillLabel(labelKey, abilityKey);
  }
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
  shouldHideDcLocked,
  shouldHideDcUnlocked,
  shouldShowLockedChecks,
  shouldShowPhasePlan,
  shouldShowFuturePlans,
  shouldShowCheckTooltips,
  shouldShowPlanRewards,
  shouldInjectIntoSheet,
  shouldUseManualRolls,
  getModuleCheckRollMode,
  getCheckRollMode,
  isD100RollMode,
  isNarrativeRollMode,
  normalizeNarrativeOutcome,
  isNarrativeOutcomeSuccess,
  getNarrativeOutcomeLabel,
  getRestrictedActorUuids,
  parseRestrictedActorUuids,
  getLastSkillChoice,
  setLastSkillChoice,
  getLastActorId,
  setLastActorId,
  getSkillOptions,
  getSkillLabel,
};


