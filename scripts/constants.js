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
    target: 8,
    allowCriticalBonus: true,
    failureEvents: false,
    skills: ["insight", "persuasion", "religion"],
    skillTargets: { insight: 3, persuasion: 3, religion: 2 },
    image: "",
    skillDcSteps: {
      insight: [12, 13, 14],
      persuasion: [13, 13, 14],
      religion: [14, 15],
    },
    dcPenaltySkill: "insight",
    dcPenaltyPerMissing: 1,
    failureEventTable: "",
    skillNarratives: {
      insight: {
        1: {
          title: "Learning Whose Silence Carries Weight",
          text:
           "Before anyone trusts your words, they need to know you are hearing theirs. In the Cogs, silence isn't emptiness - it's memory, caution, and names that never came back. To listen here is to learn who speaks, who cannot afford to, and who has already been ignored too many times.",
        },
        2: {
          title: "Recognizing the Pressures That Shape Every Choice",
          text: "You begin to see the strain beneath the metal. Every conversation carries the weight of consequences - lost work, broken parts, quiet punishments. You learn that disagreement isn't hostility here. It's fear choosing its words carefully.",
        },
        3: {
          title: "Knowing the Cost Others Pay to Stand Beside You",
          text: "Not everyone can stand in the light, even if they believe. Some can only help quietly, from the edges, where survival still demands silence. Understanding the movement now means knowing when not to ask more of someone than they can afford to give."
        }
      },
      persuasion: {
        1: {
          title: "When People Choose to Return Without Being Asked",
          text: "The first sign of trust isn't agreement - it's return.They come back after the shift ends.\nAfter the argument.\nAfter the doubt.\nNo one says why, but presence itself becomes an answer.",
        },
        2: {
          title: "When Others Speak in Your Defense Before You Do",
          text:
            "One day, the challenge isn't answered by you.Someone else speaks first. Not louder - just steadier. In that moment, belief stops being something you explain and becomes something others are willing to stand beside.",
        },
        3: {
          title: "When Trust Becomes Action Without Instruction",
          text: "Eventually, no one waits to be told what to do. Food is shared. Watches are kept. Repairs are made without being asked.Trust stops being a feeling and becomes a habit - one that holds even when you are not there."
        }
      },
      religion: {
        1: {
          title: "Redefining the Hearth as Community, Not Houses",
          text: "They stop asking where Boldrei's house is. They start asking who she protects. When hearth becomes people instead of walls, the question of belonging finally finds room to breathe.",
        },
        2: {
          title: "When the Words No Longer Need Your Voice",
          text:
            "You hear your words come back to you - changed. Sharper. Simpler. Truer to their lives than to your sermons. When the message no longer needs your voice to survive, you know it has found a home.",
        },
      },
    },
    failureLines: [
      "People listen, but do not act yet.",
      "Debate stalls the message for now.",
      "Fatigue keeps attention low.",
    ],
  },
  {
    id: "phase2",
    name: "Holding the Hearth",
    narrativeDuration: "1-3 months",
    expectedGain: "~1",
    target: 9,
    allowCriticalBonus: false,
    forceSkillAfterFailures: "insight",
    failureEvents: false,
    skills: ["persuasion", "religion", "insight"],
    skillDcs: { persuasion: 15, religion: 15, insight: 15 },
    dcPenaltySkill: "insight",
    dcPenaltyPerMissing: 0,
    failureEventTable: "",
    image: "",
    progressNarrative: {
      1: {
        title: "Mutual Aid Routine",
        text: "Mutual aid becomes routine.",
      },
      3: {
        title: "Mutual Aid Routine",
        text: "Mutual aid becomes routine.",
      },
      4: {
        title: "Persists Without You",
        text: "Community persists without daily cleric presence.",
      },
      6: {
        title: "Persists Without You",
        text: "Community persists without daily cleric presence.",
      },
      7: {
        title: "External Pressure",
        text: "External pressure begins to mount.",
      },
      8: {
        title: "External Pressure",
        text: "External pressure begins to mount.",
      },
      9: {
        title: "Phase Complete",
        text: "Stable community holds together.",
      },
    },
    failureLines: [
      "Tension flares between groups.",
      "Burnout thins the gatherings.",
      "Fear keeps people indoors.",
    ],
  },
  {
    id: "phase3",
    name: "Tending the Ember",
    narrativeDuration: "Several months",
    expectedGain: "~1",
    target: 12,
    allowCriticalBonus: false,
    failureEvents: true,
    skills: ["persuasion", "religion", "insight"],
    skillDcs: { persuasion: 15, religion: 15, insight: 15 },
    dcPenaltySkill: "insight",
    dcPenaltyPerMissing: 0,
    failureEventTable: "",
    image: "",
    progressNarrative: {
      3: {
        title: "Space Defended",
        text: "Defenders speak up when the space is challenged.",
      },
      6: {
        title: "Ritualized Space",
        text: "Rituals and repairs make the site feel lived-in.",
      },
      9: {
        title: "Early Warnings",
        text: "Early warnings travel fast when trouble stirs.",
      },
      12: {
        title: "Phase Complete",
        text:
          "The Shared Ember exists. Ash-Twenty-Seven emerges, and a safe place holds.",
      },
    },
    failureLines: [
      "Crackdown pressure forces dispersal.",
      "A forced relocation breaks momentum.",
      "An ideological split fractures support.",
    ],
  },
];

export const DEFAULT_STATE = {
  activePhaseId: "phase1",
  phases: {
    phase1: { progress: 0, completed: false, failuresInRow: 0 },
    phase2: { progress: 0, completed: false, failuresInRow: 0 },
    phase3: { progress: 0, completed: false, failuresInRow: 0 },
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
