export const MODULE_ID = "indy-downtime";
export const SHEET_TAB_ID = "indy-downtime";
export const SHEET_TAB_LABEL = "Downtime";
export const DEFAULT_HEADER_LABEL = "Indy Downtime Tracker";
export const DEFAULT_TAB_LABEL = SHEET_TAB_LABEL;
export const DEFAULT_INTERVAL_LABEL = "Weekly";
export const DEFAULT_TAB_ICON = "fas fa-fire";
export const DEBUG_SETTING = "debugLogging";
export const TIDY_TEMPLATE_PATH = "modules/indy-downtime/templates/indy-downtime.hbs";
export const SOCKET_EVENT_STATE = "state-updated";
export const SOCKET_EVENT_REQUEST = "state-request";
export const RESTRICTED_ACTORS_SETTING = "restrictedActorUuids";
export const SETTINGS_EXPORT_MENU = "settingsExport";
export const STATE_EXPORT_MENU = "stateExport";
export const TRACKERS_SETTING = "trackers";
export const ACTIVE_TRACKER_SETTING = "activeTrackerId";
export const LAST_SKILL_CHOICES_SETTING = "lastSkillChoices";
export const LAST_ACTOR_IDS_SETTING = "lastActorIds";

export const DEFAULT_PHASE_CONFIG = [
  {
    id: "phase1",
    name: "Building the Hearth",
    narrativeDuration: "3-5 weeks",
    expectedGain: "1-3",
    target: 6,
    allowCriticalBonus: true,
    failureEvents: false,
    failureEventTable: "",
    image: "",
    groups: [
      {
        id: "group1",
        name: "Core Checks",
        checks: [
          {
            id: "insight-1",
            name: "Insight 1",
            skill: "insight",
            dc: 13,
            value: 1,
            dependsOn: [],
          },
          {
            id: "insight-2",
            name: "Insight 2",
            skill: "insight",
            dc: 14,
            value: 1,
            dependsOn: ["insight-1"],
          },
          {
            id: "persuasion-1",
            name: "Persuasion 1",
            skill: "persuasion",
            dc: 14,
            value: 1,
            dependsOn: [],
          },
          {
            id: "persuasion-2",
            name: "Persuasion 2",
            skill: "persuasion",
            dc: 15,
            value: 1,
            dependsOn: ["persuasion-1"],
          },
          {
            id: "religion-1",
            name: "Religion 1",
            skill: "religion",
            dc: 15,
            value: 1,
            dependsOn: [],
          },
          {
            id: "religion-2",
            name: "Religion 2",
            skill: "religion",
            dc: 16,
            value: 1,
            dependsOn: ["religion-1"],
          },
        ],
      },
    ],
    successLines: [],
    failureLines: [
      {
        id: "phase1-failure-1",
        text: "People listen, but do not act yet.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
      {
        id: "phase1-failure-2",
        text: "Debate stalls the message for now.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
      {
        id: "phase1-failure-3",
        text: "Fatigue keeps attention low.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
    ],
  },
  {
    id: "phase2",
    name: "Holding the Hearth",
    narrativeDuration: "1-3 months",
    expectedGain: "~1",
    target: 3,
    allowCriticalBonus: false,
    failureEvents: false,
    failureEventTable: "",
    image: "",
    groups: [
      {
        id: "group1",
        name: "Core Checks",
        checks: [
          {
            id: "persuasion",
            name: "Persuasion",
            skill: "persuasion",
            dc: 15,
            value: 1,
            dependsOn: [],
          },
          {
            id: "religion",
            name: "Religion",
            skill: "religion",
            dc: 15,
            value: 1,
            dependsOn: [],
          },
          {
            id: "insight",
            name: "Insight",
            skill: "insight",
            dc: 15,
            value: 1,
            dependsOn: [],
          },
        ],
      },
    ],
    successLines: [],
    failureLines: [
      {
        id: "phase2-failure-1",
        text: "Tension flares between groups.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
      {
        id: "phase2-failure-2",
        text: "Burnout thins the gatherings.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
      {
        id: "phase2-failure-3",
        text: "Fear keeps people indoors.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
    ],
  },
  {
    id: "phase3",
    name: "Tending the Ember",
    narrativeDuration: "Several months",
    expectedGain: "~1",
    target: 3,
    allowCriticalBonus: false,
    failureEvents: true,
    failureEventTable: "",
    image: "",
    groups: [
      {
        id: "group1",
        name: "Core Checks",
        checks: [
          {
            id: "persuasion",
            name: "Persuasion",
            skill: "persuasion",
            dc: 15,
            value: 1,
            dependsOn: [],
          },
          {
            id: "religion",
            name: "Religion",
            skill: "religion",
            dc: 15,
            value: 1,
            dependsOn: [],
          },
          {
            id: "insight",
            name: "Insight",
            skill: "insight",
            dc: 15,
            value: 1,
            dependsOn: [],
          },
        ],
      },
    ],
    successLines: [],
    failureLines: [
      {
        id: "phase3-failure-1",
        text: "Crackdown pressure forces dispersal.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
      {
        id: "phase3-failure-2",
        text: "A forced relocation breaks momentum.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
      {
        id: "phase3-failure-3",
        text: "An ideological split fractures support.",
        dependsOnChecks: [],
        dependsOnGroups: [],
      },
    ],
  },
];

export const DEFAULT_STATE = {
  activePhaseId: "phase1",
  phases: {
    phase1: { progress: 0, completed: false, failuresInRow: 0, checkProgress: {} },
    phase2: { progress: 0, completed: false, failuresInRow: 0, checkProgress: {} },
    phase3: { progress: 0, completed: false, failuresInRow: 0, checkProgress: {} },
  },
  checkCount: 0,
  criticalBonusEnabled: false,
  journalId: "",
  log: [],
};

export const DEFAULT_TRACKER_NAME = "Downtime";

export function getTrackerTabId(trackerId) {
  return `${SHEET_TAB_ID}-${trackerId}`;
}

export const DEFAULT_SKILL_ALIASES = {
  persuasion: "per",
  insight: "ins",
  religion: "rel",
};
