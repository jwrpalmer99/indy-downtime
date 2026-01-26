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

  SKILL_OVERRIDES_MENU,

  SHEET_TAB_ID,

  TRACKERS_SETTING,

  MANUAL_SKILL_OVERRIDES_SETTING,

  getTrackerTabId,

} from "./constants.js";

import {

  debugLog,

  getTrackers,
  shouldInjectIntoSheet,

} from "./core-utils.js";

import {

  DowntimeRepSettings,

  DowntimeRepSkillOverrides,

  DowntimeRepSettingsExport,

  DowntimeRepStateExport,

} from "./settings-apps.js";

import {

  attachTrackerListeners,

  buildTrackerData,

  handleSocketMessage,

  hideDowntimeTab,

  isActorAllowed,

  openDowntimeDialog,
  registerSheetTab,

  registerTidyTab,

  refreshSceneControls,
  rerenderCharacterSheets,

  rerenderSettingsApps,

  restorePendingTab,

  updateTidyTabLabel,

} from "./ui.js";

function findSheetTabNav($html) {

  const candidates = $html.find("nav.sheet-navigation, nav.tabs, nav.sheet-tabs, .sheet-tabs, .tabs, .sheet-navigation");

  if (!candidates.length) return null;

  let nav = candidates.filter("[data-group]").first();

  if (!nav.length) nav = candidates.first();

  return nav;

}

function getInjectedTrackers() {
  return getTrackers().filter((tracker) => shouldInjectIntoSheet(tracker.id));
}

function getSheetTabGroup($html, tabNav) {
  if (!tabNav?.length) return "primary";
  let group = tabNav.data("group") || tabNav.attr("data-group") || "";
  if (!group) {
    const tabButton = tabNav.find("[data-tab]").first();
    group = tabButton.data("group") || tabButton.attr("data-group") || "";
  }
  if (!group) {
    const tabPanel = $html.find(".tab[data-group]").first();
    group = tabPanel.data("group") || tabPanel.attr("data-group") || "";
  }
  return group || "primary";
}

function getSheetTabAction($html, tabNav) {
  if (!tabNav?.length) return "tab";
  let group = tabNav.data("action") || tabNav.attr("data-action") || "";
  if (!group) {
    const tabButton = tabNav.find("[data-tab]").first();
    group = tabButton.data("action") || tabButton.attr("data-action") || "";
  }
  if (!group) {
    const tabPanel = $html.find(".tab[data-group]").first();
    group = tabPanel.data("action") || tabPanel.attr("data-action") || "";
  }
  return group || "tab";
}

function getSheetTabContainer($html, tabNav, group) {
  if (group) {
    const tabPanel = $html.find(`.tab[data-group='${group}']`).first();
    if (tabPanel.length && tabPanel.parent().length) return tabPanel.parent();
  }
  const sheetContent = $html.find(".sheet-body .sheet-content").first();
  if (sheetContent.length) return sheetContent;
  const sheetBody = $html.find(".sheet-body").first();
  if (sheetBody.length) return sheetBody;
  const windowContent = tabNav?.closest?.(".window-content");
  if (windowContent?.length) return windowContent;
  return $html;
}

function ensureGenericSheetTab($html, tracker, tabNav) {
  if (!tabNav?.length || !tracker) return null;
  const tabId = getTrackerTabId(tracker.id);
  let root = $html.find(`.tab[data-tab='${tabId}']`).first();
  if (root.length) return root;

  const tabLabel = tracker.tabLabel || DEFAULT_TAB_LABEL;
  const tabIcon = tracker.tabIcon || DEFAULT_TAB_ICON;
  const tabIconHtml = tabIcon ? `<i class=\"${tabIcon}\"></i>` : tabLabel;
  const group = getSheetTabGroup($html, tabNav);
  const action = getSheetTabAction($html, tabNav);
  let tabButton = tabNav.find(`[data-tab='${tabId}']`).first();
  if (!tabButton.length) {
    const sample = tabNav.find("[data-tab]").first();
    const tagName = sample.prop("tagName")?.toLowerCase() || "a";
    const className = sample.attr("class") || "item";
    tabButton = $(`<${tagName} class=\"${className}\" data-action=\"${action}\" data-tab=\"${tabId}\"></${tagName}>`);
    if (group) tabButton.attr("data-group", group);
    const role = sample.attr("role") || "tab";
    tabButton.attr("role", role);
    tabNav.append(tabButton);
  }
  tabButton
    .attr("data-tooltip", tabLabel)
    .attr("aria-label", tabLabel)
    .html(tabIconHtml);

  const container = getSheetTabContainer($html, tabNav, group);
  root = $(`<section class=\"tab indy-downtime\" data-tab=\"${tabId}\"></section>`);
  if (group) root.attr("data-group", group);
  container.append(root);
  return root;
}

const recentRenderNodes = new WeakSet();

function shouldSkipRenderHook(html) {
  const element = html?.[0] ?? html;
  if (!element) return false;
  if (recentRenderNodes.has(element)) return true;
  recentRenderNodes.add(element);
  setTimeout(() => recentRenderNodes.delete(element), 0);
  return false;
}

async function renderDowntimeSheet(app, html, { allowInsert = false } = {}) {
  debugLog("Render hook fired", {
    appClass: app?.constructor?.name,
    actorType: app?.actor?.type,
    actorName: app?.actor?.name,
    isEditable: app?.isEditable,
  });

  const $html = html instanceof jQuery ? html : $(html);
  const trackers = getInjectedTrackers();
  const trackerIds = new Set(trackers.map((tracker) => tracker.id));
  const prefix = `${SHEET_TAB_ID}-`;
  const tabNav = allowInsert ? findSheetTabNav($html) : null;
  const canInsert = Boolean(allowInsert && tabNav?.length);
  let insertedAny = false;

  $html.find(`[data-tab^='${SHEET_TAB_ID}-']`).each((_, element) => {
    const tabId = element?.dataset?.tab ?? element?.dataset?.tabId ?? "";
    if (!tabId.startsWith(prefix)) return;
    const trackerId = tabId.slice(prefix.length);
    if (!trackerId || trackerIds.has(trackerId)) return;
    hideDowntimeTab($html, trackerId);
  });

  if (allowInsert && !tabNav?.length) {
    debugLog("Downtime fallback: no tab navigation found", { actorName: app?.actor?.name });
  }

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
    if (!root.length && canInsert) {
      root = ensureGenericSheetTab($html, tracker, tabNav);
      if (root?.length) insertedAny = true;
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

  if (insertedAny) {
    rebindSheetTabs(app, $html);
  }

  restorePendingTab(app, $html);
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

  const trackers = getInjectedTrackers();

  const trackerIds = new Set(trackers.map((tracker) => tracker.id));

  const prefix = `${SHEET_TAB_ID}-`;

  $html.find(`[data-tab^='${SHEET_TAB_ID}-']`).each((_, element) => {

    const tabId = element?.dataset?.tab ?? element?.dataset?.tabId ?? "";

    if (!tabId.startsWith(prefix)) return;

    const trackerId = tabId.slice(prefix.length);

    if (!trackerId || trackerIds.has(trackerId)) return;

    hideDowntimeTab($html, trackerId);

  });

  const tabNav = findSheetTabNav($html);

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

  if (game.system?.id !== "dnd5e" && game.system?.id !== "pf2e") {
    game.settings.registerMenu(MODULE_ID, SKILL_OVERRIDES_MENU, {
      name: "Manual Skill/Ability Overrides",
      label: "Manual Skill/Ability Overrides",
      icon: "fas fa-list",
      type: DowntimeRepSkillOverrides,
      restricted: true,
    });
  }

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
      refreshSceneControls();

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

  game.settings.register(MODULE_ID, MANUAL_SKILL_OVERRIDES_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: { skills: {}, abilities: {} },
    onChange: () => {
      rerenderCharacterSheets();
      rerenderSettingsApps();
    },
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

function getControlledActorId() {
  const token = canvas?.tokens?.controlled?.[0];
  return token?.actor?.id ?? "";
}

function getSceneControlList(controls) {
  if (Array.isArray(controls)) return controls;
  if (controls?.controls) {
    if (Array.isArray(controls.controls)) return controls.controls;
    if (controls.controls instanceof Map) {
      return Array.from(controls.controls.values());
    }
  }
  if (controls instanceof Map) {
    return Array.from(controls.values());
  }
  if (controls?.values && typeof controls.values === "function") {
    return Array.from(controls.values());
  }
  if (controls && typeof controls === "object") {
    return Object.values(controls).filter((entry) => entry && typeof entry === "object");
  }
  return [];
}

function addSceneControlTool(control, tool) {
  if (!control || !tool) return;
  const tools = control.tools;
  if (Array.isArray(tools)) {
    if (!tools.some((entry) => entry?.name === tool.name)) tools.push(tool);
    return;
  }
  if (tools instanceof Map) {
    if (!tools.has(tool.name)) tools.set(tool.name, tool);
    return;
  }
  if (tools && typeof tools === "object") {
    if (!tools[tool.name]) tools[tool.name] = tool;
    return;
  }
  control.tools = [tool];
}

Hooks.on("getSceneControlButtons", (controls) => {
  const controlList = getSceneControlList(controls);
  const tokenControls = controlList.find((control) =>
    control.name === "token" || control.name === "tokens"
  );
  if (!tokenControls) return;
  const trackers = getTrackers().filter((tracker) => !shouldInjectIntoSheet(tracker.id));
  if (!trackers.length) return;
  for (const tracker of trackers) {
    const toolName = `indy-downtime-${tracker.id}`;
    addSceneControlTool(tokenControls, {
      name: toolName,
      title: tracker.tabLabel || tracker.name || DEFAULT_TAB_LABEL,
      icon: tracker.tabIcon || DEFAULT_TAB_ICON,
      button: true,
      onClick: () => {
        openDowntimeDialog({
          trackerId: tracker.id,
          actorId: getControlledActorId(),
        });
      },
    });
  }
});

Hooks.on("renderCharacterActorSheet", async (app, html) => {
  if (shouldSkipRenderHook(html)) return;
  await renderDowntimeSheet(app, html, { allowInsert: false });
});

Hooks.on("renderActorSheet", async (app, html) => {
  if (shouldSkipRenderHook(html)) return;
  if (game.system?.id === "dnd5e" || game.system?.id === "pf2e") return;
  //if (app?.actor?.type !== "character" && app?.actor?.type.toLowerCase() !== "player") return;
  await renderDowntimeSheet(app, html, { allowInsert: true });
});

Hooks.on("renderActorSheetV2", async (app, html) => {
  if (shouldSkipRenderHook(html)) return;
  if (game.system?.id === "dnd5e" || game.system?.id === "pf2e") return;
  //if (app?.actor?.type.toLowerCase() !== "character" && app?.actor?.type.toLowerCase() !== "player") return;
  await renderDowntimeSheet(app, html, { allowInsert: true });
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

