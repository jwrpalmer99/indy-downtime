import { Application } from "./foundry-ui.js";
import {
  DEFAULT_STATE,
  DEFAULT_TAB_ICON,
  DEFAULT_TAB_LABEL,
  SHEET_TAB_ID,
  SOCKET_EVENT_REQUEST,
  SOCKET_EVENT_STATE,
  TIDY_TEMPLATE_PATH,
  getTrackerTabId,
} from "./constants.js";
import {
  buildPhase1SkillData,
  debugLog,
  getActivePhase,
  getCurrentTrackerId,
  getForcedSkillChoice,
  getHeaderLabel,
  getIntervalLabel,
  getLastActorId,
  getLastSkillChoice,
  getNextOrderedSkillChoice,
  getNextSkillTitle,
  getPhaseConfig,
  getPhase1SkillProgress,
  getPhaseNumber,
  getPhasePenaltyInfo,
  getPhaseSkillChoices,
  getPhaseSkillTarget,
  getRestrictedActorUuids,
  getSkillAliases,
  getSkillLabel,
  getTrackers,
  getTrackerById,
  getWorldState,
  resolveSkillKey,
  runIntervalRoll,
  setLastActorId,
  setLastSkillChoice,
  setWorldState,
  shouldHideDc,
  getPhaseDc
} from "./core-utils.js";

let tidyApi = null;
let registeredTidyTrackerIds = new Set();




class DowntimeRepApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "indy-downtime-app",
      title: "Indy Downtime Tracker",
      template: "modules/indy-downtime/templates/indy-downtime.hbs",
      width: 740,
      height: "auto",
      classes: ["indy-downtime"],
    });
  }

  getData() {
    return buildTrackerData({ showActorSelect: true, embedded: false });
  }

  activateListeners(html) {
    super.activateListeners(html);
    attachTrackerListeners(html, { render: () => this.render() });
  }
}

function buildTrackerData({
  actor = null,
  showActorSelect = true,
  embedded = false,
  trackerId = null,
} = {}) {
  const resolvedTrackerId = trackerId ?? getCurrentTrackerId();
  const phaseConfig = getPhaseConfig(resolvedTrackerId);
  const state = getWorldState(resolvedTrackerId);
  const activePhase = getActivePhase(state, resolvedTrackerId);
  const activePhaseNumber = getPhaseNumber(activePhase.id, resolvedTrackerId);
  const skillAliases = getSkillAliases();
  const headerLabel = getHeaderLabel(resolvedTrackerId);
  const lastActorId = showActorSelect
    ? getLastActorId(resolvedTrackerId)
    : actor?.id ?? "";
  const actors = showActorSelect
    ? game.actors
        .filter((entry) => entry.type === "character")
        .map((entry) => ({ id: entry.id, name: entry.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  let skillChoices = getPhaseSkillChoices(activePhase, skillAliases).map((choice) => ({
    ...choice,
    dc: getPhaseDc(activePhase, choice.key),
  }));
  if (activePhase.id === "phase1") {
    const progress = getPhase1SkillProgress(activePhase);
    skillChoices = skillChoices.filter((choice) => {
      const target = getPhaseSkillTarget(activePhase, choice.key);
      return (progress[choice.key] ?? 0) < target;
    });
  }
  const skillLabels = skillChoices.reduce((acc, choice) => {
    acc[choice.key] = choice.label;
    return acc;
  }, {});
  const skillTitles = skillChoices.reduce((acc, choice) => {
    acc[choice.key] = getNextSkillTitle(activePhase, choice.key, skillLabels);
    return acc;
  }, {});
  const orderedSkillChoice = getNextOrderedSkillChoice(activePhase);
  const forcedSkillChoice =
    getForcedSkillChoice(activePhase) || orderedSkillChoice;
  const lastSkillChoice = getLastSkillChoice(resolvedTrackerId);
  const preferredSkillChoice = skillChoices.some(
    (choice) => choice.key === lastSkillChoice
  )
    ? lastSkillChoice
    : skillChoices[0]?.key || "";
  const availableSkillKeys = skillChoices.map((choice) => choice.key);
  const selectedSkillKey =
    forcedSkillChoice && availableSkillKeys.includes(forcedSkillChoice)
      ? forcedSkillChoice
      : preferredSkillChoice;
  const enforceOrder = Boolean(activePhase.enforceCheckOrder);
  const selectedSkillTitle = getNextSkillTitle(
    activePhase,
    selectedSkillKey,
    skillLabels
  );
  const phase1Penalty = getPhasePenaltyInfo(activePhase, skillLabels);

  const showDc = game.user?.isGM || !shouldHideDc(resolvedTrackerId);
  const progressPercent =
    activePhase.target > 0
      ? Math.min(
          100,
          Math.round((activePhase.progress / activePhase.target) * 100)
        )
      : 0;
  const forcedSkillLabel = forcedSkillChoice
    ? getSkillLabel(resolveSkillKey(forcedSkillChoice, skillAliases))
    : "";
  const canRoll = !activePhase.completed && skillChoices.length > 0;
  const phase1Skills =
    activePhase.id === "phase1"
      ? buildPhase1SkillData(activePhase, skillLabels)
      : [];

  return {
    trackerId: resolvedTrackerId,
    state,
    activePhase,
    activePhaseNumber,
    showPhaseNumber: phaseConfig.length > 1,
    skillLabels,
    skillTitles,
    skillChoices,
    actors,
    lastActorId,
    lastSkillChoice: preferredSkillChoice,
    progressPercent,
    forcedSkillChoice,
    enforceOrder,
    forcedSkillLabel,
    canRoll,
    showActorSelect,
    embedded,
    phase1Skills,
    headerLabel,
    showDc,
    intervalLabel: getIntervalLabel(resolvedTrackerId),
    selectedSkillTitle,
    phase1Penalty,
    sheetActor: actor ? { id: actor.id, name: actor.name } : null,
  };
}

function attachTrackerListeners(html, { render, actor } = {}) {
  const root = html.find("[data-drep-root]").first();
  const scope = root.length ? root : html;
  const trackerId =
    scope.data("drepTracker") ||
    scope.find("[data-drep-tracker]").data("drepTracker") ||
    getCurrentTrackerId();

  scope.find(".always-interactive").each((_, element) => {
    if (element?.dataset?.drepDisabled === "true") return;
    element.disabled = false;
  });
  debugLog("Listeners attached", {
    rollButtons: scope.find("[data-drep-action='roll-interval']").length,
  });

  scope.find("[data-drep-action='roll-interval']").on("click", (event) => {
    event.preventDefault();
    debugLog("Roll click detected");
    handleRoll(scope, { render, actorOverride: actor, trackerId });
  });

  scope.find("[data-drep-name='skillChoice']").on("change", (event) => {
    const selected = $(event.currentTarget).val();
    if (selected) {
      setLastSkillChoice(trackerId, selected);
    }
    const title = scope.find(`[data-drep-skill-title='${selected}']`).data("title") || "";
    if (!title) return;
    scope.find(".drep-skill-title").text(`Current Focus: ${title}`);
  });
}

async function handleRoll(root, { render, actorOverride, trackerId } = {}) {
  const resolvedTrackerId = trackerId ?? getCurrentTrackerId();
  const phaseConfig = getPhaseConfig(resolvedTrackerId);
  const state = getWorldState(resolvedTrackerId);
  const activePhase = getActivePhase(state, resolvedTrackerId);
  if (activePhase.completed) {
    ui.notifications.warn("Indy Downtime Tracker: this phase is already complete.");
    return;
  }

  const actor = resolveActor(root, actorOverride);
  if (!actor) return;

  setLastActorId(resolvedTrackerId, actor.id);

  const skillChoice = root.find("[data-drep-name='skillChoice']").val();
  if (skillChoice) {
    setLastSkillChoice(resolvedTrackerId, skillChoice);
  }
  if (!skillChoice) {
    ui.notifications.warn("Indy Downtime Tracker: configure skills before rolling.");
    return;
  }

  await runIntervalRoll({
    actor,
    skillChoice,
    trackerId: resolvedTrackerId,
  });

  if (render) render();
}

function resolveActor(root, actorOverride) {
  if (actorOverride) return actorOverride;
  const actorId = root.find("[data-drep-name='actorId']").val();
  if (!actorId) {
    ui.notifications.warn("Indy Downtime Tracker: select an actor.");
    return null;
  }
  const actor = game.actors.get(actorId);
  if (!actor) {
    ui.notifications.warn("Indy Downtime Tracker: actor not found.");
    return null;
  }
  return actor;
}

function resolveActorFromContext(context) {
  if (!context) return null;
  return (
    context.actor ??
    context.document ??
    context.app?.actor ??
    context.sheet?.actor ??
    context.context?.actor ??
    null
  );
}

function registerSheetTab() {
  if (game.system?.id !== "dnd5e") return false;
  const sheetClasses = new Set();
  const baseClass =
    globalThis.dnd5e?.applications?.actor?.CharacterActorSheet ??
    CONFIG.DND5E?.applications?.actor?.CharacterActorSheet ??
    null;
  if (baseClass) sheetClasses.add(baseClass);

  const registered = CONFIG.Actor?.sheetClasses?.character ?? {};
  for (const entry of Object.values(registered)) {
    const cls = entry?.cls ?? entry?.class ?? entry?.sheetClass ?? null;
    if (typeof cls === "function") {
      sheetClasses.add(cls);
    }
  }

  let updatedAny = false;
  for (const sheetClass of sheetClasses) {
    if (!sheetClass) continue;
    const tabs = Array.isArray(sheetClass.TABS)
      ? sheetClass.TABS.filter((tab) => {
          const tabId = String(tab.tab ?? "");
          if (tabId === SHEET_TAB_ID) return false;
          return !tabId.startsWith(`${SHEET_TAB_ID}-`);
        })
      : [];
    const parts = { ...(sheetClass.PARTS ?? {}) };
    for (const key of Object.keys(parts)) {
      if (key === SHEET_TAB_ID || String(key).startsWith(`${SHEET_TAB_ID}-`)) {
        delete parts[key];
      }
    }
    for (const tracker of getTrackers()) {
      const tabId = getTrackerTabId(tracker.id);
      if (!tabs.some((tab) => tab.tab === tabId)) {
        tabs.push({
          tab: tabId,
          label: tracker.tabLabel || DEFAULT_TAB_LABEL,
          icon: tracker.tabIcon || DEFAULT_TAB_ICON,
        });
      } else {
        for (const tab of tabs) {
          if (tab.tab === tabId) {
            tab.label = tracker.tabLabel || DEFAULT_TAB_LABEL;
          }
        }
      }
      if (!parts[tabId]) {
        parts[tabId] = {
          container: { classes: ["tab-body"], id: "tabs" },
          template: "modules/indy-downtime/templates/indy-downtime.hbs",
          scrollable: [""],
        };
      }
    }
    sheetClass.TABS = tabs;
    sheetClass.PARTS = parts;
    updatedAny = true;
  }

  if (updatedAny) {
    debugLog("Registered downtime tabs", { count: getTrackers().length });
  } else {
    debugLog("Character sheet class not found");
  }

  return updatedAny;
}

async function applyRequestedState(state, trackerId) {
  if (!state) return;
  const trackerKey = trackerId ?? getCurrentTrackerId();
  const merged = foundry.utils.mergeObject(DEFAULT_STATE, state, {
    inplace: false,
    overwrite: true,
  });
  await setWorldState(merged, trackerKey);
  rerenderCharacterSheets();
  rerenderSettingsApps();
}

function handleSocketMessage(payload) {
  if (!payload) return;
  if (payload.type === SOCKET_EVENT_STATE) {
    if (payload.userId && payload.userId === game.user?.id) return;
    debugLog("Received state update notification");
    rerenderCharacterSheets();
    rerenderSettingsApps();
    return;
  }
  if (payload.type === SOCKET_EVENT_REQUEST) {
    if (!game.user?.isGM) return;
    debugLog("Received state update request", { userId: payload.userId });
    applyRequestedState(payload.state, payload.trackerId);
  }
}

function refreshSheetTabLabel() {
  registerSheetTab();
  updateSheetTabLabel();
  updateTidyTabLabel();
  rerenderCharacterSheets();
}

function updateSheetTabLabel() {
  if (game.system?.id !== "dnd5e") return;
  const sheetClass =
    globalThis.dnd5e?.applications?.actor?.CharacterActorSheet ??
    CONFIG.DND5E?.applications?.actor?.CharacterActorSheet ??
    null;
  if (!sheetClass || !Array.isArray(sheetClass.TABS)) return;

  const trackers = getTrackers();
  let changed = false;
  const updatedTabs = sheetClass.TABS.map((tab) => {
    const tracker = trackers.find(
      (entry) => getTrackerTabId(entry.id) === tab.tab
    );
    if (!tracker) return tab;
    const tabLabel = tracker.tabLabel || DEFAULT_TAB_LABEL;
    if (tab.label === tabLabel) return tab;
    changed = true;
    return { ...tab, label: tabLabel };
  });

  if (changed) {
    sheetClass.TABS = updatedTabs;
  }
}


function createTidyCleanupTab(api, trackerId) {
  const tabId = getTrackerTabId(trackerId);
  return new api.models.HandlebarsTab({
    title: "Downtime",
    iconClass: DEFAULT_TAB_ICON,
    tabId,
    path: TIDY_TEMPLATE_PATH,
    getData: async (data) => {
      return foundry.utils.mergeObject(data ?? {}, { isAllowedActor: false }, {
        inplace: false,
        overwrite: true,
      });
    },
    onRender: (params) => {
      const root = $(params.app?.element ?? []);
      hideDowntimeTab(root, trackerId);
    },
  });
}

function createTidyTab(api, tracker) {
  const tabId = getTrackerTabId(tracker.id);
  const currentTracker = getTrackerById(tracker.id);
  const trackerMissing = !currentTracker;
  debugLog("Tidy tab build", {
    tabId,
    trackerId: tracker.id,
    trackerMissing,
  });

  return new api.models.HandlebarsTab({
    title: tracker.tabLabel || DEFAULT_TAB_LABEL,
    iconClass: tracker.tabIcon || DEFAULT_TAB_ICON,
    tabId,
    path: TIDY_TEMPLATE_PATH,
    getData: async (data) => {
      const actor = resolveActorFromContext(data);
      debugLog("Tidy tab getData", {
        tabId,
        trackerId: tracker.id,
        trackerMissing,
        actorName: actor?.name,
      });
      if (trackerMissing) {
        return foundry.utils.mergeObject(data ?? {}, { isAllowedActor: false }, {
          inplace: false,
          overwrite: true,
        });
      }
      if (!isActorAllowed(actor, tracker.id)) {
        return foundry.utils.mergeObject(data ?? {}, { isAllowedActor: false }, {
          inplace: false,
          overwrite: true,
        });
      }
      const trackerData = buildTrackerData({
        actor,
        showActorSelect: false,
        embedded: true,
        trackerId: tracker.id,
      });
      return foundry.utils.mergeObject(data ?? {}, trackerData, {
        inplace: false,
        overwrite: true,
      });
    },
    onRender: (params) => {
      const actor = resolveActorFromContext(params);
      debugLog("Tidy tab onRender", {
        tabId,
        trackerId: tracker.id,
        trackerMissing,
        actorName: actor?.name,
      });
      if (trackerMissing) {
        const root = $(params.app?.element ?? []);
        hideDowntimeTab(root, tracker.id);
        return;
      }
      if (!isActorAllowed(actor, tracker.id)) {
        const root = $(params.app?.element ?? []);
        hideDowntimeTab(root, tracker.id);
        return;
      }
      const root = $(params.tabContentsElement);
      debugLog("Tidy5e downtime tab ready", {
        rollButtons: root.find("[data-drep-action='roll-interval']").length,
        actorName: actor?.name,
      });
      attachTrackerListeners(root, {
        render: () => params.app.render(),
        actor,
      });
    },
  });
}

function updateTidyTabLabel() {
  if (!tidyApi?.registerCharacterTab || !tidyApi?.models?.HandlebarsTab) {
    debugLog("Tidy API not ready");
    return;
  }
  const trackers = getTrackers();
  const nextIds = new Set(trackers.map((tracker) => tracker.id));
  debugLog("Updating tidy tabs", {
    count: trackers.length,
    ids: Array.from(nextIds),
  });

  for (const trackerId of registeredTidyTrackerIds) {
    if (nextIds.has(trackerId)) continue;
    tidyApi.registerCharacterTab(createTidyCleanupTab(tidyApi, trackerId), {
      overrideExisting: true,
    });
  }

  for (const tracker of trackers) {
    tidyApi.registerCharacterTab(createTidyTab(tidyApi, tracker), {
      overrideExisting: true,
    });
  }

  registeredTidyTrackerIds = nextIds;
  cleanupStaleSheetTabs(nextIds);
}


function cleanupStaleSheetTabs(trackerIds) {
  if (!trackerIds || !trackerIds.size) return;
  for (const app of getOpenApps()) {
    const root = $(app?.element ?? []);
    if (!root.length) continue;
    root.find(`[data-tab^='${SHEET_TAB_ID}-']`).each((_, element) => {
      const tabId = element?.dataset?.tab ?? element?.dataset?.tabId ?? "";
      if (!tabId.startsWith(`${SHEET_TAB_ID}-`)) return;
      const trackerId = tabId.slice(`${SHEET_TAB_ID}-`.length);
      if (trackerIds.has(trackerId)) return;
      hideDowntimeTab(root, trackerId);
    });
  }
}

function rerenderCharacterSheets() {
  for (const app of getOpenApps()) {
    const actor = app?.actor ?? app?.document;
    if (!actor || actor.type !== "character") continue;
    forceRenderApp(app);
  }
}

function rerenderSettingsApps() {
  for (const app of getOpenApps()) {
    const appId = String(app?.id ?? app?.options?.id ?? "");
    if (!appId.startsWith("indy-downtime")) continue;
	if (appId == "indy-downtime-phase-config") return;
    forceRenderApp(app);
  }
}

function getOpenApps() {
  const apps = [];
  if (ui?.windows) {
    apps.push(...Object.values(ui.windows));
  }
  const instances = foundry?.applications?.instances;
  if (instances) {
    if (instances instanceof Map) {
      apps.push(...instances.values());
    } else if (typeof instances === "object") {
      apps.push(...Object.values(instances));
    }
  }
  return [...new Set(apps)].filter(Boolean);
}

function forceRenderApp(app) {
  if (typeof app?.render !== "function") return;
  try {
    app.render({ force: true });
    return;
  } catch (error) {
    // fall through
  }
  try {
    app.render(true);
    return;
  } catch (error) {
    // fall through
  }
  try {
    app.render();
  } catch (error) {
    debugLog("Failed to re-render app", { appClass: app?.constructor?.name });
  }
}

function registerTidyTab() {
  Hooks.once("tidy5e-sheet.ready", (api) => {
    if (!api?.registerCharacterTab || !api?.models?.HandlebarsTab) {
      debugLog("Tidy5e API not available");
      return;
    }

    tidyApi = api;
    for (const tracker of getTrackers()) {
      api.registerCharacterTab(createTidyTab(api, tracker));
    }
    debugLog("Registered tidy5e downtime tab");
  });
}

function isActorAllowed(actor, trackerId) {
  const restricted = getRestrictedActorUuids(trackerId);
  if (!restricted.length) return true;
  if (!actor?.uuid) return false;
  return restricted.includes(actor.uuid);
}

function hideDowntimeTab($html, trackerId) {
  if (!$html?.length) return;
  const tabId = trackerId ? getTrackerTabId(trackerId) : SHEET_TAB_ID;
  $html.find(`.tabs [data-tab='${tabId}']`).remove();
  $html.find(`[data-tab='${tabId}'].tab`).remove();
  $html.find(`[data-tab='${tabId}'].tab-body`).remove();
  $html
    .find("[data-tab], [data-tab-id], [data-tabid], [data-tab-target]")
    .each((_, element) => {
      const tab =
        element.dataset?.tab ??
        element.dataset?.tabId ??
        element.dataset?.tabid ??
        element.dataset?.tabTarget ??
        "";
      if (tab === tabId) {
        $(element).remove();
      }
    });
}

export {
  DowntimeRepApp,
  applyRequestedState,
  attachTrackerListeners,
  buildTrackerData,
  createTidyTab,
  forceRenderApp,
  getOpenApps,
  handleSocketMessage,
  hideDowntimeTab,
  isActorAllowed,
  registerSheetTab,
  registerTidyTab,
  refreshSheetTabLabel,
  rerenderCharacterSheets,
  rerenderSettingsApps,
  resolveActor,
  resolveActorFromContext,
  updateSheetTabLabel,
  updateTidyTabLabel,
};
