import { ApplicationV2, HandlebarsApplicationMixin } from "./foundry-app.js";
import {
  DEFAULT_HEADER_LABEL,
  DEFAULT_TAB_LABEL,
  DEFAULT_INTERVAL_LABEL,
  DEFAULT_TAB_ICON,
  DEFAULT_TRACKER_NAME,
  MODULE_ID,
  DEFAULT_PHASE_CONFIG,
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
  getPhaseChecks,
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
  shouldHideDc,
  shouldShowLockedChecks,
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
    const headerLabel = getHeaderLabel(trackerId);
    const tabLabel = getTabLabel(trackerId);
    const intervalLabel = getIntervalLabel(trackerId);
    const restrictedActorUuids = getRestrictedActorUuids(trackerId);
    const trackerOptions = getTrackers().map((entry, index) => ({
      id: entry.id,
      label: entry.name ? `${entry.name}` : `Tracker ${index + 1}`,
    }));

    return {
      ...context,
      trackerOptions,
      currentTrackerId: trackerId,
      trackerName: tracker?.name ?? DEFAULT_TRACKER_NAME,
      trackerTabIcon: getTabIcon(trackerId),
      hideDcFromPlayers: Boolean(tracker?.hideDcFromPlayers),
      showLockedChecksToPlayers: tracker?.showLockedChecksToPlayers !== false,
      showPhasePlanToPlayers: Boolean(tracker?.showPhasePlanToPlayers),
      showFlowRelationships: tracker?.showFlowRelationships !== false,
      showFlowLines: tracker?.showFlowLines !== false,
      isSingleTracker: trackerOptions.length <= 1,
      state,
      criticalBonusEnabled: state.criticalBonusEnabled,
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
        addTracker();
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
      hideDcFromPlayers: Boolean(formData.hideDcFromPlayers),
      showLockedChecksToPlayers: Boolean(formData.showLockedChecksToPlayers),
      showPhasePlanToPlayers: Boolean(formData.showPhasePlanToPlayers),
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
      entry.success = !entry.success;
      if (!entry.success) {
        entry.criticalBonusApplied = false;
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
          dependsOnValue: normalizeCheckDependencies(check.dependsOn ?? []).map((dep) => dep.id).join(", "),
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

      return {
        ...phase,
        number: index + 1,
        isPhase1: index === 0,
        groups,
        successLines,
        failureLines,
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

      if (payload.kind === "check") {
        const checkId = payload.checkId;
        if (!checkId) return;
        const dependsOn = normalizeCheckDependencies(payload.dependsOn ?? []);
        const dependsOnIds = dependsOn.map((dep) => dep.id);
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
      const line = (phase[listKey] ?? []).find((entry) => entry.id === lineId);
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
    this._onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;
    this._readOnly = Boolean(options.readOnly);
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
    const phase = this._phase ?? phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
    const phaseNumber = phase ? getPhaseNumber(phase.id, this._trackerId) : 1;
    const phaseName = phase?.name ?? "Phase";

    const state = getWorldState(this._trackerId);
    const phaseState = state?.phases?.[phase?.id] ?? {};
    const checkProgress = phaseState?.checkProgress ?? {};
    const redactLockedChecks = this._readOnly && !shouldShowLockedChecks(this._trackerId);
    const groupCounts = {};
    if (Array.isArray(state?.log)) {
      for (const entry of state.log) {
        if (!entry || entry.type === "phase-complete") continue;
        if (phase?.id && entry.phaseId && entry.phaseId !== phase.id) continue;
        const groupId = entry.groupId;
        if (!groupId) continue;
        groupCounts[groupId] = (groupCounts[groupId] ?? 0) + 1;
      }
    }

    const checkLabels = {};
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
        return `Harder until completed (+${penalty} DC)`;
      }
      if (type === "advantage") return "Advantage when completed";
      if (type === "disadvantage") return "Disadvantage until completed";
      if (type === "override") {
        const parts = [];
        if (dep?.overrideSkill) parts.push(getSkillLabel(dep.overrideSkill));
        if (Number.isFinite(dep?.overrideDc)) parts.push(`DC ${dep.overrideDc}`);
        const detail = parts.length ? parts.join(" ") : "Override";
        return `Overrides when completed (${detail})`;
      }
      return "Blocks until completed";
    };

    const formatDependencyLabel = (dep) => {
      const base = checkLabels[dep.id] || dep.id;
      const type = dep?.type ?? "block";
      if (type === "block") return base;
      if (type === "harder") {
        const penalty = Number.isFinite(dep?.dcPenalty) && dep.dcPenalty > 0 ? dep.dcPenalty : 1;
        return `${base} (DC +${penalty})`;
      }
      if (type === "advantage") return `${base} (Advantage)`;
      if (type === "disadvantage") return `${base} (Disadvantage)`;
      if (type === "override") {
        const parts = [];
        if (dep?.overrideSkill) parts.push(getSkillLabel(dep.overrideSkill));
        if (Number.isFinite(dep?.overrideDc)) parts.push(`DC ${dep.overrideDc}`);
        const detail = parts.length ? parts.join(" ") : "Override";
        return `${base} (${detail})`;
      }
      return base;
    };

    for (const line of phase?.successLines ?? []) {
      if (!line?.text) continue;
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
      if (!line?.text) continue;
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
        const skillLabel = check.skill ? getSkillLabel(check.skill) : "";
        const name = check.name || skillLabel || "Check";
        const complete = isCheckComplete(check, checkProgress);
        const unlocked = isCheckUnlocked(phase, check, checkProgress);
        const group = getPhaseGroups(phase).find((entry) => entry.id === check.groupId);
        const groupLimit = Number(group?.maxChecks ?? 0);
        const groupUsed = Number(groupCounts?.[check.groupId] ?? 0);
        const groupAvailable = !groupLimit || groupUsed < groupLimit;
        const groupMaxed = Boolean(groupLimit) && !groupAvailable;
        const isLocked = !unlocked || complete || groupMaxed;
        const displayName = redactLockedChecks && isLocked && !complete ? "???" : name;
        const displaySkillLabel = redactLockedChecks && isLocked && !complete ? "???" : skillLabel;
        checkLabels[check.id] = displayName;
        return {
          id: check.id,
          name: displayName,
          skillLabel: displaySkillLabel,
          complete,
          locked: isLocked,
          groupMaxed: groupMaxed && !complete,
          dc: Number(check.dc ?? 0),
          dependsOn: normalizeCheckDependencies(check.dependsOn ?? []),
          successLines: successByCheck[check.id] ?? [],
          failureLines: failureByCheck[check.id] ?? [],
        };
      });
      return {
        id: group.id,
        name: group.name || "Group",
        maxChecks: Number(group.maxChecks ?? 0),
        checks,
        successLines: successByGroup[group.id] ?? [],
        failureLines: failureByGroup[group.id] ?? [],
      };
    });

    for (const group of groups) {
      for (const check of group.checks) {
        check.dependsOnEntries = (check.dependsOn ?? []).map((dep) => ({
          id: dep.id,
          label: formatDependencyLabel(dep),
          detail: formatDependencyDetail(dep),
          type: dep.type ?? "block",
          dcPenalty: dep.dcPenalty ?? 0,
          overrideSkill: dep.overrideSkill ?? "",
          overrideDc: dep.overrideDc ?? null,
          complete: isDependencyComplete(phase, dep.id, checkProgress),
        }));
      }
    }

    return {
      ...context,
      phaseNumber,
      phaseName,
      groups,
      unassignedSuccess,
      unassignedFailure,
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
      const phase = this._phase ?? phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      const listKey = lineType === "success" ? "successLines" : "failureLines";
      const line = (phase[listKey] ?? []).find((entry) => entry.id === lineId);
      if (!line) return;

      const checkId = lineCard?.closest(".drep-flow-check")?.dataset?.drepCheckId ?? "";
      const groupId = !checkId
        ? lineCard?.closest(".drep-flow-lane")?.dataset?.drepGroupId ?? ""
        : "";

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
      this._phase = phase;
      this.render(true);
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
      const targetCheckId = chip?.dataset?.targetCheckId;
      if (!depId || !targetCheckId) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = this._phase ?? phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      let targetCheck = null;
      for (const group of phase.groups ?? []) {
        targetCheck = (group.checks ?? []).find((entry) => entry.id === targetCheckId) ?? null;
        if (targetCheck) break;
      }
      if (!targetCheck) return;
      const current = normalizeCheckDependencies(targetCheck.dependsOn ?? []);
      const nextDepends = current.filter((dep) => dep.id !== depId);
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
      this._phase = phase;
      this.render(true);
    });


    html.on("contextmenu.drepFlow", ".drep-flow-dep", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const chip = event.currentTarget?.closest(".drep-flow-dep");
      const depId = chip?.dataset?.depId;
      const targetCheckId = chip?.dataset?.targetCheckId;
      if (!depId || !targetCheckId) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = this._phase ?? phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      let targetCheck = null;
      for (const group of phase.groups ?? []) {
        targetCheck = (group.checks ?? []).find((entry) => entry.id === targetCheckId) ?? null;
        if (targetCheck) break;
      }
      if (!targetCheck) return;

      const current = normalizeCheckDependencies(targetCheck.dependsOn ?? []);
      const applyDependency = (newDep) => {
        const nextDepends = current.map((entry) => entry.id === depId ? newDep : entry);
        targetCheck.dependsOn = nextDepends;
        if (this._onUpdate) {
          this._onUpdate({
            kind: "check",
            phaseId: phase.id,
            checkId: targetCheckId,
            dependsOn: nextDepends,
          });
        }
        this._phase = phase;
        this.render(true);
      };

      const depEntry = current.find((entry) => entry.id === depId) ?? { id: depId, type: "block" };
      new DowntimeRepDepEditor({
        dep: depEntry,
        onSave: applyDependency,
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
      const phase = this._phase ?? phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
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
      if (!targetCheckId) return;
      const raw = event.originalEvent?.dataTransfer?.getData("text/plain") ?? "";
      if (!raw) return;
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        return;
      }
      const payloadType = payload?.type;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = this._phase ?? phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;

      if (payloadType === "check") {
        const sourceCheckId = payload?.checkId;
        if (!sourceCheckId || sourceCheckId === targetCheckId) return;
        let targetCheck = null;
        for (const group of phase.groups ?? []) {
          targetCheck = (group.checks ?? []).find((entry) => entry.id === targetCheckId) ?? null;
          if (targetCheck) break;
        }
        if (!targetCheck) return;
        const current = normalizeCheckDependencies(targetCheck.dependsOn ?? []);
        if (current.some((dep) => dep.id === sourceCheckId)) return;
        const nextDepends = [...current, { id: sourceCheckId, type: "block" }];
        targetCheck.dependsOn = nextDepends;
        if (this._onUpdate) {
          this._onUpdate({
            kind: "check",
            phaseId: phase.id,
            checkId: targetCheckId,
            dependsOn: nextDepends,
          });
        }
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
    const overrideDc = Number.isFinite(dep.overrideDc) ? dep.overrideDc : "";
    return {
      ...context,
      depId: dep.id ?? "",
      depType: type,
      dcPenalty,
      overrideSkill,
      overrideDc,
      skillOptions: getSkillOptions(),
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
    const nextDep = { id: app._dep?.id ?? "", type };
    if (type === "harder") {
      const penaltyRaw = Number(data.dcPenalty);
      nextDep.dcPenalty = Number.isFinite(penaltyRaw) && penaltyRaw > 0 ? penaltyRaw : 1;
    }
    if (type === "override") {
      const skillValue = String(data.overrideSkill ?? "").trim();
      if (skillValue) nextDep.overrideSkill = skillValue;
      const dcValue = Number(data.overrideDc);
      if (Number.isFinite(dcValue)) nextDep.overrideDc = dcValue;
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

class DowntimeRepSettingsExport extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "indy-downtime-settings-export",
    classes: ["indy-downtime", "drep-settings", "drep-dialog"],
    window: {
      title: "Indy Downtime Tracker: Export/Import Settings",
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
      template: "modules/indy-downtime/templates/indy-downtime-settings-export.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      jsonText: "",
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

    const textarea = html.find("[data-drep-io='json']");
    html.find("[data-drep-action='export']").on("click", (event) => {
      event.preventDefault();
      textarea.val(JSON.stringify(getSettingsExportPayload(), null, 2));
    });
    html.find("[data-drep-action='download']").on("click", (event) => {
      event.preventDefault();
      const data = textarea.val() || JSON.stringify(getSettingsExportPayload(), null, 2);
      saveJsonToFile(data, "indy-downtime-settings.json");
    });
    html.find("[data-drep-action='import']").on("click", async (event) => {
      event.preventDefault();
      const raw = textarea.val();
      if (!raw) return;
      const parsed = parseJsonPayload(raw);
      if (!parsed) return;
      await applySettingsImportPayload(parsed);
      refreshSheetTabLabel();
      rerenderCharacterSheets();
      rerenderSettingsApps();
      ui.notifications.info("Indy Downtime Tracker: settings imported.");
    });
  }
}

class DowntimeRepStateExport extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "indy-downtime-state-export",
    classes: ["indy-downtime", "drep-settings", "drep-dialog"],
    window: {
      title: "Indy Downtime Tracker: Export/Import State",
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
      template: "modules/indy-downtime/templates/indy-downtime-state-export.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      jsonText: "",
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

    const textarea = html.find("[data-drep-io='json']");
    html.find("[data-drep-action='export']").on("click", (event) => {
      event.preventDefault();
      textarea.val(JSON.stringify(getStateExportPayload(), null, 2));
    });
    html.find("[data-drep-action='download']").on("click", (event) => {
      event.preventDefault();
      const data = textarea.val() || JSON.stringify(getStateExportPayload(), null, 2);
      saveJsonToFile(data, "indy-downtime-state.json");
    });
    html.find("[data-drep-action='import']").on("click", async (event) => {
      event.preventDefault();
      const raw = textarea.val();
      if (!raw) return;
      const parsed = parseJsonPayload(raw);
      if (!parsed) return;
      await applyStateImportPayload(parsed);
      rerenderCharacterSheets();
      rerenderSettingsApps();
      ui.notifications.info("Indy Downtime Tracker: state imported.");
    });
  }
}

export {
  DowntimeRepSettings,
  DowntimeRepPhaseConfig,
  DowntimeRepProgressState,
  DowntimeRepSettingsExport,
  DowntimeRepStateExport,
};

Hooks.once("init", () => {
  if (!game.indyDowntime) game.indyDowntime = {};
  game.indyDowntime.DowntimeRepPhaseFlow = DowntimeRepPhaseFlow;
});
