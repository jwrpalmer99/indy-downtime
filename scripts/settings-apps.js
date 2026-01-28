import { ApplicationV2, HandlebarsApplicationMixin } from "./foundry-app.js";
import {
  DEFAULT_HEADER_LABEL,
  DEFAULT_TAB_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_TAB_ICON,
  DEFAULT_TRACKER_NAME,
  DEFAULT_STATE,
  MODULE_ID,
  MANUAL_SKILL_OVERRIDES_SETTING,
  DEFAULT_PHASE_CONFIG,
  TRACKERS_SETTING,
} from "./constants.js";
import {
  addTracker,
  debugLog,
  applyPhaseConfigFormData,
  applySettingsImportPayload,
  applyStateImportPayload,
  applyStateOverridesFromForm,
  buildNewPhase,
  getCurrentTracker,
  getCurrentTrackerId,
  getFirstPhaseId,
  getHeaderLabel,
  getIntervalLabel,
  getPhaseConfig,
  getPhaseGroups,
  getPhaseNumber,
  getActivePhase,
  getPhaseChecks,
  getCheckRollData,
  getPhaseDc,
  isCheckUnlocked,
  isCheckComplete,
  isDependencyComplete,
  getPhaseCheckLabel,
  getPhaseCheckTarget,
  getRestrictedActorUuids,
  getSkillLabel,
  getSkillOptions,
  getTabIcon,
  getTabLabel,
  getTrackerById,
  getTrackers,
  getWorldState,
  normalizePhaseConfig,
  normalizeCheckDependencies,
  parseJsonPayload,
  parseRestrictedActorUuids,
  parseList,
  recalculateStateFromLog,
  removeCurrentTracker,
  resetPhaseState,
  sanitizeLabel,
  saveJsonToFile,
  setCurrentTrackerId,
  setTrackerPhaseConfig,
  setWorldState,
  normalizeManualSkillOverrides,
  shouldHideDc,
  shouldShowCheckTooltips,
  shouldShowFuturePlans,
  shouldShowLockedChecks,
  getModuleCheckRollMode,
  getCheckRollMode,
  getDifficultyLabel,
  getDifficultyOptions,
  getActorCheckBonus,
  getCheckSuccessChance,
  getNarrativeOutcomeLabel,
  normalizeNarrativeOutcome,
  isNarrativeOutcomeSuccess,
  updateTrackerSettings,
  getSettingsExportPayload,
  getStateExportPayload,
} from "./core-utils.js";
import {
  refreshSheetTabLabel,
  registerSheetTab,
  rerenderCharacterSheets,
  rerenderSettingsApps,
  updateTidyTabLabel,
} from "./ui.js";
import { normalizeProjectState } from "./core/state.js";

const confirmDialogV2 = ({ title, content, yesLabel = "Yes", noLabel = "Cancel" }) =>
  new Promise((resolve) => {
    const dialog = new foundry.applications.api.DialogV2({
      window: { title },
      content: `<div>${content}</div>`,
      buttons: [
        {
          action: "yes",
          label: yesLabel,
          default: true,
          callback: () => resolve(true),
        },
        {
          action: "no",
          label: noLabel,
          callback: () => resolve(false),
        },
      ],
      close: () => resolve(false),
    });
    dialog.render(true);
  });

const serializeOverrideLines = (map = {}) =>
  Object.entries(map)
    .map(([key, label]) => {
      const cleanKey = String(key ?? "").trim();
      if (!cleanKey) return "";
      const cleanLabel = typeof label === "string" ? label.trim() : "";
      if (cleanLabel && cleanLabel !== cleanKey) {
        return `${cleanKey}: ${cleanLabel}`;
      }
      return cleanKey;
    })
    .filter(Boolean)
    .join("\n");

const parseOverrideLines = (raw, { stripAbilityPrefix = false } = {}) => {
  const output = {};
  if (!raw) return output;
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [left, ...rest] = trimmed.split(":");
    let key = left.trim();
    let label = rest.join(":").trim();
    if (stripAbilityPrefix && key.startsWith("ability:")) {
      key = key.slice("ability:".length);
    }
    if (!key) continue;
    if (!label) label = key;
    output[key] = label;
  }
  return output;
};

const formatSignedNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric >= 0 ? `+${numeric}` : `${numeric}`;
};

const buildPotentialRollData = (phase, check, checkProgress, resolvedChecks = {}, trackerId = null) => {
  const deps = normalizeCheckDependencies(check?.dependsOn ?? []);
  if (!deps.length) return null;
  const hasIncomplete = deps.some((dep) => !isDependencyComplete(phase, dep, checkProgress, resolvedChecks));
  if (!hasIncomplete) return null;
  const rollMode = getCheckRollMode(trackerId);
  let advantage = false;
  let disadvantage = false;
  let overrideSkill = "";
  let overrideDc = null;
  let overrideDifficulty = "";
  let dcPenalty = 0;
  for (const dep of deps) {
    switch (dep.type) {
      case "harder":
        break;
      case "advantage":
        advantage = true;
        break;
      case "disadvantage":
        break;
      case "override":
        if (dep.overrideSkill) overrideSkill = dep.overrideSkill;
        if (Number.isFinite(dep.overrideDc)) overrideDc = dep.overrideDc;
        if (typeof dep.overrideDc === "string") overrideDifficulty = dep.overrideDc;
        break;
      default:
        break;
    }
  }
  if (advantage && disadvantage) {
    advantage = false;
    disadvantage = false;
  }
  if (rollMode === "d100" || rollMode === "narrative") {
    const baseDifficulty = check?.difficulty ?? "";
    const difficulty = overrideDifficulty || baseDifficulty;
    return {
      skill: overrideSkill || check?.skill || "",
      difficulty,
      difficultyLabel: getDifficultyLabel(difficulty),
      advantage,
      disadvantage,
      dcPenalty,
      overrideSkill,
      overrideDc,
    };
  }
  const baseDc = getPhaseDc(phase, check);
  let dc = Number.isFinite(overrideDc) ? overrideDc : baseDc;
  if (dcPenalty) {
    dc += dcPenalty;
  }
  return {
    skill: overrideSkill || check?.skill || "",
    dc,
    advantage,
    disadvantage,
    dcPenalty,
    overrideSkill,
    overrideDc,
  };
};

const buildDcTooltip = ({ actor, rollData, baseDc, redacted, potentialRollData, allowTooltip, trackerId }) => {
  if (!allowTooltip || !actor || !rollData || !rollData.skill || redacted) return "";
  const rollMode = getCheckRollMode(trackerId);
  if (rollMode === "d100" || rollMode === "narrative") {
    const lines = [];
    const skillLabel = getSkillLabel(rollData.skill);
    if (skillLabel) {
      lines.push(`Skill: ${skillLabel}`);
    }
    const difficultyLabel = rollData.difficultyLabel || getDifficultyLabel(rollData.difficulty ?? baseDc);
    if (difficultyLabel) {
      lines.push(`Difficulty: ${difficultyLabel}`);
    }
    if (potentialRollData?.difficulty && potentialRollData.difficulty !== rollData.difficulty) {
      lines.push(`If deps complete: ${getDifficultyLabel(potentialRollData.difficulty)}`);
    }
    if (rollData.advantage) lines.push("Advantage");
    if (rollData.disadvantage) lines.push("Disadvantage");
    return lines.join("\n");
  }
  const bonus = getActorCheckBonus(actor, rollData.skill);
  if (!Number.isFinite(bonus)) return "";
  const chance = getCheckSuccessChance({
    dc: rollData.dc,
    bonus,
    advantage: rollData.advantage,
    disadvantage: rollData.disadvantage,
    trackerId,
  });
  if (!Number.isFinite(chance)) return "";
  const lines = [];
  const skillLabel = getSkillLabel(rollData.skill);
  const bonusText = formatSignedNumber(bonus);
  if (skillLabel) {
    lines.push(`Skill: ${skillLabel}${bonusText ? ` (${bonusText})` : ""}`);
  } else if (bonusText) {
    lines.push(`Bonus: ${bonusText}`);
  }
  const dcValue = Number(rollData.dc);
  const baseValue = Number(baseDc);
  if (Number.isFinite(dcValue)) {
    if (Number.isFinite(baseValue) && baseValue && baseValue !== dcValue) {
      lines.push(`DC: ${dcValue} (base ${baseValue})`);
    } else {
      lines.push(`DC: ${dcValue}`);
    }
  }
  lines.push(`Success: ${Math.round(chance * 100)}%`);
  if (rollData.advantage) lines.push("Advantage");
  if (rollData.disadvantage) lines.push("Disadvantage");
  if (potentialRollData?.skill) {
    const potentialBonus = getActorCheckBonus(actor, potentialRollData.skill);
    const potentialChance = getCheckSuccessChance({
      dc: potentialRollData.dc,
      bonus: potentialBonus,
      advantage: potentialRollData.advantage,
      disadvantage: potentialRollData.disadvantage,
      trackerId,
    });
    if (Number.isFinite(potentialChance)) {
      const currentPercent = Math.round(chance * 100);
      const potentialPercent = Math.round(potentialChance * 100);
      if (potentialPercent !== currentPercent) {
        const details = [];
        if (potentialRollData.skill !== rollData.skill || potentialBonus !== bonus) {
          const potentialSkillLabel = getSkillLabel(potentialRollData.skill);
          const potentialBonusText = formatSignedNumber(potentialBonus);
          if (potentialSkillLabel) {
            details.push(`${potentialSkillLabel}${potentialBonusText ? ` ${potentialBonusText}` : ""}`);
          } else if (potentialBonusText) {
            details.push(`Bonus ${potentialBonusText}`);
          }
        }
        if (Number.isFinite(potentialRollData.dc) && potentialRollData.dc !== rollData.dc) {
          details.push(`DC ${potentialRollData.dc}`);
        }
        if (potentialRollData.advantage && !rollData.advantage) details.push("Advantage");
        if (potentialRollData.disadvantage && !rollData.disadvantage) details.push("Disadvantage");
        if (!potentialRollData.disadvantage && rollData.disadvantage) details.push("No Disadvantage");
        const detailText = details.length ? ` (${details.join(", ")})` : "";
        lines.push(`If deps complete: ${potentialPercent}%${detailText}`);
      }
    }
  }
  return lines.join("\n");
};

class DowntimeRepSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "indy-downtime-settings",
    tag: "form",
    classes: ["indy-downtime", "drep-settings"],
    window: {
      title: "Indy Downtime Tracker Settings",
      icon: "fas fa-fire",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: {
      width: 520,
      height: "auto",
    },
    form: {
      handler: DowntimeRepSettings._onSubmit,
      closeOnSubmit: false,
      submitOnChange: false,
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime-settings.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const trackerId = getCurrentTrackerId();
    const tracker = getTrackerById(trackerId) ?? getCurrentTracker();
    const state = getWorldState(trackerId);
    const displayLog = (state.log ?? []).map((entry) => {
      if (!entry || entry.type === "phase-complete") return entry;
      const outcomeLabel = entry.outcome
        ? getNarrativeOutcomeLabel(entry.outcome)
        : (entry.outcomeLabel ?? "");
      if (!outcomeLabel) return entry;
      return { ...entry, outcomeLabel };
    });
    const displayState = { ...state, log: displayLog };
    const headerLabel = getHeaderLabel(trackerId);
    const tabLabel = getTabLabel(trackerId);
    const intervalLabel = getIntervalLabel(trackerId);
    const restrictedActorUuids = getRestrictedActorUuids(trackerId);
    const trackerOptions = getTrackers().map((entry, index) => ({
      id: entry.id,
      label: entry.name ? `${entry.name}` : `Tracker ${index + 1}`,
    }));
    const moduleCheckRollMode = getModuleCheckRollMode();

    return {
      ...context,
      trackerOptions,
      currentTrackerId: trackerId,
      trackerName: tracker?.name ?? DEFAULT_TRACKER_NAME,
      trackerTabIcon: getTabIcon(trackerId),
      trackerCheckRollMode: tracker?.checkRollMode ?? "",
      moduleCheckRollMode,
      hideDcFromPlayers: Boolean(tracker?.hideDcFromPlayers),
      showLockedChecksToPlayers: tracker?.showLockedChecksToPlayers !== false,
      showPhasePlanToPlayers: Boolean(tracker?.showPhasePlanToPlayers),
      showFuturePlansToPlayers: Boolean(tracker?.showFuturePlansToPlayers),
      showCheckTooltipsToPlayers: Boolean(tracker?.showCheckTooltipsToPlayers),
      showFlowRelationships: tracker?.showFlowRelationships !== false,
      showFlowLines: tracker?.showFlowLines !== false,
      isSingleTracker: trackerOptions.length <= 1,
      state: displayState,
      criticalBonusEnabled: state.criticalBonusEnabled,
      isNarrativeMode: getCheckRollMode(trackerId) === "narrative",
      headerLabel,
      tabLabel,
      intervalLabel,
      restrictedActorUuidsText: restrictedActorUuids.join("\n"),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = $(this.element);
    const trackerId = getCurrentTrackerId();
    const trackerIcon = getTabIcon(trackerId) || "fas fa-fire";
    this.options.window.icon = trackerIcon;
    const appRoot = html.closest(".application").length ? html.closest(".application") : html;
    appRoot.find(".window-header .window-title i").remove();
    const windowIcon = appRoot.find(".window-header .window-icon").first();
    if (windowIcon.length) {
      windowIcon.attr("class", `window-icon fa-fw ${trackerIcon}`);
    }

    html.find("[name='currentTrackerId']").on("change", (event) => {
      const selected = $(event.currentTarget).val();
      if (!selected) return;
      setCurrentTrackerId(selected);
      const nextIcon = getTabIcon(selected) || "fas fa-fire";
      this.options.window.icon = nextIcon;
      const appRoot = html.closest(".application").length ? html.closest(".application") : html;
      appRoot.find(".window-header .window-title i").remove();
      const windowIcon = appRoot.find(".window-header .window-icon").first();
      if (windowIcon.length) {
        windowIcon.attr("class", `window-icon fa-fw ${nextIcon}`);
      }
      this.render();
    });

    html.find("[name='tabIcon']").on("input change", (event) => {
      const raw = String($(event.currentTarget).val() ?? "").trim();
      const nextIcon = raw || "fas fa-fire";
      this.options.window.icon = nextIcon;
      const appRoot = html.closest(".application").length ? html.closest(".application") : html;
      appRoot.find(".window-header .window-title i").remove();
      const windowIcon = appRoot.find(".window-header .window-icon").first();
      if (windowIcon.length) {
        windowIcon.attr("class", `window-icon fa-fw ${nextIcon}`);
      } else {
        appRoot.find(".window-header").prepend(
          `<i class=\"window-icon fa-fw ${nextIcon}\" inert></i>`
        );
      }
    });
    html.find("[data-drep-drop='actor-uuids']").on("dragover", (event) => {
      event.preventDefault();
    });
    html.find("[data-drep-drop='actor-uuids']").on("drop", (event) => {
      event.preventDefault();
      const data = TextEditor.getDragEventData(event.originalEvent ?? event);
      const uuid = data?.uuid ?? (data?.type === "Actor" ? `Actor.${data.id}` : "");
      if (!uuid) return;
      const textarea = html.find("[data-drep-drop='actor-uuids']").first();
      const existing = parseRestrictedActorUuids(textarea.val());
      if (existing.includes(uuid)) return;
      existing.push(uuid);
      textarea.val(existing.join("\n"));
    });
    html.find("[data-drep-action]").on("click", async (event) => {
      event.preventDefault();
      const action = event.currentTarget?.dataset?.drepAction;
      if (!action) return;
      if (action === "add-tracker") {
        await addTracker();
        registerSheetTab();
        updateTidyTabLabel();
        rerenderCharacterSheets();
        this.render();
        return;
      }
      if (action === "remove-tracker") {
        if (getTrackers().length <= 1) return;
        const confirmed = await confirmDialogV2({
          title: "Remove Tracker",
          content: "<p>Remove the current tracker? This cannot be undone.</p>",
        });
        if (!confirmed) return;
        await removeCurrentTracker();
        registerSheetTab();
        updateTidyTabLabel();
        rerenderCharacterSheets();
        this.render();
        return;
      }
  
      if (action === "tracker-import-export") {
        const tracker = getCurrentTracker();
        const trackerId = tracker?.id ?? getCurrentTrackerId();
        new DowntimeRepImportExportDialog({
          trackerId,
          title: "Indy Downtime Tracker: Export/Import Tracker",
          notes: "Export or import only the current tracker's settings.",
          filename: "indy-downtime-tracker.json",
          getPayload: () => ({
            module: MODULE_ID,
            version: game.modules.get(MODULE_ID)?.version ?? "",
            exportedAt: new Date().toISOString(),
            tracker: {
              id: tracker?.id ?? trackerId,
              name: tracker?.name,
              headerLabel: tracker?.headerLabel,
              tabLabel: tracker?.tabLabel,
              intervalLabel: tracker?.intervalLabel,
              tabIcon: tracker?.tabIcon,
              checkRollMode: tracker?.checkRollMode,
              hideDcFromPlayers: tracker?.hideDcFromPlayers,
              showLockedChecksToPlayers: tracker?.showLockedChecksToPlayers,
              showPhasePlanToPlayers: tracker?.showPhasePlanToPlayers,
              showFuturePlansToPlayers: tracker?.showFuturePlansToPlayers,
              showCheckTooltipsToPlayers: tracker?.showCheckTooltipsToPlayers,
              showFlowRelationships: tracker?.showFlowRelationships,
              showFlowLines: tracker?.showFlowLines,
              restrictedActorUuids: tracker?.restrictedActorUuids ?? [],
              phaseConfig: tracker?.phaseConfig ?? [],
            },
          }),
          applyPayload: async (parsed) => {
            const payload = parsed?.tracker ?? parsed;
            if (!payload || typeof payload !== "object") {
              ui.notifications.error("Indy Downtime Tracker: invalid tracker payload.");
              return;
            }
            const currentTracker = getTrackerById(trackerId) ?? getCurrentTracker();
            const incomingNameRaw = typeof payload.name === "string" ? payload.name : "";
            const incomingName = incomingNameRaw
              ? sanitizeLabel(incomingNameRaw, DEFAULT_TRACKER_NAME)
              : "";
            const currentName = typeof currentTracker?.name === "string" ? currentTracker.name.trim() : "";
            const shouldCreateNew = Boolean(incomingName && currentName && incomingName !== currentName);

            const ensureUniqueTrackerId = (baseId) => {
              const trackers = getTrackers();
              const existing = new Set(trackers.map((entry) => entry.id));
              let nextId = String(baseId ?? "").trim();
              if (!nextId) {
                nextId = `tracker-${trackers.length + 1}`;
              }
              if (!existing.has(nextId)) return nextId;
              let index = 2;
              while (existing.has(`${nextId}-${index}`)) {
                index += 1;
              }
              return `${nextId}-${index}`;
            };

            const updates = {};
            if (incomingName) updates.name = incomingName;
            if (typeof payload.headerLabel === "string") updates.headerLabel = sanitizeLabel(payload.headerLabel, DEFAULT_HEADER_LABEL);
            if (typeof payload.tabLabel === "string") updates.tabLabel = sanitizeLabel(payload.tabLabel, DEFAULT_TAB_LABEL);
            if (typeof payload.intervalLabel === "string") updates.intervalLabel = sanitizeLabel(payload.intervalLabel, DEFAULT_INTERVAL_LABEL);
            if (typeof payload.tabIcon === "string") updates.tabIcon = sanitizeLabel(payload.tabIcon, DEFAULT_TAB_ICON);
            if (typeof payload.checkRollMode === "string") updates.checkRollMode = payload.checkRollMode.trim();
            if (typeof payload.hideDcFromPlayers !== "undefined") updates.hideDcFromPlayers = Boolean(payload.hideDcFromPlayers);
            if (typeof payload.showLockedChecksToPlayers !== "undefined") updates.showLockedChecksToPlayers = Boolean(payload.showLockedChecksToPlayers);
            if (typeof payload.showPhasePlanToPlayers !== "undefined") updates.showPhasePlanToPlayers = Boolean(payload.showPhasePlanToPlayers);
            if (typeof payload.showFuturePlansToPlayers !== "undefined") updates.showFuturePlansToPlayers = Boolean(payload.showFuturePlansToPlayers);
            if (typeof payload.showCheckTooltipsToPlayers !== "undefined") updates.showCheckTooltipsToPlayers = Boolean(payload.showCheckTooltipsToPlayers);
            if (typeof payload.showFlowRelationships !== "undefined") updates.showFlowRelationships = Boolean(payload.showFlowRelationships);
            if (typeof payload.showFlowLines !== "undefined") updates.showFlowLines = Boolean(payload.showFlowLines);
            if (Array.isArray(payload.restrictedActorUuids)) {
              updates.restrictedActorUuids = parseRestrictedActorUuids(payload.restrictedActorUuids);
            }
            if (payload.manualSkillOverrides && typeof payload.manualSkillOverrides === "object") {
              await game.settings.set(MODULE_ID, MANUAL_SKILL_OVERRIDES_SETTING, payload.manualSkillOverrides);
            }
            if (shouldCreateNew) {
              const phaseConfig = Array.isArray(payload.phaseConfig)
                ? normalizePhaseConfig(payload.phaseConfig)
                : normalizePhaseConfig(DEFAULT_PHASE_CONFIG);
              const newTrackerId = ensureUniqueTrackerId(
                typeof payload.id === "string" ? payload.id : ""
              );
              const newTracker = {
                id: newTrackerId,
                name: updates.name ?? DEFAULT_TRACKER_NAME,
                headerLabel: updates.headerLabel ?? DEFAULT_HEADER_LABEL,
                tabLabel: updates.tabLabel ?? DEFAULT_TAB_LABEL,
                intervalLabel: updates.intervalLabel ?? DEFAULT_INTERVAL_LABEL,
                tabIcon: updates.tabIcon ?? DEFAULT_TAB_ICON,
                checkRollMode: updates.checkRollMode ?? "",
                hideDcFromPlayers: updates.hideDcFromPlayers ?? false,
                showLockedChecksToPlayers: updates.showLockedChecksToPlayers ?? true,
                showPhasePlanToPlayers: updates.showPhasePlanToPlayers ?? false,
                showFuturePlansToPlayers: updates.showFuturePlansToPlayers ?? false,
                showCheckTooltipsToPlayers: updates.showCheckTooltipsToPlayers ?? false,
                showFlowRelationships: updates.showFlowRelationships ?? true,
                showFlowLines: updates.showFlowLines ?? true,
                restrictedActorUuids: updates.restrictedActorUuids ?? [],
                phaseConfig,
                state: normalizeProjectState(DEFAULT_STATE, phaseConfig),
              };
              const trackers = getTrackers();
              trackers.push(newTracker);
              await game.settings.set(MODULE_ID, TRACKERS_SETTING, trackers);
              setCurrentTrackerId(newTrackerId);
              registerSheetTab();
              updateTidyTabLabel();
              refreshSheetTabLabel();
              rerenderCharacterSheets();
              rerenderSettingsApps();
              this.render();
              ui.notifications.info("Indy Downtime Tracker: tracker imported as new.");
              return;
            }
            if (Object.keys(updates).length) {
              updateTrackerSettings(trackerId, updates);
            }
            if (Array.isArray(payload.phaseConfig)) {
              setTrackerPhaseConfig(trackerId, normalizePhaseConfig(payload.phaseConfig));
            }
            refreshSheetTabLabel();
            rerenderCharacterSheets();
            rerenderSettingsApps();
            this.render();
            ui.notifications.info("Indy Downtime Tracker: tracker imported.");
          },
        }).render(true);
        return;
      }
      if (action === "open-phase-config") {
        new DowntimeRepPhaseConfig({
          trackerId: getCurrentTrackerId(),
        }).render(true);
        return;
      }
      if (action === "open-progress-state") {
        new DowntimeRepProgressState({
          trackerId: getCurrentTrackerId(),
        }).render(true);
        return;
      }
      if (action === "log-recalc") {
        this.#handleLogRecalc();
        return;
      }
      if (action.startsWith("log-")) {
        this.#handleLogAction(action, event.currentTarget?.dataset);
        return;
      }
      this.#handleMaintenanceAction(action);
    });
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object ?? {});
    await this._processFormData(data);
  }

  async _processFormData(formData) {
    const trackerId = formData.currentTrackerId ?? getCurrentTrackerId();
    if (trackerId && trackerId !== getCurrentTrackerId()) {
      setCurrentTrackerId(trackerId);
    }
    const phaseConfig = getPhaseConfig(trackerId);
    const state = getWorldState(trackerId);
    const trackerName = sanitizeLabel(
      formData.trackerName,
      getTrackerById(trackerId)?.name ?? DEFAULT_TRACKER_NAME
    );
    if (Object.prototype.hasOwnProperty.call(formData, "criticalBonusEnabled")) {
      state.criticalBonusEnabled = Boolean(formData.criticalBonusEnabled);
    }


    applyStateOverridesFromForm(state, formData, phaseConfig);
    setTrackerPhaseConfig(trackerId, phaseConfig);

    await setWorldState(state, trackerId);
    updateTrackerSettings(trackerId, {
      name: trackerName,
      headerLabel: sanitizeLabel(formData.headerLabel, DEFAULT_HEADER_LABEL),
      tabLabel: sanitizeLabel(formData.tabLabel, DEFAULT_TAB_LABEL),
      intervalLabel: sanitizeLabel(formData.intervalLabel, DEFAULT_INTERVAL_LABEL),
      tabIcon: sanitizeLabel(formData.tabIcon, DEFAULT_TAB_ICON),
      checkRollMode: typeof formData.checkRollMode === "string" ? formData.checkRollMode.trim() : "",
      hideDcFromPlayers: Boolean(formData.hideDcFromPlayers),
      showLockedChecksToPlayers: Boolean(formData.showLockedChecksToPlayers),
      showPhasePlanToPlayers: Boolean(formData.showPhasePlanToPlayers),
      showFuturePlansToPlayers: Boolean(formData.showFuturePlansToPlayers),
      showCheckTooltipsToPlayers: Boolean(formData.showCheckTooltipsToPlayers),
      showFlowRelationships: Boolean(formData.showFlowRelationships),
      showFlowLines: Boolean(formData.showFlowLines),
      restrictedActorUuids: parseRestrictedActorUuids(
        formData.restrictedActorUuids
      ),
    });
    refreshSheetTabLabel();
    ui.notifications.info("Indy Downtime Tracker: settings saved.");
  }

  async #handleMaintenanceAction(action) {
    if (!action) return;

    const prompts = {
      "reset-progress": {
        title: "Reset Phase Progress",
        content:
          "<p>Reset progress, completion, and failure streaks for all phases?</p>",
      },
      "reset-log": {
        title: "Clear Activity Log",
        content: "<p>Clear all recorded downtime checks?</p>",
      },
      "reset-checks": {
        title: "Reset Check Count",
        content: "<p>Reset the check counter back to zero?</p>",
      },
      "reset-phase-config": {
        title: "Reset Phase Configuration",
        content: "<p>Restore the default phase configuration?</p>",
      },
      "reset-all": {
        title: "Reset All Tracking",
        content:
          "<p>Reset phases, log, and check count, and set the active phase to Phase 1?</p>",
      },
    };

    const prompt = prompts[action];
    if (!prompt) return;

    const confirmed = await confirmDialogV2({
      title: prompt.title,
      content: prompt.content,
    });
    if (!confirmed) return;

    const trackerId = getCurrentTrackerId();
    const phaseConfig = getPhaseConfig(trackerId);
    const state = getWorldState(trackerId);

    switch (action) {
      case "reset-progress":
        resetPhaseState(state, phaseConfig);
        break;
      case "reset-log":
        state.log = [];
        break;
      case "reset-checks":
        state.checkCount = 0;
        break;
      case "reset-phase-config":
        setTrackerPhaseConfig(trackerId, DEFAULT_PHASE_CONFIG);
        break;
      case "reset-all":
        resetPhaseState(state, phaseConfig);
        state.log = [];
        state.checkCount = 0;
        state.activePhaseId = getFirstPhaseId(trackerId, phaseConfig);
        state.journalId = "";
        break;
      default:
        return;
    }

    await setWorldState(state, trackerId);
    this.render();
    ui.notifications.info("Indy Downtime Tracker: maintenance action applied.");
  }

  async #handleLogAction(action, dataset) {
    const index = Number(dataset?.logIndex);
    if (!Number.isFinite(index)) return;

    const trackerId = getCurrentTrackerId();
    const state = getWorldState(trackerId);
    if (!Array.isArray(state.log) || !state.log[index]) return;

    if (action === "log-delete") {
      const confirmed = await confirmDialogV2({
        title: "Remove Log Entry",
        content: "<p>Remove this log entry and recalculate progress?</p>",
      });
      if (!confirmed) return;
      state.log.splice(index, 1);
    } else if (action === "log-toggle") {
      const entry = state.log[index];
      if (getCheckRollMode(trackerId) === "narrative") {
        const outcomes = ["triumph", "success", "failure", "despair"];
        const current = normalizeNarrativeOutcome(entry.outcome)
          || (entry.success ? "success" : "failure");
        const currentIndex = outcomes.indexOf(current);
        const next = outcomes[(currentIndex + 1) % outcomes.length] ?? "success";
        entry.outcome = next;
        entry.outcomeLabel = getNarrativeOutcomeLabel(next);
        entry.success = isNarrativeOutcomeSuccess(next);
        if (!entry.success) {
          entry.criticalBonusApplied = false;
        }
      } else {
        entry.success = !entry.success;
        if (!entry.success) {
          entry.criticalBonusApplied = false;
        }
      }
    } else {
      return;
    }

    const recalculated = recalculateStateFromLog(state, trackerId);
    await setWorldState(recalculated, trackerId);
    this.render();
    ui.notifications.info("Indy Downtime Tracker: log updated.");
  }

  async #handleLogRecalc() {
    const trackerId = getCurrentTrackerId();
    const state = getWorldState(trackerId);
    const recalculated = recalculateStateFromLog(state, trackerId);
    await setWorldState(recalculated, trackerId);
    this.render();
    ui.notifications.info("Indy Downtime Tracker: progress recalculated.");
  }
}

class DowntimeRepSkillOverrides extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "indy-downtime-skill-overrides",
    tag: "form",
    classes: ["indy-downtime", "drep-settings", "drep-dialog"],
    window: {
      title: "Manual Skill/Ability Overrides",
      icon: "fas fa-list",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: {
      width: 520,
      height: "auto",
    },
    form: {
      handler: DowntimeRepSkillOverrides._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime-skill-overrides.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const overrides = normalizeManualSkillOverrides(
      game.settings.get(MODULE_ID, MANUAL_SKILL_OVERRIDES_SETTING) ?? {}
    );
    return {
      ...context,
      skillsText: serializeOverrideLines(overrides.skills),
      abilitiesText: serializeOverrideLines(overrides.abilities),
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object ?? {});
    const overrides = {
      skills: parseOverrideLines(data.skillsText),
      abilities: parseOverrideLines(data.abilitiesText, { stripAbilityPrefix: true }),
    };
    await game.settings.set(MODULE_ID, MANUAL_SKILL_OVERRIDES_SETTING, overrides);
    rerenderCharacterSheets();
    rerenderSettingsApps();
    ui.notifications.info("Indy Downtime Tracker: manual overrides saved.");
  }
}


class DowntimeRepPhaseConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(...args) {
    super(...args);
    const options = args?.[0] ?? {};
    this._trackerId = options.trackerId ?? getCurrentTrackerId();
    this._phaseConfig = getPhaseConfig(this._trackerId);
  }

  static DEFAULT_OPTIONS = {
    id: "indy-downtime-phase-config",
    tag: "form",
    classes: ["indy-downtime", "drep-settings", "drep-dialog"],
    window: {
      title: "Phase Configuration",
      icon: "fas fa-sliders-h",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: {
      width: 720,
      height: "auto",
    },
    form: {
      handler: DowntimeRepPhaseConfig._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime-phase-config.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const skillOptions = getSkillOptions();
    const phases = this._phaseConfig.map((phase, index) => {
      const groups = getPhaseGroups(phase).map((group) => {
        const checks = (group.checks ?? []).map((check) => ({
          id: check.id,
          name: check.name ?? "",
          skill: check.skill ?? "",
          description: check.description ?? "",
          dc: Number(check.dc ?? 0),
          dependsOnValue: normalizeCheckDependencies(check.dependsOn ?? [])
            .map((dep) => (dep.kind === "group" ? `group:${dep.id}` : dep.id))
            .join(", "),
        }));
        return {
          id: group.id,
          name: group.name ?? "",
          maxChecks: Number.isFinite(Number(group.maxChecks)) ? Number(group.maxChecks) : 0,
          checks,
        };
      });

      const successLines = (phase.successLines ?? []).map((line) => ({
        id: line.id,
        text: line.text ?? "",
        dependsOnChecksValue: (line.dependsOnChecks ?? []).join(", "),
        dependsOnGroupsValue: (line.dependsOnGroups ?? []).join(", "),
      }));

      const failureLines = (phase.failureLines ?? []).map((line) => ({
        id: line.id,
        text: line.text ?? "",
        dependsOnChecksValue: (line.dependsOnChecks ?? []).join(", "),
        dependsOnGroupsValue: (line.dependsOnGroups ?? []).join(", "),
      }));

      const phaseCompleteItems = Array.isArray(phase.phaseCompleteItems)
        ? phase.phaseCompleteItems
        : [];
      return {
        ...phase,
        number: index + 1,
        isPhase1: index === 0,
        groups,
        successLines,
        failureLines,
        phaseCompleteItems,
        phaseCompleteItemsJson: JSON.stringify(phaseCompleteItems),
      };
    });

    return {
      ...context,
      trackerId: this._trackerId,
      phaseOrder: this._phaseConfig.map((phase) => phase.id).join(","),
      phases,
      skillOptions,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = $(this.element);
    const trackerId = getCurrentTrackerId();
    const trackerIcon = getTabIcon(trackerId) || "fas fa-fire";
    this.options.window.icon = trackerIcon;
    const appRoot = html.closest(".app");
    const headerIcon = appRoot.find(".window-header .window-title i").first();
    if (headerIcon.length) {
      headerIcon.attr("class", trackerIcon);
    } else {
      appRoot.find(".window-header .window-title").prepend(
        `<i class="${trackerIcon}"></i> `
      );
    }
    const windowIcon = appRoot.find(".window-header .window-icon");
    if (windowIcon.length) {
      windowIcon.html(`<i class="${trackerIcon}"></i>`);
    }

    const syncFormState = () => {
      try {
        const formElement = html[0] instanceof HTMLFormElement
          ? html[0]
          : html.closest("form")[0] ?? this.element;
        if (!formElement) return;
        const raw = {};
        for (const [key, value] of new FormData(formElement).entries()) {
          raw[key] = value;
        }
        const data = foundry.utils.expandObject(raw);
        const order = parseList(data.phaseOrder);
        const existingConfig = this._phaseConfig;
        const base = order.length
          ? order.map((id) => existingConfig.find((phase) => phase.id === id) ?? { id })
          : existingConfig;
        this._phaseConfig = applyPhaseConfigFormData(base, data);
      } catch (error) {
        debugLog("Phase config sync failed", { error: error?.message });
      }
    };

    const getScrollContainer = () => {
      const root = this.element ? $(this.element) : html;
      const dialog = root.find(".drep-settings.drep-dialog").first();
      if (dialog.length) return dialog;

      const rootEl = root[0];
      let current = rootEl instanceof HTMLElement ? rootEl : null;
      while (current) {
        const style = getComputedStyle(current);
        const scrollable = /(auto|scroll)/.test(style.overflowY || "");
        if (scrollable && current.scrollHeight > current.clientHeight) {
          return $(current);
        }
        current = current.parentElement;
      }

      const windowContent = root.closest(".window-content");
      if (windowContent.length) return windowContent;
      const fallback = root.find(".window-content").first();
      return fallback.length ? fallback : root;
    };

    const captureScrollPosition = () => {
      const container = getScrollContainer();
      this._scrollTop = container.scrollTop();
    };

    const restoreScrollPosition = () => {
      const container = getScrollContainer();
      if (!Number.isFinite(this._scrollTop)) return;
      const applyScroll = () => {
        container.scrollTop(this._scrollTop);
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(applyScroll));
      } else {
        setTimeout(applyScroll, 0);
      }
    };

    const captureCollapseState = () => {
      const state = {};
      html.find("details[data-collapse-id]").each((_, element) => {
        const id = element?.dataset?.collapseId;
        if (!id) return;
        state[id] = Boolean(element.open);
      });
      this._collapseState = { ...(this._collapseState ?? {}), ...state };
    };

    const forceCollapseOpen = (...ids) => {
      this._collapseState = this._collapseState ?? {};
      ids.filter(Boolean).forEach((id) => {
        this._collapseState[id] = true;
      });
    };

    html.find("details[data-collapse-id]").each((_, element) => {
      const id = element?.dataset?.collapseId;
      if (!id) return;
      if (this._collapseState?.[id]) {
        element.open = true;
      }
    });

    html.on("toggle", "details[data-collapse-id]", (event) => {
      const id = event.currentTarget?.dataset?.collapseId;
      if (!id) return;
      this._collapseState = this._collapseState ?? {};
      this._collapseState[id] = event.currentTarget.open;
    });



    const initialTab = this._activeTab ?? this._phaseConfig[0]?.id ?? "phase1";
    html.find(".drep-tab-button").removeClass("active");
    html.find(".drep-phase-tab").removeClass("active");
    html.find(`.drep-tab-button[data-tab='${initialTab}']`).addClass("active");
    html.find(`.drep-phase-tab[data-tab='${initialTab}']`).addClass("active");
    html.find("[data-drep-action='phase-import-export']").on("click", (event) => {
      event.preventDefault();
      const phaseId = this._activeTab ?? this._phaseConfig[0]?.id ?? "phase1";
      const dialog = new DowntimeRepPhaseConfigExport({
        trackerId: this._trackerId,
        phaseId,
        onImport: () => {
          this._phaseConfig = getPhaseConfig(this._trackerId);
          this.render(true, { focus: false });
        },
      });
      dialog.render(true);
    });

    html.find(".drep-tab-button").on("click", (event) => {
      event.preventDefault();
      const tab = event.currentTarget?.dataset?.tab;
      if (!tab) return;
      this._activeTab = tab;
      html.find(".drep-tab-button").removeClass("active");
      html.find(".drep-phase-tab").removeClass("active");
      html.find(`.drep-tab-button[data-tab='${tab}']`).addClass("active");
      html.find(`.drep-phase-tab[data-tab='${tab}']`).addClass("active");
    });

    const applyFlowUpdate = (payload) => {
      const persistFlowUpdate = () => {
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(this._phaseConfig));
      };

      if (!payload) return;
      const phaseId = payload.phaseId;
      if (!phaseId) return;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase) return;

      const formElement = html[0] instanceof HTMLFormElement
        ? html[0]
        : html.closest("form")[0] ?? this.element;
      if (!formElement) return;

      const getCheckLabel = (checkId) => {
        const input = html.find(`input[name*="checks.${checkId}.name"]`).first();
        const value = String(input.val() ?? "").trim();
        if (value) return value;
        const card = html.find(`.drep-check-card[data-check-id='${checkId}']`).first();
        return card.data("checkName") || checkId;
      };

      const getGroupLabel = (groupId) => {
        const input = html.find(`input[name*="groups.${groupId}.name"]`).first();
        const value = String(input.val() ?? "").trim();
        return value || groupId;
      };

      const renderCheckDeps = (input) => {
        const container = input ? $(input).closest(".drep-deps") : null;
        if (!container || !container.length) return;
        const chips = container.find(".drep-deps-chips");
        chips.empty();
        const checkIds = parseList(input.value ?? "");
        for (const id of checkIds) {
          chips.append(
            `<span class="drep-dep-chip" data-dep-type="check" data-dep-id="${id}">${getCheckLabel(id)}<button type="button" class="drep-dep-remove" title="Remove">x</button></span>`
          );
        }
      };

      const renderLineDeps = (checkInput, groupInput) => {
        const depsContainer = checkInput
          ? $(checkInput).closest(".drep-deps")
          : groupInput
            ? $(groupInput).closest(".drep-deps")
            : null;
        if (!depsContainer || !depsContainer.length) return;

        const chips = depsContainer.find(".drep-deps-chips");
        chips.empty();
        const checkIds = parseList(checkInput?.value ?? "");
        const groupIds = parseList(groupInput?.value ?? "");
        for (const id of checkIds) {
          chips.append(
            `<span class="drep-dep-chip" data-dep-type="check" data-dep-id="${id}">${getCheckLabel(id)}<button type="button" class="drep-dep-remove" title="Remove">x</button></span>`
          );
        }
        for (const id of groupIds) {
          chips.append(
            `<span class="drep-dep-chip" data-dep-type="group" data-dep-id="${id}">${getGroupLabel(id)}<button type="button" class="drep-dep-remove" title="Remove">x</button></span>`
          );
        }
      };

      if (payload.kind === "phase") {
        const nextPhase = payload.phase;
        if (!nextPhase) return;
        const index = this._phaseConfig.findIndex((entry) => entry.id === phaseId);
        if (index < 0) return;
        this._phaseConfig[index] = foundry.utils.deepClone(nextPhase);
        persistFlowUpdate();
        return;
      }

      if (payload.kind === "check") {
        const checkId = payload.checkId;
        if (!checkId) return;
        const dependsOn = normalizeCheckDependencies(payload.dependsOn ?? []);
        const dependsOnIds = dependsOn.map((dep) => (dep.kind === "group" ? `group:${dep.id}` : dep.id));
        let updated = false;
        for (const group of phase.groups ?? []) {
          const check = (group.checks ?? []).find((entry) => entry.id === checkId);
          if (check) {
            check.dependsOn = dependsOn;
            updated = true;
            break;
          }
        }
        if (!updated) return;
        const input = formElement.querySelector(
          `[name*='checks.${checkId}.dependsOn']`
        );
        if (input) {
          input.value = dependsOnIds.join(", ");
          renderCheckDeps(input);
        }
        persistFlowUpdate();
        return;
      }

      const lineId = payload.lineId;
      const lineType = payload.lineType;
      if (!lineId || !lineType) return;
      const listKey = lineType === "success" ? "successLines" : "failureLines";
      let line = (phase[listKey] ?? []).find((entry) => entry.id === lineId);
      if (!line) {
        const savedConfig = getPhaseConfig(this._trackerId);
        const savedPhase = savedConfig.find((entry) => entry.id === phaseId) ?? savedConfig[0];
        const savedLine = (savedPhase?.[listKey] ?? []).find((entry) => entry.id === lineId);
        if (savedLine) {
          phase[listKey] = Array.isArray(phase[listKey]) ? phase[listKey] : [];
          const cloned = foundry.utils.deepClone(savedLine);
          phase[listKey].push(cloned);
          line = cloned;
        }
      }
      if (!line) return;
      line.dependsOnChecks = Array.isArray(payload.dependsOnChecks)
        ? payload.dependsOnChecks
        : [];
      line.dependsOnGroups = Array.isArray(payload.dependsOnGroups)
        ? payload.dependsOnGroups
        : [];

      const checkInput = formElement.querySelector(
        `[name='phases.${phaseId}.${listKey}.${lineId}.dependsOnChecks']`
      );
      const groupInput = formElement.querySelector(
        `[name='phases.${phaseId}.${listKey}.${lineId}.dependsOnGroups']`
      );
      if (checkInput) {
        checkInput.value = line.dependsOnChecks.join(", ");
      }
      if (groupInput) {
        groupInput.value = line.dependsOnGroups.join(", ");
      }
      renderLineDeps(checkInput, groupInput);
      persistFlowUpdate();
    };

    html.find("[data-drep-action='view-flow']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase) return;
      const app = new DowntimeRepPhaseFlow({
        trackerId: this._trackerId,
        phaseId,
        phase,
        onUpdate: applyFlowUpdate,
        openedFromSettings: true,
        settingsAppId: this.appId,
      });
      app.render(true);
    });


    html.find("[data-drep-action='add-phase']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const existingIds = new Set(this._phaseConfig.map((phase) => phase.id));
      let index = this._phaseConfig.length + 1;
      let id = `phase${index}`;
      while (existingIds.has(id)) {
        index += 1;
        id = `phase${index}`;
      }
      const nextPhase = buildNewPhase(index);
      nextPhase.id = id;
      this._phaseConfig = normalizePhaseConfig([...this._phaseConfig, nextPhase]);
      this._activeTab = id;
      captureScrollPosition();
      captureCollapseState();
      forceCollapseOpen(`phase-${id}-groups`);
      this.render(true);
    });

    html.find("[data-drep-action='remove-phase']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      if (!phaseId || phaseId === "phase1") {
        ui.notifications.warn("Indy Downtime Tracker: Phase 1 cannot be removed.");
        return;
      }
      const nextConfig = this._phaseConfig.filter(
        (phase) => phase.id !== phaseId
      );
      this._phaseConfig = normalizePhaseConfig(nextConfig);
      this._activeTab = this._phaseConfig[0]?.id ?? "phase1";
      captureScrollPosition();
      captureCollapseState();
      this.render(true);
    });

    html.find("[data-drep-action='add-group']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase) return;
      phase.groups = Array.isArray(phase.groups) ? phase.groups : [];
      phase.groups.push({
        id: foundry.utils.randomID(),
        name: "",
        checks: [],
      });
      setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(this._phaseConfig));
      rerenderCharacterSheets();
      this._activeTab = phaseId;
      captureScrollPosition();
      captureCollapseState();
      forceCollapseOpen(`phase-${phaseId}-groups`);
      this.render(true);
    });

    html.find("[data-drep-action='remove-group']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const groupId = event.currentTarget?.dataset?.groupId;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase || !groupId) return;
      phase.groups = (phase.groups ?? []).filter((group) => group.id !== groupId);
      setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(this._phaseConfig));
      rerenderCharacterSheets();
      this._activeTab = phaseId;
      captureScrollPosition();
      captureCollapseState();
      forceCollapseOpen(`phase-${phaseId}-groups`);
      this.render(true);
    });

    html.find("[data-drep-action='add-check']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const groupId = event.currentTarget?.dataset?.groupId;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase || !groupId) return;
      const group = (phase.groups ?? []).find((entry) => entry.id === groupId);
      if (!group) return;
      const options = getSkillOptions();
      const defaultSkill = options[0]?.key ?? "";
      group.checks = Array.isArray(group.checks) ? group.checks : [];
      group.checks.push({
        id: foundry.utils.randomID(),
        name: "",
        skill: defaultSkill,
        description: "",
        dc: 13,
        value: 1,
        dependsOn: [],
      });
      this._activeTab = phaseId;
      captureScrollPosition();
      captureCollapseState();
      forceCollapseOpen(
        `phase-${phaseId}-groups`,
        `phase-${phaseId}-group-${groupId}`,
        `phase-${phaseId}-group-${groupId}-checks`
      );
      this.render(true);
    });

    html.find("[data-drep-action='remove-check']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const groupId = event.currentTarget?.dataset?.groupId;
      const checkId = event.currentTarget?.dataset?.checkId;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase || !groupId || !checkId) return;
      const group = (phase.groups ?? []).find((entry) => entry.id === groupId);
      if (!group) return;
      group.checks = (group.checks ?? []).filter((check) => check.id !== checkId);
      this._activeTab = phaseId;
      captureScrollPosition();
      captureCollapseState();
      forceCollapseOpen(
        `phase-${phaseId}-groups`,
        `phase-${phaseId}-group-${groupId}`,
        `phase-${phaseId}-group-${groupId}-checks`
      );
      this.render(true);
    });

    html.find("[data-drep-action='add-success-line']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase) return;
      phase.successLines = Array.isArray(phase.successLines) ? phase.successLines : [];
      phase.successLines.push({
        id: foundry.utils.randomID(),
        text: "",
        dependsOnChecks: [],
        dependsOnGroups: [],
      });
      this._activeTab = phaseId;
      captureScrollPosition();
      captureCollapseState();
      forceCollapseOpen(`phase-${phaseId}-success`);
      this.render(true);
    });

    html.find("[data-drep-action='add-failure-line']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase) return;
      phase.failureLines = Array.isArray(phase.failureLines) ? phase.failureLines : [];
      phase.failureLines.push({
        id: foundry.utils.randomID(),
        text: "",
        dependsOnChecks: [],
        dependsOnGroups: [],
      });
      this._activeTab = phaseId;
      captureScrollPosition();
      captureCollapseState();
      forceCollapseOpen(`phase-${phaseId}-failure`);
      this.render(true);
    });

    html.find("[data-drep-action='remove-line']").on("click", (event) => {
      event.preventDefault();
      syncFormState();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const lineId = event.currentTarget?.dataset?.lineId;
      const lineType = event.currentTarget?.dataset?.lineType;
      const phase = this._phaseConfig.find((entry) => entry.id === phaseId);
      if (!phase || !lineId || !lineType) return;
      if (lineType === "success") {
        phase.successLines = (phase.successLines ?? []).filter((line) => line.id !== lineId);
      } else {
        phase.failureLines = (phase.failureLines ?? []).filter((line) => line.id !== lineId);
      }
      this._activeTab = phaseId;
      setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      captureScrollPosition();
      captureCollapseState();
      forceCollapseOpen(`phase-${phaseId}-${lineType}`);
      this.render(true);
    });

    html.find(".file-picker").on("click", (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      const target = button?.dataset?.target;
      const type = button?.dataset?.type ?? "image";
      if (!target) return;
      const input = html.find(`[name='${target}']`).first();
      if (!input.length) return;
      const picker = new FilePicker({
        type,
        current: input.val(),
        callback: (path) => {
          input.val(path);
        },
      });
      picker.browse();
    });

    html.find("[data-drep-drop='rolltable']").on("dragover", (event) => {
      event.preventDefault();
    });
    html.find("[data-drep-drop='rolltable']").on("drop", (event) => {
      event.preventDefault();
      const data = TextEditor.getDragEventData(event.originalEvent ?? event);
      const uuid =
        data?.uuid ?? (data?.type === "RollTable" ? `RollTable.${data.id}` : "");
      if (!uuid) return;
      const input = $(event.currentTarget);
      input.val(uuid);
    });

    html.find("[data-drep-drop='macro']").on("dragover", (event) => {
      event.preventDefault();
    });
    html.find("[data-drep-drop='macro']").on("drop", (event) => {
      event.preventDefault();
      const data = TextEditor.getDragEventData(event.originalEvent ?? event);
      const uuid =
        data?.uuid ?? (data?.type === "Macro" ? `Macro.${data.id}` : "");
      if (!uuid) return;
      const input = $(event.currentTarget);
      input.val(uuid);
    });

    const parseItemRewards = (raw) => {
      if (!raw) return [];
      const trimmed = String(raw ?? "").trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    };

    const normalizeItemRewards = (items) => {
      if (!Array.isArray(items)) return [];
      return items
        .map((entry) => {
          if (!entry) return null;
          const uuid = String(entry.uuid ?? entry.itemUuid ?? entry.id ?? "").trim();
          if (!uuid) return null;
          const qtyRaw = Number(entry.qty ?? entry.quantity ?? entry.count ?? 1);
          const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;
          return { uuid, qty };
        })
        .filter(Boolean);
    };

    const updatePhaseItemInput = (phaseId, updater, { rerender = false } = {}) => {
      const input = html.find(`[name='phases.${phaseId}.phaseCompleteItems']`).first();
      if (!input.length) return;
      const current = normalizeItemRewards(parseItemRewards(input.val()));
      const next = normalizeItemRewards(updater(current));
      input.val(JSON.stringify(next));
      if (rerender) {
        syncFormState();
        captureScrollPosition();
        captureCollapseState();
        this.render(true);
      }
    };

    html.find("[data-drep-drop='item']").on("dragover", (event) => {
      event.preventDefault();
    });
    html.find("[data-drep-drop='item']").on("drop", (event) => {
      event.preventDefault();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      if (!phaseId) return;
      const data = TextEditor.getDragEventData(event.originalEvent ?? event);
      const uuid = data?.uuid ?? (data?.type === "Item" ? `Item.${data.id}` : "");
      if (!uuid) return;
      updatePhaseItemInput(phaseId, (items) => {
        const existing = items.find((entry) => entry.uuid === uuid);
        if (existing) {
          existing.qty = Number(existing.qty ?? 1) + 1;
          return items;
        }
        return [...items, { uuid, qty: 1 }];
      }, { rerender: true });
    });

    html.on("change", "[data-drep-action='phase-item-qty']", (event) => {
      const input = event.currentTarget;
      const phaseId = input?.dataset?.phaseId;
      const index = Number(input?.dataset?.itemIndex ?? -1);
      if (!phaseId || index < 0) return;
      const qtyRaw = Number(input.value ?? 1);
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;
      updatePhaseItemInput(phaseId, (items) => {
        if (!items[index]) return items;
        items[index].qty = qty;
        return items;
      });
    });

    html.on("click", "[data-drep-action='remove-phase-item']", (event) => {
      event.preventDefault();
      const phaseId = event.currentTarget?.dataset?.phaseId;
      const index = Number(event.currentTarget?.dataset?.itemIndex ?? -1);
      if (!phaseId || index < 0) return;
      updatePhaseItemInput(phaseId, (items) => items.filter((_, idx) => idx !== index), { rerender: true });
    });

    restoreScrollPosition();
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object ?? {});
    const trackerId = data.trackerId ?? getCurrentTrackerId();
    const order = parseList(data.phaseOrder);
    const existingConfig = getPhaseConfig(trackerId);
    const phaseConfig = order.length
      ? order.map((id) => existingConfig.find((phase) => phase.id === id) ?? { id })
      : existingConfig;
    const updated = applyPhaseConfigFormData(phaseConfig, data);
    setTrackerPhaseConfig(trackerId, updated);
    rerenderCharacterSheets();
    rerenderSettingsApps();
    ui.notifications.info("Indy Downtime Tracker: phase configuration saved.");
  }
}


class DowntimeRepPhaseFlow extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    if (options.phaseId && !options.id) {
      options.id = `indy-downtime-phase-flow-${options.phaseId}`;
    }
    super(options);
    this._trackerId = options.trackerId ?? getCurrentTrackerId();
    this._phaseId = options.phaseId ?? null;
    this._phase = options.phase ?? null;
    this._actor = options.actor ?? null;
    this._onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;
    this._readOnly = Boolean(options.readOnly);
    this._openedFromSettings = Boolean(options.openedFromSettings);
    this._settingsAppId = options.settingsAppId ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: "indy-downtime-phase-flow",
    tag: "div",
    classes: ["indy-downtime", "drep-settings", "drep-flow-app"],
    window: {
      title: "Phase Flow",
      resizable: true,
    },
    position: {
      width: 900,
      height: 600,
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime-phase-flow.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const phaseConfig = getPhaseConfig(this._trackerId);
    const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
    const phaseNumber = phase ? getPhaseNumber(phase.id, this._trackerId) : 1;
    const phaseName = phase?.name ?? "Phase";
    const phaseIndex = phase ? phaseConfig.findIndex((entry) => entry.id === phase.id) : -1;
    const phaseCount = phaseConfig.length;
    const actor = this._actor ?? null;
    const allowTooltips = game.user?.isGM || shouldShowCheckTooltips(this._trackerId);
    const rollMode = getCheckRollMode(this._trackerId);

    const state = getWorldState(this._trackerId);
    const activePhase = getActivePhase(state, this._trackerId);
    const activeIndex = activePhase
      ? phaseConfig.findIndex((entry) => entry.id === activePhase.id)
      : -1;
    const canViewFuturePlans = game.user?.isGM || shouldShowFuturePlans(this._trackerId);
    const canNavigatePrev = phaseIndex > 0;
    const canNavigateNext = phaseIndex >= 0
      && phaseIndex < phaseCount - 1
      && (canViewFuturePlans || (activeIndex >= 0 && phaseIndex < activeIndex));
    const prevPhase = canNavigatePrev ? phaseConfig[phaseIndex - 1] : null;
    const nextPhase = phaseIndex >= 0 && phaseIndex < phaseCount - 1 ? phaseConfig[phaseIndex + 1] : null;
    const prevPhaseLabel = prevPhase ? `Phase ${getPhaseNumber(prevPhase.id, this._trackerId)}: ${prevPhase.name ?? "Phase"}` : "";
    const nextPhaseLabel = nextPhase ? `Phase ${getPhaseNumber(nextPhase.id, this._trackerId)}: ${nextPhase.name ?? "Phase"}` : "";
    const phaseState = state?.phases?.[phase?.id] ?? {};
    const checkProgress = phaseState?.checkProgress ?? {};
    const resolvedChecks = phaseState?.resolvedChecks ?? {};
    const redactLockedChecks = this._readOnly && !shouldShowLockedChecks(this._trackerId);
    const groupCounts = {};
    if (Array.isArray(state?.log)) {
      for (const entry of state.log) {
        if (!entry || entry.type === "phase-complete") continue;
        if (phase?.id && entry.phaseId && entry.phaseId !== phase.id) continue;
        if (entry.success !== true) continue;
        const groupId = entry.groupId;
        if (!groupId) continue;
        groupCounts[groupId] = (groupCounts[groupId] ?? 0) + 1;
      }
    }

    const checkLabels = {};
    const groupLabels = {};
    const successByCheck = {};
    const failureByCheck = {};
    const successByGroup = {};
    const failureByGroup = {};
    const unassignedSuccess = [];
    const unassignedFailure = [];

    const formatDependencyDetail = (dep) => {
      const type = dep?.type ?? "block";
      if (type === "harder") {
        const penalty = Number.isFinite(dep?.dcPenalty) && dep.dcPenalty > 0 ? dep.dcPenalty : 1;
        if (rollMode === "d100" || rollMode === "narrative") {
          return `Harder until completed (Increase Difficulty${penalty > 1 ? ` +${penalty}` : ""})`;
        }
        return `Harder until completed (+${penalty} DC)`;
      }
      if (type === "prevents") return "Blocks when completed";
      if (type === "advantage") return "Advantage when completed";
      if (type === "disadvantage") return "Disadvantage until completed";
      if (type === "triumph" || type === "success" || type === "failure" || type === "despair") {
        const outcomeLabel = getNarrativeOutcomeLabel(type) || type;
        return `Unlocks on ${outcomeLabel}`;
      }
      if (type === "override") {
        const parts = [];
        if (dep?.overrideSkill) parts.push(getSkillLabel(dep.overrideSkill));
        if (Number.isFinite(dep?.overrideDc)) parts.push(`DC ${dep.overrideDc}`);
        if (typeof dep?.overrideDc === "string") parts.push(getDifficultyLabel(dep.overrideDc));
        const detail = parts.length ? parts.join(" ") : "Override";
        return `Overrides when completed (${detail})`;
      }
      return "Blocks until completed";
    };

    const formatDependencyLabel = (dep) => {
      const base = dep.kind === "group" ? (groupLabels[dep.id] || dep.id) : (checkLabels[dep.id] || dep.id);
      const type = dep?.type ?? "block";
      if (type === "block") return base;
      if (type === "prevents") return `${base} (Blocks when completed)`;
      if (type === "harder") {
        const penalty = Number.isFinite(dep?.dcPenalty) && dep.dcPenalty > 0 ? dep.dcPenalty : 1;
        if (rollMode === "d100" || rollMode === "narrative") {
          return `${base} (Increase Difficulty${penalty > 1 ? ` +${penalty}` : ""})`;
        }
        return `${base} (DC +${penalty})`;
      }
      if (type === "advantage") return `${base} (Advantage)`;
      if (type === "disadvantage") return `${base} (Disadvantage)`;
      if (type === "triumph" || type === "success" || type === "failure" || type === "despair") {
        const outcomeLabel = getNarrativeOutcomeLabel(type) || type;
        return `${base} (${outcomeLabel})`;
      }
      if (type === "override") {
        const parts = [];
        if (dep?.overrideSkill) parts.push(getSkillLabel(dep.overrideSkill));
        if (Number.isFinite(dep?.overrideDc)) parts.push(`DC ${dep.overrideDc}`);
        if (typeof dep?.overrideDc === "string") parts.push(getDifficultyLabel(dep.overrideDc));
        const detail = parts.length ? parts.join(" ") : "Override";
        return `${base} (${detail})`;
      }
      return base;
    };

    for (const line of phase?.successLines ?? []) {
      const hasChecks = Array.isArray(line.dependsOnChecks) && line.dependsOnChecks.length;
      const hasGroups = Array.isArray(line.dependsOnGroups) && line.dependsOnGroups.length;
      if (hasChecks) {
        for (const checkId of line.dependsOnChecks) {
          successByCheck[checkId] = successByCheck[checkId] ?? [];
          successByCheck[checkId].push({ id: line.id, text: line.text });
        }
      }
      if (hasGroups) {
        for (const groupId of line.dependsOnGroups) {
          successByGroup[groupId] = successByGroup[groupId] ?? [];
          successByGroup[groupId].push({ id: line.id, text: line.text });
        }
      }
      if (!hasChecks && !hasGroups) {
        unassignedSuccess.push({ id: line.id, text: line.text });
      }
    }

    for (const line of phase?.failureLines ?? []) {
      const hasChecks = Array.isArray(line.dependsOnChecks) && line.dependsOnChecks.length;
      const hasGroups = Array.isArray(line.dependsOnGroups) && line.dependsOnGroups.length;
      if (hasChecks) {
        for (const checkId of line.dependsOnChecks) {
          failureByCheck[checkId] = failureByCheck[checkId] ?? [];
          failureByCheck[checkId].push({ id: line.id, text: line.text });
        }
      }
      if (hasGroups) {
        for (const groupId of line.dependsOnGroups) {
          failureByGroup[groupId] = failureByGroup[groupId] ?? [];
          failureByGroup[groupId].push({ id: line.id, text: line.text });
        }
      }
      if (!hasChecks && !hasGroups) {
        unassignedFailure.push({ id: line.id, text: line.text });
      }
    }

    const groups = getPhaseGroups(phase).map((group) => {
      const checks = (group.checks ?? []).map((check) => {
        const rollMode = getCheckRollMode(this._trackerId);
        const rollData = getCheckRollData(phase, check, checkProgress, resolvedChecks, this._trackerId);
        const skillLabel = check.skill ? getSkillLabel(check.skill) : "";
        const name = check.name || skillLabel || "Check";
        const rawName = check.name || "";
        const rawDescription = check.description ?? "";
        const checkCompleteMacro =
          typeof check.checkCompleteMacro === "string"
            ? check.checkCompleteMacro.trim()
            : "";
        const checkSuccessItems = Array.isArray(check.checkSuccessItems)
          ? check.checkSuccessItems
          : [];
        const complete = isCheckComplete(check, checkProgress);
        const unlocked = isCheckUnlocked(phase, check, checkProgress, resolvedChecks);
        const group = getPhaseGroups(phase).find((entry) => entry.id === check.groupId);
        const groupLimit = Number(group?.maxChecks ?? 0);
        const groupUsed = Number(groupCounts?.[check.groupId] ?? 0);
        const groupAvailable = !groupLimit || groupUsed < groupLimit;
        const groupMaxed = Boolean(groupLimit) && !groupAvailable;
        const isLocked = !unlocked || complete || groupMaxed;
        const shouldRedact = redactLockedChecks && isLocked && !complete;
        const displayName = shouldRedact ? "???" : name;
        const displaySkillLabel = shouldRedact ? "???" : skillLabel;
        const displayDescription = shouldRedact ? "???" : rawDescription;
        const potentialRollData = buildPotentialRollData(phase, check, checkProgress, resolvedChecks, this._trackerId);
        const baseDcValue = (rollMode === "d100" || rollMode === "narrative") ? check.difficulty : check.dc;
        const dcTooltip = buildDcTooltip({
          actor,
          rollData,
          baseDc: baseDcValue,
          redacted: shouldRedact,
          potentialRollData,
          allowTooltip: allowTooltips,
          trackerId: this._trackerId,
        });
        checkLabels[check.id] = displayName;
        const difficulty = check?.difficulty ?? "";
        const difficultyLabel = getDifficultyLabel(difficulty);
        const dcValue = Number(check.dc ?? 0);
        const dcLabel = (rollMode === "d100" || rollMode === "narrative")
          ? `Difficulty: ${difficultyLabel}`
          : (Number.isFinite(dcValue) ? `DC ${dcValue}` : "");
        return {
          id: check.id,
          name: displayName,
          rawName,
          description: displayDescription,
          rawDescription,
          skill: check.skill ?? "",
          skillLabel: displaySkillLabel,
          complete,
          locked: isLocked,
          groupMaxed: groupMaxed && !complete,
          completeGroupOnSuccess: Boolean(check.completeGroupOnSuccess),
          completePhaseOnSuccess: Boolean(check.completePhaseOnSuccess),
          checkCompleteMacro,
          checkSuccessItems,
          hasCompletionFlags: Boolean(
            check.completeGroupOnSuccess
              || check.completePhaseOnSuccess
              || checkCompleteMacro
              || checkSuccessItems.length
          ),
          dc: dcValue,
          dcLabel,
          difficulty,
          difficultyLabel,
          dcTooltip,
          dependsOn: normalizeCheckDependencies(check.dependsOn ?? []),
          successLines: successByCheck[check.id] ?? [],
          failureLines: failureByCheck[check.id] ?? [],
        };
      });
      const groupName = group.name || "Group";
      groupLabels[group.id] = groupName;
      return {
        id: group.id,
        name: groupName,
        rawName: group.name || "",
        maxChecks: Number(group.maxChecks ?? 0),
        checks,
        successLines: successByGroup[group.id] ?? [],
        failureLines: failureByGroup[group.id] ?? [],
      };
    });

    for (const group of groups) {
      for (const check of group.checks) {
        check.dependsOnEntries = (check.dependsOn ?? []).map((dep, index) => ({
          index,
          id: dep.id,
          label: formatDependencyLabel(dep),
          detail: formatDependencyDetail(dep),
          type: dep.type ?? "block",
          kind: dep.kind ?? "check",
          dcPenalty: dep.dcPenalty ?? 0,
          overrideSkill: dep.overrideSkill ?? "",
          overrideDc: dep.overrideDc ?? null,
          complete: isDependencyComplete(phase, dep, checkProgress, resolvedChecks),
        }));
        if (check.dependsOnEntries.length) {
          debugLog("Flow check deps", {
            checkId: check.id,
            dependsOn: check.dependsOnEntries,
            showFlowRelationships: this._readOnly
              ? getTrackerById(this._trackerId)?.showFlowRelationships !== false
              : true,
          });
        }
      }
    }

    const flowZoom = Number.isFinite(this._flowZoom) ? this._flowZoom : 100;

    return {
      ...context,
      phaseNumber,
      phaseName,
      phaseCount,
      canNavigatePrev,
      canNavigateNext,
      prevPhaseLabel,
      nextPhaseLabel,
      groups,
      unassignedSuccess,
      unassignedFailure,
      flowZoom,
      showFlowRelationships: this._readOnly
        ? getTrackerById(this._trackerId)?.showFlowRelationships !== false
        : true,
      showFlowLines: this._readOnly
        ? getTrackerById(this._trackerId)?.showFlowLines !== false
        : true,
      hideDc: this._readOnly ? shouldHideDc(this._trackerId) : false,
      readOnly: this._readOnly,
    };
  }

  async _onClose(options = {}) {
    await super._onClose(options);
    if (this._openedFromSettings) {
      const app = this._settingsAppId ? ui.windows[this._settingsAppId] : null;
      if (app) {
        app.render(true, { focus: false });
        return;
      }
      const fallback = Object.values(ui.windows).find(
        (win) => win?.id === "indy-downtime-phase-config"
      );
      if (fallback) {
        fallback.render(true, { focus: false });
      } else {
        rerenderSettingsApps(true);
      }
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = $(this.element);
    const trackerId = getCurrentTrackerId();
    const trackerIcon = getTabIcon(trackerId) || "fas fa-fire";
    this.options.window.icon = trackerIcon;
    const appRoot = html.closest(".app");
    const headerIcon = appRoot.find(".window-header .window-title i").first();
    if (headerIcon.length) {
      headerIcon.attr("class", trackerIcon);
    } else {
      appRoot.find(".window-header .window-title").prepend(
        `<i class="${trackerIcon}"></i> `
      );
    }
    const windowIcon = appRoot.find(".window-header .window-icon");
    if (windowIcon.length) {
      windowIcon.html(`<i class="${trackerIcon}"></i>`);
    }

    html.off(".drepFlow");
    html.find(".drep-flow-line-chip").attr("draggable", true);
    html.find(".drep-flow-check").attr("draggable", true);
    html.on("dragover.drepFlow", "[data-drep-drop='macro']", (event) => {
      event.preventDefault();
    });
    html.on("drop.drepFlow", "[data-drep-drop='macro']", (event) => {
      event.preventDefault();
      const data = TextEditor.getDragEventData(event.originalEvent ?? event);
      const uuid =
        data?.uuid ?? (data?.type === "Macro" ? `Macro.${data.id}` : "");
      if (!uuid) return;
      const input = $(event.currentTarget);
      input.val(uuid);
      input.trigger("change");
    });

    const normalizeItemRewards = (items) => {
      if (!Array.isArray(items)) return [];
      return items
        .map((entry) => {
          if (!entry) return null;
          const uuid = String(entry.uuid ?? entry.itemUuid ?? entry.id ?? "").trim();
          if (!uuid) return null;
          const qtyRaw = Number(entry.qty ?? entry.quantity ?? entry.count ?? 1);
          const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;
          return { uuid, qty };
        })
        .filter(Boolean);
    };

    const updateCheckSuccessItems = (checkId, updater) => {
      if (!checkId) return;
      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      const check = getPhaseChecks(phase).find((entry) => entry.id === checkId);
      if (!check) return;
      const current = normalizeItemRewards(check.checkSuccessItems ?? []);
      const next = normalizeItemRewards(updater(current));
      if (updateCheckField(phase, checkId, { checkSuccessItems: next })) {
        savePhaseConfig(phase);
      }
    };

    html.on("dragover.drepFlow", "[data-drep-drop='item']", (event) => {
      event.preventDefault();
    });
    html.on("drop.drepFlow", "[data-drep-drop='item']", (event) => {
      event.preventDefault();
      if (this._readOnly) return;
      const checkId = event.currentTarget?.dataset?.checkId;
      if (!checkId) return;
      const data = TextEditor.getDragEventData(event.originalEvent ?? event);
      const uuid = data?.uuid ?? (data?.type === "Item" ? `Item.${data.id}` : "");
      if (!uuid) return;
      updateCheckSuccessItems(checkId, (items) => {
        const existing = items.find((entry) => entry.uuid === uuid);
        if (existing) {
          existing.qty = Number(existing.qty ?? 1) + 1;
          return items;
        }
        return [...items, { uuid, qty: 1 }];
      });
    });

    html.on("change.drepFlow", "[data-drep-action='check-success-item-qty']", (event) => {
      if (this._readOnly) return;
      const input = event.currentTarget;
      const checkId = input?.dataset?.checkId;
      const index = Number(input?.dataset?.itemIndex ?? -1);
      if (!checkId || index < 0) return;
      const qtyRaw = Number(input.value ?? 1);
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;
      updateCheckSuccessItems(checkId, (items) => {
        if (!items[index]) return items;
        items[index].qty = qty;
        return items;
      });
    });

    html.on("click.drepFlow", "[data-drep-action='remove-check-success-item']", (event) => {
      event.preventDefault();
      if (this._readOnly) return;
      const checkId = event.currentTarget?.dataset?.checkId;
      const index = Number(event.currentTarget?.dataset?.itemIndex ?? -1);
      if (!checkId || index < 0) return;
      updateCheckSuccessItems(checkId, (items) => items.filter((_, idx) => idx !== index));
    });

    const clampFlowZoom = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 100;
      const rounded = Math.round(numeric / 5) * 5;
      return Math.min(200, Math.max(50, rounded));
    };

    const applyFlowZoom = (value) => {
      const clamped = clampFlowZoom(value);
      this._flowZoom = clamped;
      const flowRoot = html.find(".drep-flow").first();
      if (flowRoot.length) {
        flowRoot[0].style.setProperty("--drep-flow-zoom", (clamped / 100).toFixed(2));
      }
      html.find(".drep-flow-zoom-range").val(clamped);
      html.find(".drep-flow-zoom-label").text(`${clamped}%`);
    };

    const clearFlowDepHighlight = () => {
      html.find(".drep-flow-related").removeClass("drep-flow-related");
    };

    const setFlowDepHighlight = (dep) => {
      clearFlowDepHighlight();
      if (!dep) return;
      const lanesEl = html.find(".drep-flow-lanes").first()[0] ?? null;
      if (!lanesEl) return;
      const selector =
        dep.kind === "group"
          ? `[data-drep-group-id="${dep.id}"]`
          : `[data-drep-check-id="${dep.id}"]`;
      const target = lanesEl.querySelector(selector);
      if (target) {
        target.classList.add("drep-flow-related");
      }
    };

    applyFlowZoom(Number.isFinite(this._flowZoom) ? this._flowZoom : 100);
    if (this._flowWheelHandler && html[0]) {
      html[0].removeEventListener("wheel", this._flowWheelHandler);
    }
    this._flowWheelHandler = (event) => {
      if (!event.ctrlKey) return;
      if (!html[0] || !html[0].contains(event.target)) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? 5 : -5;
      applyFlowZoom((this._flowZoom ?? 100) + delta);
    };
    if (html[0]) {
      html[0].addEventListener("wheel", this._flowWheelHandler, { passive: false });
    }

    const captureFlowCollapse = () => {
      const state = {};
      html.find("details[data-collapse-id]").each((_, element) => {
        const id = element?.dataset?.collapseId;
        if (!id) return;
        state[id] = Boolean(element.open);
      });
      this._collapseStateFlow = { ...(this._collapseStateFlow ?? {}), ...state };
    };

    html.find("details[data-collapse-id]").each((_, element) => {
      const id = element?.dataset?.collapseId;
      if (!id) return;
      if (this._collapseStateFlow?.[id]) {
        element.open = true;
      } else {
        element.open = false;
      }
    });

    html.on("toggle.drepFlow", "details[data-collapse-id]", (event) => {
      const id = event.currentTarget?.dataset?.collapseId;
      if (!id) return;
      this._collapseStateFlow = this._collapseStateFlow ?? {};
      this._collapseStateFlow[id] = event.currentTarget.open;
    });

    html.on("input.drepFlow change.drepFlow", ".drep-flow-zoom-range", (event) => {
      applyFlowZoom(event.currentTarget?.value);
    });

    html.on("click.drepFlow", "[data-drep-action=\"flow-zoom-in\"]", (event) => {
      event.preventDefault();
      applyFlowZoom((this._flowZoom ?? 100) + 5);
    });

    html.on("click.drepFlow", "[data-drep-action=\"flow-zoom-out\"]", (event) => {
      event.preventDefault();
      applyFlowZoom((this._flowZoom ?? 100) - 5);
    });

    html.on("click.drepFlow", "[data-drep-action=\"flow-zoom-reset\"]", (event) => {
      event.preventDefault();
      applyFlowZoom(100);
    });

    const resolvePhaseNavTarget = (direction) => {
      const phaseConfig = getPhaseConfig(this._trackerId);
      const currentIndex = phaseConfig.findIndex((entry) => entry.id === this._phaseId);
      if (currentIndex < 0) return null;
      const nextIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= phaseConfig.length) return null;
      const state = getWorldState(this._trackerId);
      const activePhase = getActivePhase(state, this._trackerId);
      const activeIndex = activePhase
        ? phaseConfig.findIndex((entry) => entry.id === activePhase.id)
        : -1;
      const resolvedActiveIndex = activeIndex >= 0 ? activeIndex : currentIndex;
      const canViewFuture = game.user?.isGM || shouldShowFuturePlans(this._trackerId);
      if (direction === "next" && !canViewFuture && nextIndex > resolvedActiveIndex) {
        return null;
      }
      return phaseConfig[nextIndex] ?? null;
    };

    const goToPhase = (target) => {
      if (!target?.id) return;
      captureFlowCollapse();
      this._phaseId = target.id;
      this._phase = target ?? null;
      this.render(true);
    };

    html.on("click.drepFlow", "[data-drep-action=\"flow-prev-phase\"]", (event) => {
      event.preventDefault();
      const target = resolvePhaseNavTarget("prev");
      if (!target) return;
      goToPhase(target);
    });

    html.on("click.drepFlow", "[data-drep-action=\"flow-next-phase\"]", (event) => {
      event.preventDefault();
      const target = resolvePhaseNavTarget("next");
      if (!target) return;
      goToPhase(target);
    });

    html.on("mouseenter.drepFlow", ".drep-flow-dep", (event) => {
      const chip = event.currentTarget;
      const dep = {
        id: chip?.dataset?.depId ?? "",
        kind: chip?.dataset?.depKind ?? "check",
      };
      setFlowDepHighlight(dep);
    });

    html.on("mouseleave.drepFlow", ".drep-flow-dep", (event) => {
      clearFlowDepHighlight();
    });


    const savePhaseConfig = (phase) => {
      const phaseConfig = getPhaseConfig(this._trackerId);
      const index = phaseConfig.findIndex((entry) => entry.id === phase.id);
      if (index >= 0) {
        phaseConfig[index] = phase;
      }
      setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      rerenderCharacterSheets();
      rerenderSettingsApps();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
    };

    const updateCheckField = (phase, checkId, updates) => {
      for (const group of phase.groups ?? []) {
        const check = (group.checks ?? []).find((entry) => entry.id === checkId);
        if (check) {
          Object.assign(check, updates);
          return true;
        }
      }
      return false;
    };

    const updateLineText = (phase, lineId, lineType, textValue) => {
      const listKey = lineType === "failure" ? "failureLines" : "successLines";
      const line = (phase[listKey] ?? []).find((entry) => entry.id === lineId);
      if (!line) return false;
      line.text = textValue;
      return true;
    };

    html.on("change.drepFlow", "[data-drep-action='toggle-check-flag']", (event) => {
      if (this._readOnly) return;
      const input = event.currentTarget;
      const checkId = input?.dataset?.checkId;
      const flag = input?.dataset?.flag;
      if (!checkId || !flag) return;
      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      const updates = { [flag]: Boolean(input.checked) };
      if (updateCheckField(phase, checkId, updates)) {
        savePhaseConfig(phase);
      }
    });

    html.on("change.drepFlow", "[data-drep-action='check-complete-macro']", (event) => {
      if (this._readOnly) return;
      const input = event.currentTarget;
      const checkId = input?.dataset?.checkId;
      if (!checkId) return;
      const value = String(input.value ?? "").trim();
      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      if (updateCheckField(phase, checkId, { checkCompleteMacro: value })) {
        savePhaseConfig(phase);
      }
    });

    html.on("click.drepFlow", "[data-drep-action='toggle-check-flags']", (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      const checkId = button?.dataset?.checkId;
      if (!checkId) return;
      const flags = html.find(`[data-drep-check-flags='${checkId}']`).first();
      if (!flags.length) return;
      const isOpen = flags.hasClass("is-open");
      flags.toggleClass("is-open", !isOpen);
      button.classList?.toggle("is-open", !isOpen);
    });

    const beginInlineEdit = (element, config) => {
      const $el = $(element);
      if ($el.data("editing")) return;
      $el.data("editing", true);
      const originalDisplay = $el.text();
      let input;

      if (config.type === "select") {
        input = $('<select class="drep-inline-edit"></select>');
        const options = Array.isArray(config.options) && config.options.length
          ? config.options
          : getSkillOptions().map((option) => ({ value: option.key, label: option.label }));
        for (const option of options) {
          input.append(`<option value="${option.value}">${option.label}</option>`);
        }
        input.val(config.value || "");
      } else if (config.type === "textarea") {
        input = $('<textarea rows="2" class="drep-inline-edit"></textarea>');
        input.val(config.value || "");
      } else if (config.type === "number") {
        input = $('<input type="number" min="1" step="1" inputmode="numeric" class="drep-inline-edit" />');
        input.val(config.value ?? "");
      } else {
        input = $('<input type="text" class="drep-inline-edit" />');
        input.val(config.value ?? "");
      }

      $el.empty().append(input);
      input.trigger("focus");
      if (input[0]?.select) input[0].select();

      const finish = (save) => {
        if (!save) {
          $el.text(originalDisplay);
          $el.data("editing", false);
          return;
        }
        const newValue = String(input.val() ?? "").trim();
        const phaseConfig = getPhaseConfig(this._trackerId);
        const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
        if (!phase) return;

        if (config.edit === "check-name") {
          debugLog("Inline edit save", { edit: config.edit, checkId: config.checkId, value: newValue });
          if (updateCheckField(phase, config.checkId, { name: newValue })) {
            savePhaseConfig(phase);
          }
          return;
        }
        if (config.edit === "check-skill") {
          debugLog("Inline edit save", { edit: config.edit, checkId: config.checkId, value: newValue });
          if (updateCheckField(phase, config.checkId, { skill: newValue })) {
            savePhaseConfig(phase);
          }
          return;
        }
        if (config.edit === "check-dc") {
          const rollMode = getCheckRollMode(this._trackerId);
          if (rollMode === "d100" || rollMode === "narrative") {
            const difficulty = newValue || "regular";
            debugLog("Inline edit save", { edit: config.edit, checkId: config.checkId, value: difficulty });
            if (updateCheckField(phase, config.checkId, { difficulty })) {
              savePhaseConfig(phase);
            }
            return;
          }
          const dcValue = Number(newValue);
          if (!Number.isInteger(dcValue) || dcValue <= 0) {
            ui.notifications.warn("Indy Downtime Tracker: DC must be a positive integer.");
            $el.text(originalDisplay);
            $el.data("editing", false);
            return;
          }
          debugLog("Inline edit save", { edit: config.edit, checkId: config.checkId, value: dcValue });
          if (updateCheckField(phase, config.checkId, { dc: dcValue })) {
            savePhaseConfig(phase);
          }
          return;
        }
        if (config.edit === "check-description") {
          debugLog("Inline edit save", { edit: config.edit, checkId: config.checkId, value: newValue });
          if (updateCheckField(phase, config.checkId, { description: newValue })) {
            savePhaseConfig(phase);
          }
          return;
        }
        if (config.edit === "group-name") {
          const groupId = config.groupId;
          if (!groupId) return;
          const groups = phase.groups ?? [];
          const group = groups.find((entry) => entry.id === groupId);
          if (!group) return;
          group.name = newValue;
          savePhaseConfig(phase);
          return;
        }

        if (config.edit === "line-text") {
          debugLog("Inline edit save", { edit: config.edit, lineId: config.lineId, lineType: config.lineType, value: newValue });
          if (updateLineText(phase, config.lineId, config.lineType, newValue)) {
            savePhaseConfig(phase);
          }
          return;
        }
      };

      input.on("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
        if (event.key === "Enter" && config.type !== "textarea") {
          event.preventDefault();
          finish(true);
        }
      });
      input.on("blur", () => finish(true));
    };

    html.on("click.drepFlow", ".drep-flow-add-check", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this._readOnly) return;
      const groupId = event.currentTarget?.dataset?.groupId;
      if (!groupId) return;
      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      if (!this._phaseId) {
        this._phaseId = phase.id;
      }
      const group = (phase.groups ?? []).find((entry) => entry.id === groupId);
      if (!group) return;
      group.checks = Array.isArray(group.checks) ? group.checks : [];
      const rollMode = getCheckRollMode(this._trackerId);
      const options = getSkillOptions();
      const defaultSkill = options[0]?.key ?? "";
      const defaultLabel = defaultSkill ? getSkillLabel(defaultSkill) : "";
      group.checks.push({
        id: foundry.utils.randomID(),
        name: defaultLabel,
        skill: defaultSkill,
        description: "",
        dc: 13,
        difficulty: (rollMode === "d100" || rollMode === "narrative") ? "regular" : "",
        value: 1,
        completeGroupOnSuccess: false,
        completePhaseOnSuccess: false,
        checkCompleteMacro: "",
        checkSuccessItems: [],
        dependsOn: [],
      });
      if (this._onUpdate) {
        this._onUpdate({
          kind: "phase",
          phaseId: phase.id,
          phase: foundry.utils.deepClone(phase),
        });
      } else {
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      }
      rerenderCharacterSheets();
      rerenderSettingsApps();
      this._phase = phase;
      this.render(true);
    });

    html.on("click.drepFlow", "[data-drep-action=\"add-line\"]", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this._readOnly) return;
      const lineType = event.currentTarget?.dataset?.lineType;
      if (!lineType || (lineType !== "success" && lineType !== "failure")) return;
      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      if (!this._phaseId) {
        this._phaseId = phase.id;
      }
      const listKey = lineType === "success" ? "successLines" : "failureLines";
      phase[listKey] = Array.isArray(phase[listKey]) ? phase[listKey] : [];
      phase[listKey].push({
        id: foundry.utils.randomID(),
        text: "New Line",
        dependsOnChecks: [],
        dependsOnGroups: [],
      });
      if (this._onUpdate) {
        this._onUpdate({
          kind: "phase",
          phaseId: phase.id,
          phase: foundry.utils.deepClone(phase),
        });
      } else {
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      }
      rerenderCharacterSheets();
      rerenderSettingsApps();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
    });


    html.on("click.drepFlow", "[data-drep-action=\"add-group\"]", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this._readOnly) return;
      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      if (!this._phaseId) {
        this._phaseId = phase.id;
      }
      phase.groups = Array.isArray(phase.groups) ? phase.groups : [];
      phase.groups.push({
        id: foundry.utils.randomID(),
        name: "",
        checks: [],
      });
      if (this._onUpdate) {
        this._onUpdate({
          kind: "phase",
          phaseId: phase.id,
          phase: foundry.utils.deepClone(phase),
        });
      } else {
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      }
      rerenderCharacterSheets();
      rerenderSettingsApps();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
    });

    html.on("click.drepFlow", "[data-drep-action=\"remove-group\"]", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this._readOnly) return;
      const groupId = event.currentTarget?.dataset?.groupId;
      if (!groupId) return;

      const confirm = await new Promise((resolve) => {
        let resolved = false;
        const finish = (value) => {
          if (resolved) return;
          resolved = true;
          resolve(value);
        };
        const dialog = new foundry.applications.api.DialogV2({
          window: { title: "Delete Group" },
          content: "<p>Delete this group? This cannot be undone.</p>",
          buttons: [
            {
              action: "delete",
              label: "Delete",
              default: true,
              callback: () => finish(true),
            },
            {
              action: "cancel",
              label: "Cancel",
              callback: () => finish(false),
            },
          ],
          close: () => finish(false),
        });
        dialog.render(true);
      });
      if (!confirm) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      if (!this._phaseId) {
        this._phaseId = phase.id;
      }
      phase.groups = (phase.groups ?? []).filter((group) => group.id !== groupId);
      for (const listKey of ["successLines", "failureLines"]) {
        for (const line of phase[listKey] ?? []) {
          if (!Array.isArray(line.dependsOnGroups)) continue;
          line.dependsOnGroups = line.dependsOnGroups.filter((id) => id !== groupId);
        }
      }
      if (this._onUpdate) {
        this._onUpdate({
          kind: "phase",
          phaseId: phase.id,
          phase: foundry.utils.deepClone(phase),
        });
      } else {
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      }
      rerenderCharacterSheets();
      rerenderSettingsApps();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
    });


    html.on("click.drepFlow", "[data-drep-action=\"set-group-max\"]", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this._readOnly) return;
      const groupId = event.currentTarget?.dataset?.groupId;
      if (!groupId) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      if (!this._phaseId) {
        this._phaseId = phase.id;
      }
      const group = (phase.groups ?? []).find((entry) => entry.id === groupId);
      if (!group) return;
      const current = Number.isFinite(Number(group.maxChecks)) ? Number(group.maxChecks) : 0;
      const currentDisplay = current > 0 ? String(current) : "";

      const value = await new Promise((resolve) => {
        let resolved = false;
        const finish = (val) => {
          if (resolved) return;
          resolved = true;
          resolve(val);
        };
        let dialogRef = null;
        const dialog = new foundry.applications.api.DialogV2({
          window: { title: "Set Max Success" },
          content: `<div class="drep-input-row"><label>Max checks for this group</label><input type="number" min="1" step="1" value="${currentDisplay}" data-drep-max-input></div>`,
          buttons: [
            {
              action: "save",
              label: "Save",
              default: true,
              callback: () => {
                const input = dialogRef?.element?.querySelector("[data-drep-max-input]");
                finish(input ? input.value : "");
              },
            },
            {
              action: "cancel",
              label: "Cancel",
              callback: () => finish(null),
            },
          ],
          close: () => finish(null),
        });
        dialogRef = dialog;
        dialog.render(true);
      });
      if (value === null) return;
      const trimmed = String(value ?? "").trim();
      if (!trimmed) {
        group.maxChecks = 0;
      } else {
        const maxValue = Number(trimmed);
        if (!Number.isInteger(maxValue) || maxValue <= 0) {
          ui.notifications.warn("Indy Downtime Tracker: max checks must be a positive integer or left blank.");
          return;
        }
        group.maxChecks = maxValue;
      }

      if (this._onUpdate) {
        this._onUpdate({
          kind: "phase",
          phaseId: phase.id,
          phase: foundry.utils.deepClone(phase),
        });
      } else {
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      }
      rerenderCharacterSheets();
      rerenderSettingsApps();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
    });

    html.on("click.drepFlow", ".drep-flow-remove-check", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this._readOnly) return;
      const checkCard = event.currentTarget?.closest(".drep-flow-check");
      const checkId = checkCard?.dataset?.drepCheckId;
      if (!checkId) return;

      const confirm = await new Promise((resolve) => {
        let resolved = false;
        const finish = (value) => {
          if (resolved) return;
          resolved = true;
          resolve(value);
        };
        const dialog = new foundry.applications.api.DialogV2({
          window: { title: "Delete Check" },
          content: "<p>Delete this check? This cannot be undone.</p>",
          buttons: [
            {
              action: "delete",
              label: "Delete",
              default: true,
              callback: () => finish(true),
            },
            {
              action: "cancel",
              label: "Cancel",
              callback: () => finish(false),
            },
          ],
          close: () => finish(false),
        });
        dialog.render(true);
      });
      if (!confirm) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      if (!this._phaseId) {
        this._phaseId = phase.id;
      }
      let targetGroup = null;
      for (const group of phase.groups ?? []) {
        if ((group.checks ?? []).some((check) => check.id === checkId)) {
          targetGroup = group;
          break;
        }
      }
      if (!targetGroup && this._phase) {
        const fallbackGroup = (this._phase.groups ?? []).find((group) =>
          (group.checks ?? []).some((check) => check.id === checkId)
        );
        if (fallbackGroup) {
          targetGroup = fallbackGroup;
          const index = phaseConfig.findIndex((entry) => entry.id === this._phase.id);
          if (index >= 0) {
            phaseConfig[index] = this._phase;
          }
        }
      }
      if (!targetGroup) return;
      targetGroup.checks = (targetGroup.checks ?? []).filter((check) => check.id !== checkId);

      for (const group of phase.groups ?? []) {
        for (const check of group.checks ?? []) {
          const deps = normalizeCheckDependencies(check.dependsOn ?? []);
          const next = deps.filter((dep) => dep.id !== checkId);
          if (next.length !== deps.length) {
            check.dependsOn = next;
          }
        }
      }
      for (const listKey of ["successLines", "failureLines"]) {
        for (const line of phase[listKey] ?? []) {
          if (!Array.isArray(line.dependsOnChecks)) continue;
          line.dependsOnChecks = line.dependsOnChecks.filter((id) => id !== checkId);
        }
      }

      setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      rerenderCharacterSheets();
      rerenderSettingsApps();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
    });




    html.on("dblclick.drepFlow", ".drep-flow-editable", (event) => {
      if (this._readOnly) return;
      event.preventDefault();
      const target = event.currentTarget;
      const edit = target?.dataset?.edit;
      if (!edit) return;
      if (edit === "group-name") {
        const groupId = target.dataset.groupId;
        if (!groupId) return;
        beginInlineEdit(target, { edit, type: "text", value: target.dataset.value ?? target.textContent, groupId });
        return;
      }

      if (edit.startsWith("check")) {
        const checkId = target.dataset.checkId;
        if (!checkId) return;
        if (edit === "check-name") {
          beginInlineEdit(target, { edit, type: "text", value: target.dataset.value ?? target.textContent, checkId });
        } else if (edit === "check-skill") {
          beginInlineEdit(target, { edit, type: "select", value: target.dataset.value ?? target.dataset.skill ?? "", checkId });
        } else if (edit === "check-dc") {
          const rollMode = getCheckRollMode(this._trackerId);
          if (rollMode === "d100" || rollMode === "narrative") {
            beginInlineEdit(target, {
              edit,
              type: "select",
              value: target.dataset.difficulty ?? "regular",
              checkId,
              options: getDifficultyOptions(),
            });
          } else {
            beginInlineEdit(target, { edit, type: "number", value: target.dataset.dc ?? "", checkId });
          }
        } else if (edit === "check-description") {
          beginInlineEdit(target, { edit, type: "textarea", value: target.dataset.value ?? target.textContent, checkId });
        }
        return;
      }
      if (edit === "line-text") {
        const lineId = target.dataset.lineId;
        const lineType = target.dataset.lineType;
        if (!lineId || !lineType) return;
        beginInlineEdit(target, { edit, type: "textarea", value: target.dataset.value ?? target.textContent, lineId, lineType });
      }
    });

    if (this._readOnly) {
      html.find(".drep-flow-line-chip").attr("draggable", false);
      html.find(".drep-flow-check").attr("draggable", false);
      return;
    }


    const promptLineAssignment = (targetLabel) => new Promise((resolve) => {
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };
      const content = `<p>Copy or move this line to <strong>${targetLabel}</strong>?</p>`;
      const dialog = new foundry.applications.api.DialogV2({
        window: { title: "Assign Line" },
        content: `<div>${content}</div>`,
        buttons: [
          {
            action: "copy",
            label: "Copy",
            callback: () => finish("copy"),
          },
          {
            action: "move",
            label: "Move",
            default: true,
            callback: () => finish("move"),
          },
          {
            action: "cancel",
            label: "Cancel",
            callback: () => finish(null),
          },
        ],
        close: () => finish(null),
      });
      dialog.render(true);
    });

    html.on("click.drepFlow", ".drep-flow-line-remove", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const lineCard = event.currentTarget?.closest(".drep-flow-line-chip");
      const lineId = lineCard?.dataset?.drepLineId;
      const lineType = lineCard?.dataset?.drepLineType;
      if (!lineId || !lineType) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? this._phase ?? phaseConfig[0];
      if (!phase) return;
      const listKey = lineType === "success" ? "successLines" : "failureLines";
      const line = (phase[listKey] ?? []).find((entry) => entry.id === lineId);
      if (!line) return;

      const checkId = lineCard?.closest(".drep-flow-check")?.dataset?.drepCheckId ?? "";
      const groupId = !checkId
        ? lineCard?.closest(".drep-flow-lane")?.dataset?.drepGroupId ?? ""
        : "";

      if (!checkId && !groupId) {
        phase[listKey] = (phase[listKey] ?? []).filter((entry) => entry.id !== lineId);
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
        rerenderCharacterSheets();
        rerenderSettingsApps();
        captureFlowCollapse();
        this._phase = phase;
        this.render(true);
        return;
      }

      const nextChecks = checkId
        ? (Array.isArray(line.dependsOnChecks) ? line.dependsOnChecks.filter((id) => id !== checkId) : [])
        : (Array.isArray(line.dependsOnChecks) ? line.dependsOnChecks : []);
      const nextGroups = groupId
        ? (Array.isArray(line.dependsOnGroups) ? line.dependsOnGroups.filter((id) => id !== groupId) : [])
        : (Array.isArray(line.dependsOnGroups) ? line.dependsOnGroups : []);

      line.dependsOnChecks = nextChecks;
      line.dependsOnGroups = nextGroups;
      if (this._onUpdate) {
        this._onUpdate({
          kind: "line",
          phaseId: phase.id,
          lineId,
          lineType,
          dependsOnChecks: nextChecks,
          dependsOnGroups: nextGroups,
        });
      }
      setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      rerenderCharacterSheets();
      rerenderSettingsApps();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
      // captureFlowCollapse();
      // captureFlowCollapse();
      // this._phase = phase;
      // this.render(true);
    });


    html.on("dragstart.drepFlow", ".drep-flow-lane-header, .drep-flow-group-name", (event) => {
      event.stopPropagation();
      const groupId = event.currentTarget?.closest(".drep-flow-lane")?.dataset?.drepGroupId;
      debugLog("Flow drag group start", { groupId });
      if (!groupId) return;
      const payload = JSON.stringify({ type: "group", groupId });
      const dataTransfer = event.originalEvent?.dataTransfer || event.dataTransfer;
      if (dataTransfer) {
        dataTransfer.setData("text/plain", payload);
        dataTransfer.effectAllowed = "move";
      }
    });

    html.on("dragstart.drepFlow", ".drep-flow-line-chip", (event) => {
      event.stopPropagation();
      const lineId = event.currentTarget?.dataset?.drepLineId;
      const lineType = event.currentTarget?.dataset?.drepLineType;
      if (!lineId || !lineType) return;
      const payload = JSON.stringify({ type: "line", lineId, lineType });
      if (event.originalEvent?.dataTransfer) {
        event.originalEvent.dataTransfer.setData("text/plain", payload);
        event.originalEvent.dataTransfer.effectAllowed = "move";
      }
    });

    html.on("dragstart.drepFlow", ".drep-flow-check", (event) => {
      if (event.target?.closest(".drep-flow-line-chip")) return;
      const checkId = event.currentTarget?.dataset?.drepCheckId;
      debugLog("Flow drag check start", { checkId });
      if (!checkId) return;
      const payload = JSON.stringify({ type: "check", checkId });
      if (event.originalEvent?.dataTransfer) {
        event.originalEvent.dataTransfer.setData("text/plain", payload);
        event.originalEvent.dataTransfer.effectAllowed = "move";
      }
    });

    html.on("click.drepFlow", ".drep-flow-dep-remove", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const chip = event.currentTarget?.closest(".drep-flow-dep");
      const depId = chip?.dataset?.depId;
      const depIndexRaw = chip?.dataset?.depIndex;
      const depIndex = Number.isFinite(Number(depIndexRaw)) ? Number(depIndexRaw) : null;
      const targetCheckId = chip?.dataset?.targetCheckId;
      if (!depId || !targetCheckId) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? this._phase ?? phaseConfig[0];
      if (!phase) return;
      let targetCheck = null;
      for (const group of phase.groups ?? []) {
        targetCheck = (group.checks ?? []).find((entry) => entry.id === targetCheckId) ?? null;
        if (targetCheck) break;
      }
      if (!targetCheck) return;
      const current = normalizeCheckDependencies(targetCheck.dependsOn ?? []);
      const nextDepends = Number.isFinite(depIndex)
        ? current.filter((_, index) => index !== depIndex)
        : current.filter((dep) => dep.id !== depId);
      if (nextDepends.length === current.length) return;
      targetCheck.dependsOn = nextDepends;
      if (this._onUpdate) {
        this._onUpdate({
          kind: "check",
          phaseId: phase.id,
          checkId: targetCheckId,
          dependsOn: nextDepends,
        });
      }
      setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      captureFlowCollapse();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
    });


    html.on("contextmenu.drepFlow", ".drep-flow-dep", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const chip = event.currentTarget?.closest(".drep-flow-dep");
      const depId = chip?.dataset?.depId;
      const depIndexRaw = chip?.dataset?.depIndex;
      const depIndex = Number.isFinite(Number(depIndexRaw)) ? Number(depIndexRaw) : null;
      const targetCheckId = chip?.dataset?.targetCheckId;
      if (!depId || !targetCheckId) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? this._phase ?? phaseConfig[0];
      if (!phase) return;
      let targetCheck = null;
      for (const group of phase.groups ?? []) {
        targetCheck = (group.checks ?? []).find((entry) => entry.id === targetCheckId) ?? null;
        if (targetCheck) break;
      }
      if (!targetCheck) return;

      const current = normalizeCheckDependencies(targetCheck.dependsOn ?? []);
      const applyDependency = (newDep) => {
        const nextDepends = [...current];
        if (Number.isFinite(depIndex)) {
          if (!nextDepends[depIndex]) return;
          nextDepends[depIndex] = newDep;
        } else {
          for (let i = 0; i < nextDepends.length; i += 1) {
            if (nextDepends[i].id === depId) {
              nextDepends[i] = newDep;
              break;
            }
          }
        }
        targetCheck.dependsOn = nextDepends;
        if (this._onUpdate) {
          this._onUpdate({
            kind: "check",
            phaseId: phase.id,
            checkId: targetCheckId,
            dependsOn: nextDepends,
          });
        }
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
        this._phase = phase;
        this.render(true);
      };

      const depEntry = Number.isFinite(depIndex)
        ? current[depIndex]
        : current.find((entry) => entry.id === depId);
      const resolvedDepEntry = depEntry ?? { id: depId, type: "block" };
      new DowntimeRepDepEditor({
        dep: resolvedDepEntry,
        onSave: applyDependency,
        trackerId: this._trackerId,
      }).render(true);
    });

    html.on("dragover.drepFlow", ".drep-flow-lane", (event) => {
      event.stopPropagation();
      if (event.target?.closest(".drep-flow-check")) return;
      event.preventDefault();
      event.currentTarget?.classList?.add("is-drop-target");
      if (event.originalEvent?.dataTransfer) {
        event.originalEvent.dataTransfer.dropEffect = "move";
      }
    });

    html.on("dragleave.drepFlow", ".drep-flow-lane", (event) => {
      event.stopPropagation();
      event.currentTarget?.classList?.remove("is-drop-target");
    });

    html.on("drop.drepFlow", ".drep-flow-lane", async (event) => {
      event.stopPropagation();
      if (event.target?.closest(".drep-flow-check")) return;
      event.preventDefault();
      event.currentTarget?.classList?.remove("is-drop-target");
      const groupId = event.currentTarget?.dataset?.drepGroupId;
      if (!groupId) return;
      const raw = event.originalEvent?.dataTransfer?.getData("text/plain") ?? "";
      if (!raw) return;
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        return;
      }
      if (payload?.type !== "line") return;
      const lineId = payload?.lineId;
      const lineType = payload?.lineType;
      if (!lineId || (lineType !== "success" && lineType !== "failure")) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? this._phase ?? phaseConfig[0];
      if (!phase) return;
      const listKey = lineType === "success" ? "successLines" : "failureLines";
      const line = (phase[listKey] ?? []).find((entry) => entry.id === lineId);
      if (!line) return;

      const hasChecks = Array.isArray(line.dependsOnChecks) && line.dependsOnChecks.length;
      const hasGroups = Array.isArray(line.dependsOnGroups) && line.dependsOnGroups.length;
      const isOnlyTarget = hasGroups
        && line.dependsOnGroups.length === 1
        && line.dependsOnGroups[0] === groupId
        && !hasChecks;
      if (isOnlyTarget) return;

      let mode = "move";
      if (hasChecks || hasGroups) {
        const targetLabel = event.currentTarget?.querySelector(".drep-flow-lane-header")?.textContent?.trim() || "this group";
        mode = await promptLineAssignment(targetLabel);
        if (!mode) return;
      }

      let nextGroups = [];
      if (mode === "copy") {
        const existing = Array.isArray(line.dependsOnGroups) ? line.dependsOnGroups : [];
        nextGroups = Array.from(new Set([...existing, groupId]));
      } else {
        nextGroups = [groupId];
      }
      const nextChecks = mode === "copy"
        ? (Array.isArray(line.dependsOnChecks) ? line.dependsOnChecks : [])
        : [];
      line.dependsOnGroups = nextGroups;
      line.dependsOnChecks = nextChecks;
      if (this._onUpdate) {
        this._onUpdate({
          kind: "line",
          phaseId: phase.id,
          lineId,
          lineType,
          dependsOnChecks: nextChecks,
          dependsOnGroups: nextGroups,
        });
      }
      captureFlowCollapse();
      captureFlowCollapse();
      this._phase = phase;
      this.render(true);
    });

    html.on("dragover.drepFlow", ".drep-flow-check", (event) => {
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget?.classList?.add("is-drop-target");
      if (event.originalEvent?.dataTransfer) {
        event.originalEvent.dataTransfer.dropEffect = "move";
      }
    });

    html.on("dragleave.drepFlow", ".drep-flow-check", (event) => {
      event.stopPropagation();
      event.currentTarget?.classList?.remove("is-drop-target");
    });

    html.on("drop.drepFlow", ".drep-flow-check", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget?.classList?.remove("is-drop-target");
      const targetCheckId = event.currentTarget?.dataset?.drepCheckId;
      debugLog("Flow drop on check", { targetCheckId });
      if (!targetCheckId) return;
      const raw = event.originalEvent?.dataTransfer?.getData("text/plain") ?? event.dataTransfer?.getData("text/plain") ?? "";
      debugLog("Flow drop raw payload", { raw });
      if (!raw) return;
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        return;
      }
      const payloadType = payload?.type;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = phaseConfig.find((entry) => entry.id === this._phaseId) ?? this._phase ?? phaseConfig[0];
      if (!phase) return;


      if (payloadType === "group") {
        const sourceGroupId = payload?.groupId;
        debugLog("Flow drop group on check", { sourceGroupId, targetCheckId });
        if (!sourceGroupId) return;
        let targetCheck = null;
        for (const group of phase.groups ?? []) {
          targetCheck = (group.checks ?? []).find((entry) => entry.id === targetCheckId) ?? null;
          if (targetCheck) break;
        }
        if (!targetCheck) return;
        const current = normalizeCheckDependencies(targetCheck.dependsOn ?? []);
        if (current.some((dep) => dep.id === sourceGroupId && dep.kind === "group" && (dep.type ?? "block") === "block")) {
          return;
        }
        const nextDepends = [...current, { id: sourceGroupId, type: "block", kind: "group" }];
        targetCheck.dependsOn = nextDepends;
        if (this._onUpdate) {
          this._onUpdate({
            kind: "check",
            phaseId: phase.id,
            checkId: targetCheckId,
            dependsOn: nextDepends,
          });
        }
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
        this._phase = phase;
        this.render(true);
        return;
      }

      if (payloadType === "check") {
        const sourceCheckId = payload?.checkId;
        debugLog("Flow drop check on check", { sourceCheckId, targetCheckId });
        if (!sourceCheckId || sourceCheckId === targetCheckId) return;
        let targetCheck = null;
        for (const group of phase.groups ?? []) {
          targetCheck = (group.checks ?? []).find((entry) => entry.id === targetCheckId) ?? null;
          if (targetCheck) break;
        }
        if (!targetCheck) {
          debugLog("Flow drop check missing target", { targetCheckId });
          return;
        }
        const current = normalizeCheckDependencies(targetCheck.dependsOn ?? []);
        if (current.some((dep) => dep.id === sourceCheckId && (dep.kind ?? "check") === "check" && (dep.type ?? "block") === "block")) {
          debugLog("Flow drop check already linked", { sourceCheckId, targetCheckId });
          return;
        }
        const nextDepends = [...current, { id: sourceCheckId, type: "block", kind: "check" }];
        targetCheck.dependsOn = nextDepends;
        debugLog("Flow drop check linked", { sourceCheckId, targetCheckId, dependsOn: nextDepends });
        if (this._onUpdate) {
          this._onUpdate({
            kind: "check",
            phaseId: phase.id,
            checkId: targetCheckId,
            dependsOn: nextDepends,
          });
        }
        setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
        this._phase = phase;
        this.render(true);
        return;
      }

      if (payloadType !== "line") return;
      const lineId = payload?.lineId;
      const lineType = payload?.lineType;
      if (!lineId || (lineType !== "success" && lineType !== "failure")) return;
      const listKey = lineType === "success" ? "successLines" : "failureLines";
      const line = (phase[listKey] ?? []).find((entry) => entry.id === lineId);
      if (!line) return;
      const hasChecks = Array.isArray(line.dependsOnChecks) && line.dependsOnChecks.length;
      const hasGroups = Array.isArray(line.dependsOnGroups) && line.dependsOnGroups.length;
      const isOnlyTarget = hasChecks
        && line.dependsOnChecks.length === 1
        && line.dependsOnChecks[0] === targetCheckId
        && !hasGroups;
      if (isOnlyTarget) return;

      let mode = "move";
      if (hasChecks || hasGroups) {
        const targetLabel = event.currentTarget?.querySelector(".drep-flow-check-name")?.textContent?.trim() || "this check";
        mode = await promptLineAssignment(targetLabel);
        if (!mode) return;
      }

      let nextChecks = [];
      if (mode === "copy") {
        const existing = Array.isArray(line.dependsOnChecks) ? line.dependsOnChecks : [];
        nextChecks = Array.from(new Set([...existing, targetCheckId]));
      } else {
        nextChecks = [targetCheckId];
      }
      const nextGroups = [];
      line.dependsOnChecks = nextChecks;
      line.dependsOnGroups = nextGroups;
      if (this._onUpdate) {
        this._onUpdate({
          kind: "line",
          phaseId: phase.id,
          lineId,
          lineType,
          dependsOnChecks: nextChecks,
          dependsOnGroups: nextGroups,
        });
      }
      captureFlowCollapse();
      captureFlowCollapse();
      setTrackerPhaseConfig(this._trackerId, normalizePhaseConfig(phaseConfig));
      this._phase = phase;
      this.render(true);
    });
  }

}

class DowntimeRepDepEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._dep = options.dep ?? { id: "", type: "block" };
    this._onSave = typeof options.onSave === "function" ? options.onSave : null;
    this._trackerId = options.trackerId ?? getCurrentTrackerId();
    this._forceType = null;
  }

  static DEFAULT_OPTIONS = {
    id: "indy-downtime-dep-editor",
    tag: "form",
    classes: ["indy-downtime", "drep-settings", "drep-dialog", "drep-dep-editor"],
    window: {
      title: "Edit Dependency",
      icon: "fas fa-link",
      contentClasses: ["standard-form"],
      resizable: false,
    },
    position: {
      width: 420,
      height: "auto",
    },
    form: {
      handler: DowntimeRepDepEditor._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime-dep-editor.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const dep = this._dep ?? {};
    const type = dep.type ?? "block";
    const dcPenalty = Number.isFinite(dep.dcPenalty) && dep.dcPenalty > 0 ? dep.dcPenalty : 1;
    const overrideSkill = dep.overrideSkill ?? "";
    const overrideDc = typeof dep.overrideDc === "string"
      ? dep.overrideDc
      : (Number.isFinite(dep.overrideDc) ? dep.overrideDc : "");
    const rollMode = getCheckRollMode(this._trackerId);
    return {
      ...context,
      depId: dep.id ?? "",
      depType: type,
      dcPenalty,
      overrideSkill,
      overrideDc,
      skillOptions: getSkillOptions(),
      isD100Mode: rollMode === "d100" || rollMode === "narrative",
      isNarrativeMode: rollMode === "narrative",
      difficultyOptions: getDifficultyOptions(),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = $(this.element);
    const trackerId = getCurrentTrackerId();
    const trackerIcon = getTabIcon(trackerId) || "fas fa-fire";
    this.options.window.icon = trackerIcon;
    const appRoot = html.closest(".app");
    const headerIcon = appRoot.find(".window-header .window-title i").first();
    if (headerIcon.length) {
      headerIcon.attr("class", trackerIcon);
    } else {
      appRoot.find(".window-header .window-title").prepend(
        `<i class="${trackerIcon}"></i> `
      );
    }
    const windowIcon = appRoot.find(".window-header .window-icon");
    if (windowIcon.length) {
      windowIcon.html(`<i class="${trackerIcon}"></i>`);
    }

    const typeSelect = html.find("[name='depType']");
    const toggleFields = () => {
      const selected = String(typeSelect.val() ?? "block");
      html.find(".drep-dep-penalty").toggle(selected === "harder");
      html.find(".drep-dep-override").toggle(selected === "override");
    };
    typeSelect.on("change", toggleFields);
    toggleFields();

    html.find("[data-drep-action='cancel']").on("click", (event) => {
      event.preventDefault();
      this.close();
    });
    html.find("[data-drep-action='reset']").on("click", (event) => {
      event.preventDefault();
      this._forceType = "block";
      html.find("[type='submit']").trigger("click");
    });
  }

  static async _onSubmit(event, form, formData) {
    const app = form?.owner ?? this;
    if (!app) return;
    const data = foundry.utils.expandObject(formData.object ?? {});
    const type = app._forceType ?? String(data.depType ?? "block");
    const kind = app._dep?.kind ?? String(data.depKind ?? "check");
    const nextDep = { id: app._dep?.id ?? "", type, kind };
    if (type === "harder") {
      const penaltyRaw = Number(data.dcPenalty);
      nextDep.dcPenalty = Number.isFinite(penaltyRaw) && penaltyRaw > 0 ? penaltyRaw : 1;
    }
    if (type === "override") {
      const skillValue = String(data.overrideSkill ?? "").trim();
      if (skillValue) nextDep.overrideSkill = skillValue;
      const rollMode = getCheckRollMode(app._trackerId);
      if (rollMode === "d100" || rollMode === "narrative") {
        const difficultyValue = String(data.overrideDc ?? "").trim();
        if (difficultyValue) nextDep.overrideDc = difficultyValue;
      } else {
        const dcValue = Number(data.overrideDc);
        if (Number.isFinite(dcValue)) nextDep.overrideDc = dcValue;
      }
    }
    if (app._onSave) {
      app._onSave(nextDep);
    }
  }
}

class DowntimeRepProgressState extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(...args) {
    super(...args);
    const options = args?.[0] ?? {};
    this._trackerId = options.trackerId ?? getCurrentTrackerId();
  }
  static DEFAULT_OPTIONS = {
    id: "indy-downtime-progress-state",
    tag: "form",
    classes: ["indy-downtime", "drep-settings", "drep-dialog"],
    window: {
      title: "Progress State",
      icon: "fas fa-chart-line",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: {
      width: 560,
      height: "auto",
    },
    form: {
      handler: DowntimeRepProgressState._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime-progress-state.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = getWorldState(this._trackerId);
    const phaseConfig = getPhaseConfig(this._trackerId);
    const phases = phaseConfig.map((phase, index) => {
      const phaseState = state.phases[phase.id] ?? {};
      const checkRows = getPhaseChecks(phase).map((check) => ({
        id: check.id,
        name: getPhaseCheckLabel(check),
        value: Number(phaseState.checkProgress?.[check.id] ?? 0),
        target: getPhaseCheckTarget(check),
      }));
      return {
        id: phase.id,
        name: phase.name,
        number: index + 1,
        target: phase.target,
        progress: Number(phaseState.progress ?? 0),
        completed: Boolean(phaseState.completed),
        failuresInRow: Number(phaseState.failuresInRow ?? 0),
        checkRows,
      };
    });

    return {
      ...context,
      trackerId: this._trackerId,
      checkCount: state.checkCount ?? 0,
      phases,
    };
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object ?? {});
    const trackerId = data.trackerId ?? getCurrentTrackerId();
    const state = getWorldState(trackerId);
    const phaseConfig = getPhaseConfig(trackerId);
    applyStateOverridesFromForm(state, data, phaseConfig);
    await setWorldState(state, trackerId);
    rerenderCharacterSheets();
    rerenderSettingsApps();
    ui.notifications.info("Indy Downtime Tracker: progress state saved.");
  }
}



class DowntimeRepImportExportDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._trackerId = options.trackerId ?? getCurrentTrackerId();
    this._notes = options.notes ?? "";
    this._filename = options.filename ?? "indy-downtime.json";
    this._getPayload = typeof options.getPayload === "function" ? options.getPayload : null;
    this._applyPayload = typeof options.applyPayload === "function" ? options.applyPayload : null;
    this._title = options.title ?? "Import/Export";
  }

  static DEFAULT_OPTIONS = {
    id: "indy-downtime-import-export",
    classes: ["indy-downtime", "drep-settings", "drep-dialog"],
    window: {
      title: "Indy Downtime Tracker: Import/Export",
      icon: "fas fa-file-export",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: {
      width: 640,
      height: "auto",
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime-import-export.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      jsonText: "",
      notes: this._notes,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (this._title) {
      this.options.window.title = this._title;
    }
    const html = $(this.element);
    const trackerIcon = getTabIcon(this._trackerId) || "fas fa-fire";
    this.options.window.icon = trackerIcon;
    const appRoot = html.closest(".app");
    const headerIcon = appRoot.find(".window-header .window-title i").first();
    if (headerIcon.length) {
      headerIcon.attr("class", trackerIcon);
    } else {
      appRoot.find(".window-header .window-title").prepend(
        `<i class="${trackerIcon}"></i> `
      );
    }
    const windowIcon = appRoot.find(".window-header .window-icon");
    if (windowIcon.length) {
      windowIcon.html(`<i class="${trackerIcon}"></i>`);
    }

    const textarea = html.find("[data-drep-io='json']");
    html.find("[data-drep-action='export']").on("click", (event) => {
      event.preventDefault();
      const payload = this._getPayload ? this._getPayload() : null;
      if (!payload) return;
      textarea.val(JSON.stringify(payload, null, 2));
    });
    html.find("[data-drep-action='download']").on("click", (event) => {
      event.preventDefault();
      const data = textarea.val() || JSON.stringify(this._getPayload ? this._getPayload() : {}, null, 2);
      saveJsonToFile(data, this._filename);
    });
    html.find("[data-drep-action='import']").on("click", async (event) => {
      event.preventDefault();
      const raw = textarea.val();
      if (!raw || !this._applyPayload) return;
      const parsed = parseJsonPayload(raw);
      if (!parsed) return;
      await this._applyPayload(parsed);
    });
  }
}

class DowntimeRepPhaseConfigExport extends DowntimeRepImportExportDialog {
  constructor(options = {}) {
    const trackerId = options.trackerId ?? getCurrentTrackerId();
    const phaseId = options.phaseId ?? getPhaseConfig(trackerId)[0]?.id ?? "phase1";
    super({
      ...options,
      title: "Indy Downtime Tracker: Export/Import Phase",
      notes: "Export or import the selected phase only.",
      filename: `indy-downtime-phase-${phaseId}.json`,
      getPayload: () => ({
        module: MODULE_ID,
        version: game.modules.get(MODULE_ID)?.version ?? "",
        exportedAt: new Date().toISOString(),
        phaseId,
        phase: getPhaseConfig(trackerId).find((entry) => entry.id === phaseId) ?? null,
      }),
      applyPayload: async (parsed) => {
        const incoming = parsed?.phase ?? parsed;
        if (!incoming || typeof incoming !== "object") {
          ui.notifications.error("Indy Downtime Tracker: invalid phase payload.");
          return;
        }
        const config = getPhaseConfig(trackerId);
        const index = config.findIndex((entry) => entry.id === phaseId);
        if (index < 0) {
          ui.notifications.error("Indy Downtime Tracker: selected phase not found.");
          return;
        }
        const next = foundry.utils.deepClone(incoming);
        next.id = phaseId;
        config[index] = next;
        setTrackerPhaseConfig(trackerId, normalizePhaseConfig(config));
        rerenderCharacterSheets();
        rerenderSettingsApps();
        if (typeof options.onImport === "function") {
          options.onImport();
        } else if (options.settingsAppId && ui.windows[options.settingsAppId]) {
          ui.windows[options.settingsAppId].render(true, { focus: false });
        }
        ui.notifications.info("Indy Downtime Tracker: phase imported.");
      },
    });
  }
}


class DowntimeRepSettingsExport extends DowntimeRepImportExportDialog {
  constructor(options = {}) {
    super({
      ...options,
      title: "Indy Downtime Tracker: Export/Import Settings",
      notes: "Export or import all Indy Downtime Tracker settings as JSON.",
      filename: "indy-downtime-settings.json",
      getPayload: () => getSettingsExportPayload(),
      applyPayload: async (parsed) => {
        await applySettingsImportPayload(parsed);
        refreshSheetTabLabel();
        rerenderCharacterSheets();
        rerenderSettingsApps();
        ui.notifications.info("Indy Downtime Tracker: settings imported.");
      },
    });
  }
}

class DowntimeRepStateExport extends DowntimeRepImportExportDialog {
  constructor(options = {}) {
    super({
      ...options,
      title: "Indy Downtime Tracker: Export/Import State",
      notes: "Export or import all Indy Downtime Tracker state as JSON.",
      filename: "indy-downtime-state.json",
      getPayload: () => getStateExportPayload(),
      applyPayload: async (parsed) => {
        await applyStateImportPayload(parsed);
        rerenderCharacterSheets();
        rerenderSettingsApps();
        ui.notifications.info("Indy Downtime Tracker: state imported.");
      },
    });
  }
}


export {
  DowntimeRepSettings,
  DowntimeRepSkillOverrides,
  DowntimeRepSettingsExport,
  DowntimeRepStateExport,
};

Hooks.once("init", () => {
  if (!game.indyDowntime) game.indyDowntime = {};
  game.indyDowntime.DowntimeRepPhaseFlow = DowntimeRepPhaseFlow;
});
