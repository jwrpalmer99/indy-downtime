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

  restorePendingTab,

  updateTidyTabLabel,

} from "./ui.js";

function findPf2eTabNav($html) {

  const candidates = $html.find("nav.sheet-navigation, nav.tabs, nav.sheet-tabs, .sheet-tabs, .tabs, .sheet-navigation");

  if (!candidates.length) return null;

  let nav = candidates.filter("[data-group]").first();

  if (!nav.length) nav = candidates.first();

  return nav;

}

function rebindSheetTabs(app, $html) {

  const rootEl = $html?.[0] ?? app?.element?.[0] ?? app?.element;

  if (!rootEl) return;

  const tabs = app?._tabs ?? app?.tabs;

  const controllers = [];

  if (tabs instanceof Map) {

    controllers.push(...tabs.values());

  } else if (Array.isArray(tabs)) {

    controllers.push(...tabs);

  } else if (tabs && typeof tabs === "object") {

    controllers.push(...Object.values(tabs));

  }

  for (const controller of controllers) {

    if (!controller || typeof controller.bind !== "function") continue;

    try {

      controller.bind(rootEl);

    } catch (error) {

      // ignore

    }

  }

}

async function renderPf2eSheet(app, html) {

  if (game.system?.id !== "pf2e") return;

  const actor = app?.actor ?? app?.document;

  if (!actor || actor.type !== "character") return;

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

  const tabNav = findPf2eTabNav($html);

  if (!tabNav?.length) {

    debugLog("PF2e tab nav not found", { actorName: actor?.name });

    return;

  }

  const group = tabNav.data("group") || tabNav.attr("data-group") || "primary";

  const sheetBody = $html.find(".sheet-body").first();

  const sheetContent = sheetBody.find(".sheet-content").first();

  const tabContainer = sheetContent.length ? sheetContent : (sheetBody.length ? sheetBody : tabNav.closest(".window-content"));

  for (const tracker of trackers) {

    if (!isActorAllowed(actor, tracker.id)) {

      hideDowntimeTab($html, tracker.id);

      continue;

    }

    const tabId = getTrackerTabId(tracker.id);

    const tabLabel = tracker.tabLabel || DEFAULT_TAB_LABEL;

    const tabIcon = tracker.tabIcon || DEFAULT_TAB_ICON;

    const tabIconHtml = tabIcon ? `<i class=\"${tabIcon}\"></i>` : tabLabel;

    let tabButton = tabNav.find(`[data-tab='${tabId}']`).first();

    if (!tabButton.length) {

      tabButton = $(

        `<a class=\"item\" data-tab=\"${tabId}\" data-tooltip=\"${tabLabel}\" role=\"tab\" aria-label=\"${tabLabel}\">${tabIconHtml}</a>`

      );

      tabNav.append(tabButton);

    } else {

      tabButton

        .attr("data-tooltip", tabLabel)

        .attr("aria-label", tabLabel)

        .html(tabIconHtml);

    }

    let tabContent = $html.find(`.tab[data-tab='${tabId}']`).first();

    if (!tabContent.length) {

      tabContent = $(

        `<section class=\"tab indy-downtime major\" data-tab=\"${tabId}\" data-group=\"${group}\"></section>`

      );

      if (tabContainer?.length) {

        tabContainer.append(tabContent);

      } else {

        $html.append(tabContent);

      }

    }

    try {

      const trackerData = buildTrackerData({

        actor,

        showActorSelect: false,

        embedded: true,

        trackerId: tracker.id,

      });

      const renderFn = foundry?.applications?.handlebars?.renderTemplate ?? renderTemplate;

      const rendered = await renderFn(

        "modules/indy-downtime/templates/indy-downtime.hbs",

        trackerData

      );

      tabContent.html(rendered);

    } catch (error) {

      console.error(error);

      debugLog("Failed to render PF2e downtime tab", { trackerId: tracker.id });

      continue;

    }

    const root = tabContent.find("[data-drep-root]").first();

    if (!root.length) {

      debugLog("PF2e downtime tab root not found", { trackerId: tracker.id });

      continue;

    }

    attachTrackerListeners(root, { render: () => app.render(), actor, app });

  }

  rebindSheetTabs(app, $html);

  restorePendingTab(app, $html);

}

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

      const renderFn = foundry?.applications?.handlebars?.renderTemplate ?? renderTemplate;

      const rendered = await renderFn(

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

    attachTrackerListeners(root, { render: () => app.render(), actor: app.actor, app });

  }

  restorePendingTab(app, $html);

});

Hooks.on("renderActorSheetPF2e", (app, html) => {

  renderPf2eSheet(app, html);

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

