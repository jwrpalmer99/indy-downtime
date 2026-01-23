import {
  ACTIVE_TRACKER_SETTING,
  DEBUG_SETTING,
  DEFAULT_HEADER_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_PHASE_CONFIG,
  DEFAULT_STATE,
  DEFAULT_TAB_ICON,
  DEFAULT_TAB_LABEL,
  LAST_ACTOR_IDS_SETTING,
  LAST_SKILL_CHOICES_SETTING,
  MODULE_ID,
  RESTRICTED_ACTORS_SETTING,
  SETTINGS_EXPORT_MENU,
  STATE_EXPORT_MENU,
  SHEET_TAB_ID,
  TRACKERS_SETTING,
  getTrackerTabId,
} from "./constants.js";
import {
  debugLog,
  getTrackers,
} from "./core-utils.js";
import {
  DowntimeRepSettings,
  DowntimeRepSettingsExport,
  DowntimeRepStateExport,
} from "./settings-apps.js";
import {
  attachTrackerListeners,
  buildTrackerData,
  handleSocketMessage,
  hideDowntimeTab,
  isActorAllowed,
  registerSheetTab,
  registerTidyTab,
  rerenderCharacterSheets,
  rerenderSettingsApps,
  updateTidyTabLabel,
} from "./ui.js";

Hooks.once("init", () => {
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (left, right) => left === right);
  }
  game.settings.registerMenu(MODULE_ID, "settings", {
    name: "Indy Downtime Tracker",
    label: "Configure Tracker",
    icon: "fas fa-cog",
    type: DowntimeRepSettings,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS_EXPORT_MENU, {
    name: "Export/Import Settings",
    label: "Export/Import Settings",
    icon: "fas fa-file-export",
    type: DowntimeRepSettingsExport,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, STATE_EXPORT_MENU, {
    name: "Export/Import State",
    label: "Export/Import State",
    icon: "fas fa-file-import",
    type: DowntimeRepStateExport,
    restricted: true,
  });

  game.settings.register(MODULE_ID, DEBUG_SETTING, {
    name: "Debug Logging",
    hint: "Enable additional console logging for Indy Downtime Tracker.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, TRACKERS_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: [],
    onChange: () => {
      debugLog("trackers updated");
      registerSheetTab();
      updateTidyTabLabel();
      rerenderCharacterSheets();
      rerenderSettingsApps();
    },
  });

  game.settings.register(MODULE_ID, ACTIVE_TRACKER_SETTING, {
    scope: "client",
    config: false,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, LAST_SKILL_CHOICES_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, LAST_ACTOR_IDS_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, "projectState", {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_STATE,
    onChange: () => {
      debugLog("projectState updated");
      rerenderCharacterSheets();
      rerenderSettingsApps();
    },
  });
});

Hooks.on("renderCharacterActorSheet", async (app, html) => {
  debugLog("Render hook fired", {
    appClass: app?.constructor?.name,
    actorType: app?.actor?.type,
    actorName: app?.actor?.name,
    isEditable: app?.isEditable,
  });
  const $html = html instanceof jQuery ? html : $(html);
  const trackers = getTrackers();
  const trackerIds = new Set(trackers.map((tracker) => tracker.id));
  const prefix = `${SHEET_TAB_ID}-`;
  $html.find(`[data-tab^='${SHEET_TAB_ID}-']`).each((_, element) => {
    const tabId = element?.dataset?.tab ?? element?.dataset?.tabId ?? "";
    if (!tabId.startsWith(prefix)) return;
    const trackerId = tabId.slice(prefix.length);
    if (!trackerId || trackerIds.has(trackerId)) return;
    hideDowntimeTab($html, trackerId);
  });
  for (const tracker of trackers) {
    if (!isActorAllowed(app?.actor, tracker.id)) {
      hideDowntimeTab($html, tracker.id);
      continue;
    }
    const tabId = getTrackerTabId(tracker.id);
    let root = $html.find(`.tab[data-tab='${tabId}']`).first();
    if (!root.length) {
      root = $html
        .find(`[data-drep-root][data-drep-tracker='${tracker.id}']`)
        .first();
    }
    if (!root.length) {
      debugLog("Downtime tab content not found", { trackerId: tracker.id });
      continue;
    }

    try {
      const trackerData = buildTrackerData({
        actor: app.actor,
        showActorSelect: false,
        embedded: true,
        trackerId: tracker.id,
      });
      const rendered = await renderTemplate(
        "modules/indy-downtime/templates/indy-downtime.hbs",
        trackerData
      );
      root.html(rendered);
    } catch (error) {
      console.error(error);
      debugLog("Failed to render downtime tab", { trackerId: tracker.id });
    }

    root = root.find("[data-drep-root]").first();
    if (!root.length) {
      debugLog("Downtime tab root not found", { trackerId: tracker.id });
      continue;
    }
    debugLog("Downtime tab ready", {
      rollButtons: root.find("[data-drep-action='roll-interval']").length,
      trackerId: tracker.id,
    });
    attachTrackerListeners(root, { render: () => app.render(), actor: app.actor });
  }
});

Hooks.once("ready", () => {
  if (game.system?.id !== "dnd5e") {
    ui.notifications.warn(
      "Indy Downtime Tracker: this module expects the DnD5e system."
    );
  }
  if (game.socket) {
    game.socket.on(`module.${MODULE_ID}`, handleSocketMessage);
  }
  registerSheetTab();
  registerTidyTab();
  updateTidyTabLabel();
  rerenderCharacterSheets();
});




