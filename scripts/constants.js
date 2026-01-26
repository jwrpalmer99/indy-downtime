export const MODULE_ID = "indy-downtime";
export const SHEET_TAB_ID = "indy-downtime";
const SHEET_TAB_LABEL = "Downtime";
export const DEFAULT_HEADER_LABEL = "Indy Downtime Tracker";
export const DEFAULT_TAB_LABEL = SHEET_TAB_LABEL;
export const DEFAULT_INTERVAL_LABEL = "Weekly";
export const DEFAULT_TAB_ICON = "fas fa-fire";
export const DEBUG_SETTING = "debugLogging";
export const INJECT_INTO_SHEET_SETTING = "injectIntoSheet";
export const MANUAL_ROLL_SETTING = "manualRollEnabled";
export const TIDY_TEMPLATE_PATH = "modules/indy-downtime/templates/indy-downtime.hbs";
export const SOCKET_EVENT_STATE = "state-updated";
export const SOCKET_EVENT_REQUEST = "state-request";
export const RESTRICTED_ACTORS_SETTING = "restrictedActorUuids";
export const SETTINGS_EXPORT_MENU = "settingsExport";
export const STATE_EXPORT_MENU = "stateExport";
export const SKILL_OVERRIDES_MENU = "skillOverrides";
export const TRACKERS_SETTING = "trackers";
export const ACTIVE_TRACKER_SETTING = "activeTrackerId";
export const LAST_SKILL_CHOICES_SETTING = "lastSkillChoices";
export const LAST_ACTOR_IDS_SETTING = "lastActorIds";
export const MANUAL_SKILL_OVERRIDES_SETTING = "manualSkillOverrides";

export const DEFAULT_PHASE_CONFIG = [ 
];

export const DEFAULT_STATE = {
};

export const DEFAULT_TRACKER_NAME = "Downtime";

export function getTrackerTabId(trackerId) {
  return `${SHEET_TAB_ID}-${trackerId}`;
}

