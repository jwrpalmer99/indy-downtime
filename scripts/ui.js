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
  debugLog,
  getActivePhase,
  getCurrentTrackerId,
  getHeaderLabel,
  getIntervalLabel,
  getLastActorId,
  getLastSkillChoice,
  getPhaseConfig,
  getPhaseDefinition,
  getPhaseGroups,
  getPhaseNumber,
  getPhaseCheckChoices,
  getPhaseCheckTarget,
  getRestrictedActorUuids,
  getSkillAliases,
  getTrackers,
  getTrackerById,
  getWorldState,
  runIntervalRoll,
  runPhaseCompleteMacro,
  setLastActorId,
  setLastSkillChoice,
  setWorldState,
  shouldHideDc,
  shouldShowLockedChecks,
} from "./core-utils.js";

let tidyApi = null;
let registeredTidyTrackerIds = new Set();

function formatCheckOptionLabel(choice, showDc) {
  const name = choice.label || choice.skillLabel || "Check";
  const skill = choice.skillLabel && choice.skillLabel !== name ? choice.skillLabel : "";
  const dcText = showDc ? `DC ${choice.dc}` : "";
  if (skill) {
    return dcText ? `${name} - ${skill} (${dcText})` : `${name} - ${skill}`;
  }
  return dcText ? `${name} (${dcText})` : name;
}




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

  const showDc = game.user?.isGM || !shouldHideDc(resolvedTrackerId);
  const showLockedChecks = game.user?.isGM || shouldShowLockedChecks(resolvedTrackerId);

  const checkChoices = getPhaseCheckChoices(
    activePhase,
    activePhase.checkProgress,
    skillAliases
  ).map((choice) => ({
    ...choice,
    label: choice.label || "Unnamed Check",
  }));

  const dropdownChoices = checkChoices
    .filter((choice) => !choice.complete && (showLockedChecks || !choice.locked))
    .map((choice) => ({
      ...choice,
      optionLabel: formatCheckOptionLabel(choice, showDc),
    }));
  const availableChoices = dropdownChoices.filter((choice) => !choice.locked);
  const lastCheckChoice = getLastSkillChoice(resolvedTrackerId);
  const preferredChoice = availableChoices.some(
    (choice) => choice.key === lastCheckChoice
  )
    ? lastCheckChoice
    : availableChoices[0]?.key || dropdownChoices[0]?.key || "";

  const selectedChoice = checkChoices.find(
    (choice) => choice.key === preferredChoice
  );
  const selectedCheckLabel = selectedChoice?.label ?? "";
  const selectedCheckDescription = selectedChoice?.description ?? "";

  const checkTitles = {};
  const checkDescriptions = {};
  for (const choice of checkChoices) {
    checkTitles[choice.key] = choice.label;
    checkDescriptions[choice.key] = choice.description || "";
  }

  const checkGroups = getPhaseGroups(activePhase).map((group) => {
    const checks = group.checks ?? [];
    let value = 0;
    let target = 0;
    for (const check of checks) {
      const checkTarget = getPhaseCheckTarget(check);
      target += checkTarget;
      const current = Math.min(
        Number(activePhase.checkProgress?.[check.id] ?? 0),
        checkTarget
      );
      value += current;
    }
    const percent = target > 0
      ? Math.min(100, Math.round((value / target) * 100))
      : 0;
    return {
      id: group.id,
      name: group.name || "Group",
      value,
      target,
      percent,
    };
  });

  const progressPercent =
    activePhase.target > 0
      ? Math.min(
          100,
          Math.round((activePhase.progress / activePhase.target) * 100)
        )
      : 0;
  const canRoll = !activePhase.completed && availableChoices.length > 0;

  return {
    trackerId: resolvedTrackerId,
    state,
    activePhase,
    activePhaseNumber,
    showPhaseNumber: phaseConfig.length > 1,
    checkChoices,
    dropdownChoices,
    checkTitles,
    checkDescriptions,
    checkGroups,
    actors,
    lastActorId,
    lastCheckChoice: preferredChoice,
    progressPercent,
    canRoll,
    showActorSelect,
    embedded,
    headerLabel,
    showDc,
    intervalLabel: getIntervalLabel(resolvedTrackerId),
    selectedCheckLabel,
    selectedCheckDescription,
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

  scope.find("[data-drep-name='checkChoice']").on("change", (event) => {
    const selected = $(event.currentTarget).val();
    if (selected) {
      setLastSkillChoice(trackerId, selected);
    }
    const title = scope
      .find(`[data-drep-check-title='${selected}']`)
      .data("title") || "";
    if (title) {
      scope.find(".drep-check-title").text(`Current Focus: ${title}`);
    }
    const description = scope
      .find(`[data-drep-check-description='${selected}']`)
      .data("description") || "";
    const descEl = scope.find(".drep-check-description");
    if (description) {
      descEl.text(description).show();
    } else {
      descEl.text("").hide();
    }
  });
}

async function handleRoll(root, { render, actorOverride, trackerId } = {}) {
  const resolvedTrackerId = trackerId ?? getCurrentTrackerId();
  const state = getWorldState(resolvedTrackerId);
  const activePhase = getActivePhase(state, resolvedTrackerId);

  if (activePhase.completed) {
    ui.notifications.warn("Indy Downtime Tracker: this phase is already complete.");
    return;
  }

  const actor = resolveActor(root, actorOverride);
  if (!actor) return;

  setLastActorId(resolvedTrackerId, actor.id);

  const checkChoice = root.find("[data-drep-name='checkChoice']").val();
  if (checkChoice) {
    setLastSkillChoice(resolvedTrackerId, checkChoice);
  }
  if (!checkChoice) {
    ui.notifications.warn("Indy Downtime Tracker: configure checks before rolling.");
    return;
  }

  await runIntervalRoll({
    actor,
    checkChoice,
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
  const prev = getWorldState(trackerKey);
  const prevCompletionKeys = new Set(
    (prev.log ?? [])
      .filter((entry) => entry?.type === "phase-complete" && entry?.timestamp)
      .map((entry) => `${entry.phaseId}-${entry.timestamp}`)
  );
  const merged = foundry.utils.mergeObject(DEFAULT_STATE, state, {
    inplace: false,
    overwrite: true,
  });
  await setWorldState(merged, trackerKey);
  if (game.user?.isGM) {
    const completions = (merged.log ?? []).filter(
      (entry) => entry?.type === "phase-complete" && entry?.timestamp
    );
    for (const entry of completions) {
      const key = `${entry.phaseId}-${entry.timestamp}`;
      if (prevCompletionKeys.has(key)) continue;
      const phase = getPhaseDefinition(entry.phaseId, trackerKey);
      let actor = null;
      if (entry.actorUuid) {
        try {
          const doc = await fromUuid(entry.actorUuid);
          actor = doc?.document ?? doc ?? actor;
        } catch (error) {
          // ignore
        }
      }
      if (!actor && entry.actorId) {
        actor = game.actors.get(entry.actorId) ?? null;
      }
      await runPhaseCompleteMacro({
        phase,
        actor,
        actorId: entry.actorId,
        actorName: entry.actorName,
        actorUuid: entry.actorUuid,
        trackerId: trackerKey,
      });
    }
  }
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