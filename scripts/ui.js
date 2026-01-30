import {
  ApplicationV2,
  HandlebarsApplicationMixin,
} from "./foundry-app.js";
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
  getPhaseChecks,

  getPhaseNumber,

  getPhaseCheckChoices,
  getPhaseCheckById,
  getPhaseAvailableChecks,
  getCheckDependencyDetails,
  getCheckRollData,
  getPhaseCheckLabel,

  getPhaseCheckTarget,
  getDifficultyLabel,
  getNarrativeOutcomeLabel,

  getRestrictedActorUuids,

  getSkillLabel,
  getTrackers,

  getTrackerById,

  getWorldState,

  runIntervalRoll,
  runManualIntervalResult,

  grantCheckSuccessItems,
  grantPhaseCompletionItems,
  runCheckCompleteMacro,
  runPhaseCompleteMacro,

  setLastActorId,

  setLastSkillChoice,

  setWorldState,

  shouldHideDc,
  shouldInjectIntoSheet,
  shouldUseManualRolls,
  getCheckRollMode,

  shouldShowLockedChecks,
  shouldShowPhasePlan,
  normalizeItemRewards,

} from "./core-utils.js";



let tidyApi = null;

let tidyContextHooked = false;
let pendingTidyCleanupTabIds = new Set();
let lastKnownTrackerIds = new Set();

const pendingTabRestore = new WeakMap();

function getInjectedTrackers() {
  return getTrackers().filter((tracker) => shouldInjectIntoSheet(tracker.id));
}

function requestTabRestore(app, tabId) {
  if (!app || !tabId) return;
  pendingTabRestore.set(app, tabId);
  debugLog("Queued tab restore", {
    tabId,
    appClass: app?.constructor?.name,
  });
}

function consumePendingTabRestore(app) {
  if (!app) return "";
  const tabId = pendingTabRestore.get(app);
  if (!tabId) return "";
  pendingTabRestore.delete(app);
  return tabId;
}

function restorePendingTab(app, root) {
  const tabId = consumePendingTabRestore(app);
  if (!tabId) return;
  debugLog("Restoring pending tab", {
    tabId,
    appClass: app?.constructor?.name,
  });
  const restore = () => {
    restoreActiveTab(app, root, tabId);
    debugLog("Restore attempt completed", {
      tabId,
      appClass: app?.constructor?.name,
    });
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(restore));
  } else {
    setTimeout(restore, 0);
  }
}



function formatCheckOptionLabel(choice, showDc) {

  const name = choice.label || choice.skillLabel || "Check";

  const skill = choice.skillLabel && choice.skillLabel !== name ? choice.skillLabel : "";

  let dcText = "";
  if (showDc) {
    if (choice.difficultyLabel) {
      dcText = `Difficulty: ${choice.difficultyLabel}`;
    } else if (choice.dcLabel) {
      dcText = choice.dcLabel;
    } else if (Number.isFinite(choice.dc)) {
      dcText = `DC ${choice.dc}`;
    }
  }

  if (skill) {

    return dcText ? `${name} - ${skill} (${dcText})` : `${name} - ${skill}`;

  }

  return dcText ? `${name} (${dcText})` : name;

}

function escapeHtml(value) {
  const text = String(value ?? "");
  if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getItemNameFromUuid(uuid) {
  if (!uuid) return "";
  try {
    if (typeof fromUuidSync === "function") {
      const doc = fromUuidSync(uuid);
      const item = doc?.document ?? doc ?? null;
      if (item?.documentName === "Item") return item.name ?? "";
    }
  } catch (error) {
    // Ignore lookup errors and fall back to other options.
  }
  if (typeof uuid === "string" && uuid.startsWith("Item.")) {
    const id = uuid.split(".")[1];
    const item = game.items?.get(id) ?? null;
    if (item?.name) return item.name;
  }
  return "";
}

function buildRewardItemList(items) {
  const normalized = normalizeItemRewards(items);
  const totals = new Map();
  for (const entry of normalized) {
    if (!entry?.uuid) continue;
    const existing = totals.get(entry.uuid) ?? 0;
    totals.set(entry.uuid, existing + (entry.qty ?? 1));
  }
  return Array.from(totals.entries()).map(([uuid, qty]) => ({
    uuid,
    qty,
    name: getItemNameFromUuid(uuid),
  }));
}

function formatRewardLinks(items) {
  if (!items.length) return "";
  return items
    .map((entry) => {
      const name = entry.name || entry.uuid;
      const label = escapeHtml(name);
      const uuidAttr = escapeHtml(entry.uuid);
      const link = `<a class="content-link" data-uuid="${uuidAttr}" data-type="Item">${label}</a>`;
      return entry.qty > 1 ? `${link} x${entry.qty}` : link;
    })
    .join(", ");
}





function getActiveTabId(app, root) {

  const $context = root instanceof jQuery ? root : $(root);

  if ($context?.length) {

    const contentTab = $context.closest(".tab[data-tab], [data-tab][role='tabpanel']").first();

    const contentTabId = contentTab.data("tab") || contentTab.attr("data-tab") || "";

    if (contentTabId) {
      debugLog("Active tab from content", {
        tabId: contentTabId,
        appClass: app?.constructor?.name,
      });
      return contentTabId;
    }

  }

  const rootEl = app?.element ?? root?.closest?.(".app") ?? root;

  const $root = rootEl instanceof jQuery ? rootEl : $(rootEl);

  if ($root?.length) {

    const active = $root

      .find("[data-tab].active, .item.active[data-tab], [aria-selected='true'][data-tab]")

      .first();

    const tabId = active.data("tab") || active.attr("data-tab") || "";

    if (tabId) {
      debugLog("Active tab from DOM", {
        tabId,
        appClass: app?.constructor?.name,
      });
      return tabId;
    }

  }

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

    if (!controller) continue;

    if (typeof controller.active === "string" && controller.active) {
      debugLog("Active tab from controller", {
        tabId: controller.active,
        appClass: app?.constructor?.name,
      });
      return controller.active;
    }

    if (controller.active?.tab) {
      debugLog("Active tab from controller", {
        tabId: controller.active.tab,
        appClass: app?.constructor?.name,
      });
      return controller.active.tab;
    }

  }

  return "";

}



function restoreActiveTab(app, root, tabId) {

  if (!tabId) return;

  const rootEl = app?.element ?? root?.closest?.(".app") ?? root;

  const $root = rootEl instanceof jQuery ? rootEl : $(rootEl);

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

    if (!controller) continue;

    if (typeof controller.activate === "function") {

      try {

        controller.activate(tabId);

        return;

      } catch (error) {

        // ignore

      }

    }

    if (typeof controller.select === "function") {

      try {

        controller.select(tabId);

        return;

      } catch (error) {

        // ignore

      }

    }

  }

  const tabButton = $root.find(`[data-tab='${tabId}']`).first();

  if (tabButton.length) {

    tabButton.trigger("click");

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
  const rollMode = getCheckRollMode(resolvedTrackerId);

  const groupCounts = getGroupCheckCounts(state.log, activePhase.id);

  const displayLog = (state.log ?? []).map((entry) => {
    if (!entry || entry.type === "phase-complete") return entry;
    const outcomeLabel = entry.outcome
      ? getNarrativeOutcomeLabel(entry.outcome)
      : (entry.outcomeLabel ?? "");
    if (entry.dcLabel && entry.dcLabelType) {
      return outcomeLabel ? { ...entry, outcomeLabel } : entry;
    }
    if (rollMode === "d100" || rollMode === "narrative") {
      const difficultyLabel = entry.difficulty
        ? getDifficultyLabel(entry.difficulty)
        : (entry.dcLabel ?? "");
      return {
        ...entry,
        dcLabel: difficultyLabel,
        dcLabelType: "Difficulty",
        outcomeLabel,
      };
    }
    return {
      ...entry,
      dcLabel: entry.dcLabel ?? (Number.isFinite(entry.dc) ? String(entry.dc) : ""),
      dcLabelType: entry.dcLabelType ?? "DC",
      outcomeLabel,
    };
  });


  const checkChoices = getPhaseCheckChoices(
    activePhase,
    activePhase.checkProgress,
    { groupCounts, resolvedChecks: activePhase.resolvedChecks ?? {}, trackerId: resolvedTrackerId }
  ).map((choice) => ({

    ...choice,

    label: choice.label || "Unnamed Check",

  }));

  debugLog("Check choices", {
    trackerId: resolvedTrackerId,
    checkProgress: { ...activePhase.checkProgress },
    choices: checkChoices.map((choice) => ({
      id: choice.key,
      label: choice.label,
      complete: choice.complete,
      locked: choice.locked,
      dependsOn: choice.dependsOn,
    })),
  });




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

  const checkTooltips = {};

  const checkLockMap = new Map(checkChoices.map((choice) => [choice.key, { locked: choice.locked, complete: choice.complete }]));

  for (const choice of checkChoices) {

    checkTitles[choice.key] = choice.label;

    checkDescriptions[choice.key] = choice.description || "";

    const check = getPhaseCheckById(activePhase, choice.key);
    const depDetails = getCheckDependencyDetails(
      activePhase,
      check,
      activePhase.checkProgress,
      activePhase.resolvedChecks
    );
    if (depDetails.length) {
      const lines = depDetails.map((detail) => {
        const status = checkLockMap.get(detail.sourceId);
        const isGroup = detail.sourceKind === "group";
        const isLocked = isGroup ? !detail.complete : (Boolean(status?.locked) && !status?.complete);
        const displaySource = (!showLockedChecks && isLocked) ? "???" : detail.source;
        if (detail.type === "harder") {
          if (rollMode === "d100" || rollMode === "narrative") {
            const steps = Number.isFinite(detail.dcPenalty) ? Math.max(1, Math.round(detail.dcPenalty)) : 1;
            return `Increase Difficulty${steps > 1 ? ` (+${steps})` : ""} (from ${displaySource})`;
          }
          return `+${detail.dcPenalty} DC (from ${displaySource})`;
        }
        if (detail.type === "triumph") {
          return `Requires Triumph (from ${displaySource})`;
        }
        if (detail.type === "success") {
          return `Requires Success (from ${displaySource})`;
        }
        if (detail.type === "failure") {
          return `Requires Failure (from ${displaySource})`;
        }
        if (detail.type === "despair") {
          return `Requires Despair (from ${displaySource})`;
        }
        if (detail.type === "advantage") {
          return `Advantage (from ${displaySource})`;
        }
        if (detail.type === "disadvantage") {
          return `Disadvantage (from ${displaySource})`;
        }
        return "";
      }).filter(Boolean);
      checkTooltips[choice.key] = lines.join("\n");
    } else {
      checkTooltips[choice.key] = "";
    }

  }


  const selectedCheckTooltip = checkTooltips[selectedChoice?.key ?? preferredChoice] ?? "";

  const checkGroups = getPhaseGroups(activePhase).map((group) => {

    const checks = group.checks ?? [];

    const groupLimit = Number(group.maxChecks ?? 0);

    if (Number.isFinite(groupLimit) && groupLimit > 0) {
      const used = Number(groupCounts[group.id] ?? 0);
      const value = Math.min(used, groupLimit);
      const target = groupLimit;
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
    }

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

  const showRewardsOnSheet = Boolean(activePhase.showRewardsOnSheet);
  const phaseRewardItems = buildRewardItemList(activePhase.phaseCompleteItems ?? []);
  const checkRewardItems = buildRewardItemList(
    getPhaseChecks(activePhase).flatMap((check) => check?.checkSuccessItems ?? [])
  );
  const phaseRewardLinks = formatRewardLinks(phaseRewardItems);
  const checkRewardLinks = formatRewardLinks(checkRewardItems);



  return {

    trackerId: resolvedTrackerId,

    state: {
      ...state,
      log: displayLog,
    },

    activePhase,

    activePhaseNumber,

    showPhaseNumber: phaseConfig.length > 1,

    checkChoices,

    dropdownChoices,

    checkTitles,

    checkDescriptions,
    checkTooltips,

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
    showPhasePlan: game.user?.isGM || shouldShowPhasePlan(resolvedTrackerId),
    showEditPlan: game.user?.isGM,

    selectedCheckLabel,

    selectedCheckDescription,
    selectedCheckTooltip,

    showRewardsOnSheet,
    phaseRewardLinks,
    checkRewardLinks,

    sheetActor: actor ? { id: actor.id, name: actor.name } : null,

  };

}




function getGroupCheckCounts(logEntries, phaseId) {
  const counts = {};
  if (!Array.isArray(logEntries)) return counts;
  for (const entry of logEntries) {
    if (!entry || entry.type === "phase-complete") continue;
    if (phaseId && entry.phaseId && entry.phaseId !== phaseId) continue;
    if (entry.success !== true) continue;
    const groupId = entry.groupId;
    if (!groupId) continue;
    counts[groupId] = (counts[groupId] ?? 0) + 1;
  }
  return counts;
}

function attachTrackerListeners(html, { render, actor, app } = {}) {
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

  const resolvePlanActor = () => {
    if (actor) return actor;
    const actorId = scope.find("[data-drep-name='actorId']").val();
    if (!actorId) return null;
    return game.actors.get(actorId) ?? null;
  };

  const openPhasePlanFlow = (readOnly) => {
    if (!readOnly && !game.user?.isGM) {
      ui.notifications.warn("Indy Downtime Tracker: only a GM can edit the phase plan.");
      return;
    }
    const phaseConfig = getPhaseConfig(trackerId);
    const state = getWorldState(trackerId);
    const activePhase = getActivePhase(state, trackerId);
    const phase = phaseConfig.find((entry) => entry.id === activePhase?.id) || phaseConfig[0];
    if (!phase) return;
    const FlowClass = game?.indyDowntime?.DowntimeRepPhaseFlow;
    if (!FlowClass) {
      ui.notifications.warn("Indy Downtime Tracker: phase plan view is unavailable.");
      return;
    }
    const planActor = resolvePlanActor();
    new FlowClass({ trackerId, phaseId: phase.id, phase, readOnly, actor: planActor }).render(true);
  };

  scope.find("[data-drep-action='view-phase-plan']").on("click", (event) => {
    event.preventDefault();
    openPhasePlanFlow(true);
  });

  scope.find("[data-drep-action='edit-phase-plan']").on("click", (event) => {
    event.preventDefault();
    openPhasePlanFlow(false);
  });

  scope.find("[data-drep-action='roll-interval']").on("click", (event) => {
    event.preventDefault();
    debugLog("Roll click detected");
    handleRoll(scope, { render, actorOverride: actor, trackerId, app });
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
      scope.find(".drep-check-title-text").text(`Current Focus: ${title}`);
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

    const tooltip = scope
      .find(`[data-drep-check-tooltip='${selected}']`)
      .data("tooltip") || "";
    const tooltipEl = scope.find(".drep-check-tooltip");
    if (tooltip) {
      tooltipEl.attr("title", tooltip).show();
    } else {
      tooltipEl.attr("title", "").hide();
    }
  });
}

async function handleRoll(root, { render, actorOverride, trackerId, app } = {}) {

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



  const activeTabId = getActiveTabId(app, root);

  if (app && activeTabId) {
    requestTabRestore(app, activeTabId);
  }

    const rollMode = getCheckRollMode(resolvedTrackerId);
  const useManual = rollMode === "narrative" || shouldUseManualRolls(resolvedTrackerId);
  if (useManual) {
    const availableChecks = getPhaseAvailableChecks(
      activePhase,
      activePhase.checkProgress,
      activePhase.resolvedChecks
    );
    if (!availableChecks.length) {
      ui.notifications.warn("Indy Downtime Tracker: configure checks before rolling.");
      return;
    }
    let selectedCheck = checkChoice
      ? getPhaseCheckById(activePhase, checkChoice)
      : null;
    if (!selectedCheck || !availableChecks.find((check) => check.id === selectedCheck.id)) {
      selectedCheck = availableChecks[0] ?? null;
    }
    if (!selectedCheck) return;
    const rollData = getCheckRollData(
      activePhase,
      selectedCheck,
      activePhase.checkProgress,
      activePhase.resolvedChecks,
      resolvedTrackerId
    );
    const checkLabel = getPhaseCheckLabel(selectedCheck);
    const skillLabel = rollData.skill ? getSkillLabel(rollData.skill) : selectedCheck.skill;
    if (rollMode === "narrative") {
      const narrativeOutcome = await promptNarrativeOutcome({
        checkLabel,
        skillLabel,
      });
      if (narrativeOutcome === null) return;
      await runManualIntervalResult({
        actor,
        checkId: selectedCheck.id,
        checkChoice,
        trackerId: resolvedTrackerId,
        outcome: narrativeOutcome,
      });
    } else {
      const dcLabel = rollMode === "d100"
        ? (rollData.difficultyLabel ?? "")
        : (Number.isFinite(rollData.dc) ? String(rollData.dc) : "");
      const dcLabelType = rollMode === "d100" ? "Difficulty" : "DC";
      const outcome = await promptManualRoll({
        checkLabel,
        skillLabel,
        dc: rollData.dc,
        dcLabel,
        dcLabelType,
        advantage: rollData.advantage,
        disadvantage: rollData.disadvantage,
      });
      if (outcome === null) return;
      await runManualIntervalResult({
        actor,
        checkId: selectedCheck.id,
        checkChoice,
        trackerId: resolvedTrackerId,
        success: outcome,
      });
    }
  } else {
    await runIntervalRoll({
      actor,
      checkChoice,
      trackerId: resolvedTrackerId,
    });
  }



  if (render) {

    const result = render();

    if (result && typeof result.then === "function") {

      await result;

    }

  }

  if (!app && activeTabId) {

    setTimeout(() => restoreActiveTab(app, root, activeTabId), 0);

  }

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



function promptNarrativeOutcome({ checkLabel, skillLabel }) {
  const skillText = skillLabel ? `${skillLabel} check` : "the check";
  const content = `
      <div class="drep-manual-roll">
        <p><strong>${checkLabel}</strong></p>
        <p>Resolve ${skillText} and choose the outcome below.</p>
      </div>`;
  return new Promise((resolve) => {
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: "Narrative Outcome" },
      content,
      buttons: [
        {
          action: "triumph",
          label: "Triumph",
          callback: () => resolve("triumph"),
        },
        {
          action: "success",
          label: "Success",
          default: true,
          callback: () => resolve("success"),
        },
        {
          action: "failure",
          label: "Failure",
          callback: () => resolve("failure"),
        },
        {
          action: "despair",
          label: "Despair",
          callback: () => resolve("despair"),
        },
      ],
      close: () => resolve(null),
    });
    dialog.render(true);
  });
}

function promptManualRoll({ checkLabel, skillLabel, dc, dcLabel, dcLabelType, advantage, disadvantage }) {
  const rollHint = advantage
    ? "Roll with advantage."
    : (disadvantage ? "Roll with disadvantage." : "Roll normally.");
  const skillText = skillLabel ? `${skillLabel} check` : "the check";
  const targetLabel = dcLabel ?? (Number.isFinite(dc) ? String(dc) : "");
  const targetType = dcLabelType || "DC";
  const targetLine = targetLabel
    ? `Roll ${skillText} vs ${targetType} ${targetLabel}.`
    : `Roll ${skillText}.`;
  const content = `
      <div class="drep-manual-roll">
        <p><strong>${checkLabel}</strong></p>
        <p>${targetLine}</p>
        <p>${rollHint}</p>
        <p>Then choose the outcome below.</p>
      </div>`;
  return new Promise((resolve) => {
    const dialog = new foundry.applications.api.DialogV2({
      window: { title: "Manual Check" },
      content,
      buttons: [
        {
          action: "success",
          label: "Mark Success",
          default: true,
          callback: () => resolve(true),
        },
        {
          action: "failure",
          label: "Mark Failure",
          callback: () => resolve(false),
        },
      ],
      close: () => resolve(null),
    });
    dialog.render(true);
  });
}

function getDowntimeDialogId(trackerId) {
  const safeId = trackerId ? String(trackerId) : "tracker";
  return `indy-downtime-dialog-${safeId}`;
}

class DowntimeRepTrackerDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    const trackerId = options.trackerId ?? getCurrentTrackerId();
    if (trackerId && !options.id) {
      options.id = getDowntimeDialogId(trackerId);
    }
    super(options);
    this._trackerId = trackerId;
    this._actorId = options.actorId ?? "";
  }

  static DEFAULT_OPTIONS = {
    id: "indy-downtime-dialog",
    tag: "section",
    classes: ["indy-downtime", "drep-dialog"],
    window: {
      title: "Indy Downtime Tracker",
      icon: DEFAULT_TAB_ICON,
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: {
      width: 720,
      height: "auto",
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const trackerId = this._trackerId ?? getCurrentTrackerId();
    const tracker = getTrackerById(trackerId);
    const actor = this._actorId ? game.actors.get(this._actorId) : null;
    const showActorSelect = !actor;
    const data = buildTrackerData({
      actor,
      showActorSelect,
      embedded: true,
      trackerId,
    });
    if (actor?.id) data.lastActorId = actor.id;
    this.options.window.title = getHeaderLabel(trackerId);
    this.options.window.icon = tracker?.tabIcon || DEFAULT_TAB_ICON;
    return {
      ...context,
      ...data,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = $(this.element);
    const trackerId = this._trackerId ?? getCurrentTrackerId();
    const trackerIcon = getTrackerById(trackerId)?.tabIcon || DEFAULT_TAB_ICON;
    this.options.window.icon = trackerIcon;
    const appRoot = html.closest(".application").length ? html.closest(".application") : html;
    appRoot.find(".window-header .window-title i").remove();
    const windowIcon = appRoot.find(".window-header .window-icon").first();
    if (windowIcon.length) {
      windowIcon.attr("class", `window-icon fa-fw ${trackerIcon}`);
    } else {
      appRoot.find(".window-header").prepend(
        `<i class=\"window-icon fa-fw ${trackerIcon}\" inert></i>`
      );
    }
    attachTrackerListeners(html, { render: () => this.render(), app: this });
  }
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

    const className = String(sheetClass.name ?? "");
    const isTidySheet = className.includes("Tidy5e");
    if (isTidySheet) {
      if (Array.isArray(sheetClass.TABS)) {
        sheetClass.TABS = sheetClass.TABS.filter((tab) => {
          const tabId = String(tab.tab ?? "");
          if (tabId === SHEET_TAB_ID) return false;
          return !tabId.startsWith(`${SHEET_TAB_ID}-`);
        });
        if (!sheetClass.TABS.length) {
          delete sheetClass.TABS;
        }
      }
      if (sheetClass.PARTS && typeof sheetClass.PARTS === "object") {
        for (const key of Object.keys(sheetClass.PARTS)) {
          if (key === SHEET_TAB_ID || String(key).startsWith(`${SHEET_TAB_ID}-`)) {
            delete sheetClass.PARTS[key];
          }
        }
        if (!Object.keys(sheetClass.PARTS).length) {
          delete sheetClass.PARTS;
        }
      }
      continue;
    }

    const tabs = Array.isArray(sheetClass.TABS)

      ? sheetClass.TABS.filter((tab) => {

          const tabId = String(tab.tab ?? "");

          if (tabId === SHEET_TAB_ID) return false;

          return !tabId.startsWith(`${SHEET_TAB_ID}-`);

        })

      : null;
    if (!tabs) continue;

    const parts = { ...(sheetClass.PARTS ?? {}) };

    for (const key of Object.keys(parts)) {

      if (key === SHEET_TAB_ID || String(key).startsWith(`${SHEET_TAB_ID}-`)) {

        delete parts[key];

      }

    }

      for (const tracker of getInjectedTrackers()) {

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

    debugLog("Registered downtime tabs", { count: getInjectedTrackers().length });

  } else {

    debugLog("Character sheet class not found");

  }



  return updatedAny;

}



async function applyRequestedState(state, trackerId) {

  if (!state) return;

  const trackerKey = trackerId ?? getCurrentTrackerId();

  const prev = getWorldState(trackerKey);

  const buildCheckEntryKey = (entry) => {
    if (!entry || entry.type === "phase-complete") return "";
    const checkId = String(entry.checkId ?? "");
    const checkNumber = Number(entry.checkNumber);
    const timestamp = Number(entry.timestamp);
    const numberKey = Number.isFinite(checkNumber) ? checkNumber : "";
    const timeKey = Number.isFinite(timestamp) ? timestamp : "";
    if (!checkId && !numberKey && !timeKey) return "";
    return `${checkId}-${numberKey}-${timeKey}`;
  };

  const prevCompletionKeys = new Set(

    (prev.log ?? [])

      .filter((entry) => entry?.type === "phase-complete" && entry?.timestamp)

      .map((entry) => `${entry.phaseId}-${entry.timestamp}`)

  );
  const prevCheckKeys = new Set(
    (prev.log ?? [])
      .filter((entry) => entry && entry.type !== "phase-complete")
      .map((entry) => buildCheckEntryKey(entry))
      .filter(Boolean)
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

      await grantPhaseCompletionItems({
        phase,
        actor,
        actorId: entry.actorId,
        actorUuid: entry.actorUuid,
      });

      await runPhaseCompleteMacro({

        phase,

        actor,

        actorId: entry.actorId,

        actorName: entry.actorName,

        actorUuid: entry.actorUuid,

        trackerId: trackerKey,

      });

    }

    const checkEntries = (merged.log ?? []).filter(
      (entry) => entry && entry.type !== "phase-complete"
    );
    for (const entry of checkEntries) {
      const key = buildCheckEntryKey(entry);
      if (!key || prevCheckKeys.has(key)) continue;
      const phase = getPhaseDefinition(entry.phaseId, trackerKey);
      if (!phase) continue;
      const check = getPhaseCheckById(phase, entry.checkId);
      if (!check) continue;
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
      let result = "";
      if (typeof entry.outcome === "string" && entry.outcome) {
        result = entry.outcome;
      } else if (entry.success === true) {
        result = "success";
      } else if (entry.success === false) {
        result = "failure";
      }
      await grantCheckSuccessItems({
        check,
        actor,
        actorId: entry.actorId,
        actorUuid: entry.actorUuid,
        result,
      });
      await runCheckCompleteMacro({
        phase,
        check,
        actor,
        actorId: entry.actorId,
        actorName: entry.actorName,
        actorUuid: entry.actorUuid,
        trackerId: trackerKey,
        result,
        checkName: entry.checkName,
        phaseName: entry.phaseName,
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



  const trackers = getInjectedTrackers();

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
    enabled: () => false,

    getData: async (data) => {

      const base = (data && typeof data === "object") ? data : { tabs: [] };
      if (!Array.isArray(base.tabs)) base.tabs = [];

      return foundry.utils.mergeObject(base, { isAllowedActor: false }, {

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

function pruneTidySelectedTabs(removedTrackerIds) {
  if (!game?.modules?.get("tidy5e-sheet")?.active) return [];
  const removedTabIds = new Set(
    Array.isArray(removedTrackerIds)
      ? removedTrackerIds.map((id) => getTrackerTabId(id))
      : []
  );
  const activeTabIds = new Set(getInjectedTrackers().map((tracker) => getTrackerTabId(tracker.id)));
  const shouldRemoveTabId = (tabId) => {
    if (!tabId || typeof tabId !== "string") return false;
    if (removedTabIds.has(tabId)) return true;
    if (!tabId.startsWith(`${SHEET_TAB_ID}-`)) return false;
    return !activeTabIds.has(tabId);
  };
  const staleTabIds = new Set();
  const updates = [];
  if (game?.actors) {
    for (const actor of Array.from(game.actors)) {
      if (actor?.type !== "character") continue;
      const selected = actor.getFlag("tidy5e-sheet", "selected-tabs");
      if (Array.isArray(selected) && selected.length) {
        for (const tabId of selected) {
          if (shouldRemoveTabId(tabId)) staleTabIds.add(tabId);
        }
        const next = selected.filter((tabId) => !shouldRemoveTabId(tabId));
        if (next.length !== selected.length) {
          if (next.length) {
            updates.push(actor.setFlag("tidy5e-sheet", "selected-tabs", next));
          } else {
            updates.push(actor.unsetFlag("tidy5e-sheet", "selected-tabs"));
          }
        }
      }
      const tabConfig = actor.getFlag("tidy5e-sheet", "tab-configuration");
      if (tabConfig?.selected && Array.isArray(tabConfig.selected)) {
        for (const tabId of tabConfig.selected) {
          if (shouldRemoveTabId(tabId)) staleTabIds.add(tabId);
        }
        const next = tabConfig.selected.filter((tabId) => !shouldRemoveTabId(tabId));
        if (next.length !== tabConfig.selected.length) {
          const updated = { ...tabConfig, selected: next };
          if (next.length) {
            updates.push(actor.setFlag("tidy5e-sheet", "tab-configuration", updated));
          } else {
            updates.push(actor.unsetFlag("tidy5e-sheet", "tab-configuration"));
          }
        }
      }
      const sidebarConfig = actor.getFlag("tidy5e-sheet", "sidebar-tab-configuration");
      if (sidebarConfig?.selected && Array.isArray(sidebarConfig.selected)) {
        for (const tabId of sidebarConfig.selected) {
          if (shouldRemoveTabId(tabId)) staleTabIds.add(tabId);
        }
        const next = sidebarConfig.selected.filter((tabId) => !shouldRemoveTabId(tabId));
        if (next.length !== sidebarConfig.selected.length) {
          const updated = { ...sidebarConfig, selected: next };
          if (next.length) {
            updates.push(actor.setFlag("tidy5e-sheet", "sidebar-tab-configuration", updated));
          } else {
            updates.push(actor.unsetFlag("tidy5e-sheet", "sidebar-tab-configuration"));
          }
        }
      }
    }
  }

  if (game?.settings?.settings?.has("tidy5e-sheet.defaultCharacterSheetTabs")) {
    const currentDefaults = game.settings.get("tidy5e-sheet", "defaultCharacterSheetTabs");
    if (Array.isArray(currentDefaults)) {
      for (const tabId of currentDefaults) {
        if (shouldRemoveTabId(tabId)) staleTabIds.add(tabId);
      }
      const filteredDefaults = currentDefaults.filter((tabId) => !shouldRemoveTabId(tabId));
      if (filteredDefaults.length !== currentDefaults.length) {
        let nextDefaults = filteredDefaults;
        if (!nextDefaults.length) {
          const defaultSetting = game.settings.settings.get("tidy5e-sheet.defaultCharacterSheetTabs");
          const fallback = defaultSetting?.default;
          nextDefaults = Array.isArray(fallback) ? fallback : [];
        }
        updates.push(game.settings.set("tidy5e-sheet", "defaultCharacterSheetTabs", nextDefaults));
      }
    }
  }

  if (game?.settings?.settings?.has("tidy5e-sheet.initialCharacterSheetTab")) {
    const currentInitial = game.settings.get("tidy5e-sheet", "initialCharacterSheetTab");
    if (currentInitial && shouldRemoveTabId(currentInitial)) {
      staleTabIds.add(currentInitial);
    }
    if (currentInitial && shouldRemoveTabId(currentInitial)) {
      const defaults = game.settings.get("tidy5e-sheet", "defaultCharacterSheetTabs");
      let nextInitial = Array.isArray(defaults) ? defaults[0] : "";
      if (!nextInitial) {
        const defaultSetting = game.settings.settings.get("tidy5e-sheet.initialCharacterSheetTab");
        nextInitial = defaultSetting?.default ?? "";
      }
      if (nextInitial) {
        updates.push(game.settings.set("tidy5e-sheet", "initialCharacterSheetTab", nextInitial));
      }
    }
  }

  if (game?.settings?.settings?.has("tidy5e-sheet.tabConfiguration")) {
    const config = game.settings.get("tidy5e-sheet", "tabConfiguration");
    if (config && typeof config === "object") {
      const nextConfig = foundry.utils.deepClone(config);
      let changed = false;
      for (const entry of Object.values(nextConfig)) {
        if (!entry || typeof entry !== "object") continue;
        if (!Array.isArray(entry.selected)) continue;
        for (const tabId of entry.selected) {
          if (shouldRemoveTabId(tabId)) staleTabIds.add(tabId);
        }
        const next = entry.selected.filter((tabId) => !shouldRemoveTabId(tabId));
        if (next.length !== entry.selected.length) {
          entry.selected = next;
          changed = true;
        }
      }
      if (changed) {
        updates.push(game.settings.set("tidy5e-sheet", "tabConfiguration", nextConfig));
      }
    }
  }

  if (updates.length) {
    Promise.allSettled(updates).catch(() => {});
  }
  return Array.from(staleTabIds);
}

function stripStaleTidyTabs(context) {
  if (!context) return;
  const activeTabIds = new Set(getInjectedTrackers().map((tracker) => getTrackerTabId(tracker.id)));
  const shouldKeep = (tab) => {
    const tabId = tab?.id;
    if (!tabId || typeof tabId !== "string") return true;
    if (!tabId.startsWith(`${SHEET_TAB_ID}-`)) return true;
    return activeTabIds.has(tabId);
  };
  if (Array.isArray(context.tabs)) {
    context.tabs = context.tabs.filter(shouldKeep);
  }
  if (Array.isArray(context.sidebarTabs)) {
    context.sidebarTabs = context.sidebarTabs.filter(shouldKeep);
  }
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
      const base = (data && typeof data === "object") ? data : { tabs: [] };
      if (!Array.isArray(base.tabs)) base.tabs = [];

      debugLog("Tidy tab getData", {

        tabId,

        trackerId: tracker.id,

        trackerMissing,

        actorName: actor?.name,

      });

      if (trackerMissing) {

        return foundry.utils.mergeObject(base, { isAllowedActor: false }, {

          inplace: false,

          overwrite: true,

        });

      }

      if (!isActorAllowed(actor, tracker.id)) {

        return foundry.utils.mergeObject(base, { isAllowedActor: false }, {

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

      return foundry.utils.mergeObject(base, trackerData, {

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

        app: params.app,

      });

      restorePendingTab(params.app, root);

    },

  });

}



function updateTidyTabLabel() {
  if (!game?.modules?.get("tidy5e-sheet")?.active) return;

  const trackers = getInjectedTrackers();

  const nextIds = new Set(trackers.map((tracker) => tracker.id));
  const removedIds = Array.from(lastKnownTrackerIds).filter(
    (trackerId) => !nextIds.has(trackerId)
  );

  const staleTabIds = pruneTidySelectedTabs(removedIds);
  for (const tabId of staleTabIds) {
    pendingTidyCleanupTabIds.add(tabId);
  }
  for (const trackerId of removedIds) {
    pendingTidyCleanupTabIds.add(getTrackerTabId(trackerId));
  }

  if (!tidyApi?.registerCharacterTab || !tidyApi?.models?.HandlebarsTab) {

    debugLog("Tidy API not ready");
    lastKnownTrackerIds = nextIds;

    return;

  }

  debugLog("Updating tidy tabs", {

    count: trackers.length,

    ids: Array.from(nextIds),

  });

  for (const trackerId of removedIds) {

    tidyApi.registerCharacterTab(createTidyCleanupTab(tidyApi, trackerId), {

      overrideExisting: true,

    });

  }



  for (const tracker of trackers) {

    tidyApi.registerCharacterTab(createTidyTab(tidyApi, tracker), {

      overrideExisting: true,

    });

  }

  if (pendingTidyCleanupTabIds.size) {
    const prefix = `${SHEET_TAB_ID}-`;
    for (const tabId of Array.from(pendingTidyCleanupTabIds)) {
      if (!tabId.startsWith(prefix)) continue;
      const trackerId = tabId.slice(prefix.length);
      if (!trackerId) continue;
      tidyApi.registerCharacterTab(createTidyCleanupTab(tidyApi, trackerId), {
        overrideExisting: true,
      });
    }
    pendingTidyCleanupTabIds.clear();
  }



  lastKnownTrackerIds = nextIds;

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

    forceRenderApp(app, { focus: false });

  }

}



function rerenderSettingsApps(dofocus = false) {
  for (const app of getOpenApps()) {
    const appId = String(app?.id ?? app?.options?.id ?? "");
    if (!appId.startsWith("indy-downtime")) continue;
    if (appId === "indy-downtime-phase-config") continue;
    if (appId === "indy-downtime-settings") continue;
    if (appId === "indy-downtime-dep-editor") continue;
    if (appId === "indy-downtime-phase-flow") continue;
    forceRenderApp(app, { focus: dofocus });
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



function forceRenderApp(app, { focus = false } = {}) {
  if (typeof app?.render !== "function") return;

  try {
    if (app instanceof foundry.applications.api.ApplicationV2) {
      app.render({ force: true, focus });
      return;
    }
  } catch (error) {
    // fall through
  }

  try {
    app.render(true, { focus });
    return;
  } catch (error) {
    // fall through
  }

  try {
    app.render({ force: true });
  } catch (error) {
    // ignore
  }
}




function openDowntimeDialog({ trackerId, actorId } = {}) {
  const resolvedTrackerId = trackerId ?? getCurrentTrackerId();
  const appId = getDowntimeDialogId(resolvedTrackerId);
  const existing = getOpenApps().find((app) => {
    const id = String(app?.id ?? app?.options?.id ?? "");
    return id === appId;
  });
  if (existing) {
    if (existing instanceof DowntimeRepTrackerDialog) {
      existing._trackerId = resolvedTrackerId;
      existing._actorId = actorId ?? "";
    }
    forceRenderApp(existing, { focus: true });
    return existing;
  }
  const dialog = new DowntimeRepTrackerDialog({
    id: appId,
    trackerId: resolvedTrackerId,
    actorId,
  });
  dialog.render(true);
  return dialog;
}

function refreshSceneControls() {
  const controls = ui?.controls;
  const hasNewControl = controls && "control" in controls;
  const hasNewTool = controls && "tool" in controls;
  const activeControl = hasNewControl
    ? controls?.control?.name ?? null
    : (controls?.activeControl ?? controls?._activeControl ?? null);
  const activeTool = hasNewTool
    ? controls?.tool?.name ?? null
    : (controls?.activeTool ?? controls?._activeTool ?? null);
  const controlList = controls?.controls ?? controls?._controls ?? null;
  debugLog("refreshing scene controls", {
    hasControls: Boolean(controls),
    hasControlList: Boolean(controlList),
    activeControl,
    activeTool,
  });
  if (!controls) return;
  if (controlList) {
    Hooks.callAll("getSceneControlButtons", controlList);
  }
  if (typeof controls.render === "function") {
    try {
      controls.render({ force: true, controls: activeControl, tool: activeTool });
      return;
    } catch (error) {
      // fall through
    }
    try {
      controls.render(true);
      return;
    } catch (error) {
      // fall through
    }
  }
}

function registerTidyTab() {

  Hooks.once("tidy5e-sheet.ready", (api) => {

    if (!api?.registerCharacterTab || !api?.models?.HandlebarsTab) {

      debugLog("Tidy5e API not available");

      return;

    }



    tidyApi = api;
    const trackers = getInjectedTrackers();

    for (const tracker of trackers) {

      api.registerCharacterTab(createTidyTab(api, tracker), {
        overrideExisting: true,
      });

    }
    if (pendingTidyCleanupTabIds.size) {
      const prefix = `${SHEET_TAB_ID}-`;
      for (const tabId of Array.from(pendingTidyCleanupTabIds)) {
        if (!tabId.startsWith(prefix)) continue;
        const trackerId = tabId.slice(prefix.length);
        if (!trackerId) continue;
        api.registerCharacterTab(createTidyCleanupTab(api, trackerId), {
          overrideExisting: true,
        });
      }
      pendingTidyCleanupTabIds.clear();
    }
    lastKnownTrackerIds = new Set(trackers.map((tracker) => tracker.id));

    debugLog("Registered tidy5e downtime tab");

  });
  if (!tidyContextHooked) {
    tidyContextHooked = true;
    Hooks.on("tidy5e-sheet.prepareSheetContext", (_document, _app, context) => {
      stripStaleTidyTabs(context);
    });
  }

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
  attachTrackerListeners,
  buildTrackerData,
  handleSocketMessage,
  hideDowntimeTab,
  isActorAllowed,
  openDowntimeDialog,
  refreshSceneControls,
  registerSheetTab,
  registerTidyTab,
  refreshSheetTabLabel,
  restorePendingTab,
  rerenderCharacterSheets,
  rerenderSettingsApps,
  updateTidyTabLabel,
};
