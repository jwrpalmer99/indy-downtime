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
  getPhaseChecks,
  getPhaseCheckLabel,
  getPhaseCheckTarget,
  getRestrictedActorUuids,
  getSkillAliases,
  getSkillOptions,
  getTabIcon,
  getTabLabel,
  getTrackerById,
  getTrackers,
  getWorldState,
  initDependencyDragDrop,
  isPhaseUnlocked,
  normalizePhaseConfig,
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
    const phaseConfig = getPhaseConfig(trackerId);
    const phaseOptions = phaseConfig.map((phase) => {
      const unlocked = isPhaseUnlocked(phase.id, state, trackerId, phaseConfig);
      const completed = state.phases[phase.id]?.completed ?? false;
      const status = completed ? "Complete" : unlocked ? "Available" : "Locked";
      return {
        id: phase.id,
        label: `${phase.name} (${status})`,
        unlocked,
        completed,
      };
    });
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
      isSingleTracker: trackerOptions.length <= 1,
      state,
      phaseOptions,
      activePhaseId: state.activePhaseId,
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

    html.find("[name='currentTrackerId']").on("change", (event) => {
      const selected = $(event.currentTarget).val();
      if (!selected) return;
      setCurrentTrackerId(selected);
      this.render();
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
    html.find("[data-drep-action]").on("click", (event) => {
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
        Dialog.confirm({
          title: "Remove Tracker",
          content: "<p>Remove the current tracker? This cannot be undone.</p>",
        }).then(async (confirmed) => {
          if (!confirmed) return;
          await removeCurrentTracker();
          registerSheetTab();
          updateTidyTabLabel();
          rerenderCharacterSheets();
          this.render();
        });
        return;
      }
      if (action === "open-skill-aliases") {
        new DowntimeRepSkillAliases().render(true);
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

    const requestedPhaseId = formData.activePhaseId;
    if (requestedPhaseId) {
      if (!isPhaseUnlocked(requestedPhaseId, state, trackerId, phaseConfig)) {
        ui.notifications.warn(
          "Indy Downtime Tracker: selected phase is still locked."
        );
      } else if (state.phases[requestedPhaseId]?.completed) {
        ui.notifications.warn(
          "Indy Downtime Tracker: selected phase is already complete."
        );
      } else {
        state.activePhaseId = requestedPhaseId;
      }
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

    const confirmed = await Dialog.confirm({
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
      const confirmed = await Dialog.confirm({
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

class DowntimeRepSkillAliases extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(...args) {
    super(...args);
    const aliases = getSkillAliases();
    this._rows = Object.entries(aliases).map(([key, value]) => ({
      key,
      value,
    }));
    if (!this._rows.length) {
      this._rows.push({ key: "", value: "" });
    }
  }

  static DEFAULT_OPTIONS = {
    id: "indy-downtime-skill-aliases",
    tag: "form",
    classes: ["indy-downtime", "drep-settings", "drep-dialog"],
    window: {
      title: "Skill Alias Mapping",
      icon: "fas fa-link",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: {
      width: 520,
      height: "auto",
    },
    form: {
      handler: DowntimeRepSkillAliases._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
  };

  static PARTS = {
    form: {
      template: "modules/indy-downtime/templates/indy-downtime-skill-aliases.hbs",
    },
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      aliasRows: this._rows,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = $(this.element);
    html.find("[data-drep-action='add-alias']").on("click", (event) => {
      event.preventDefault();
      this._rows.push({ key: "", value: "" });
      this.render(true);
    });
    html.find("[data-drep-action='remove-alias']").on("click", (event) => {
      event.preventDefault();
      const index = Number(event.currentTarget?.dataset?.index);
      if (!Number.isFinite(index)) return;
      this._rows.splice(index, 1);
      if (!this._rows.length) {
        this._rows.push({ key: "", value: "" });
      }
      this.render(true);
    });
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object ?? {});
    const rows = Object.values(data.aliases ?? {});
    const mapped = {};
    for (const row of rows) {
      const key = String(row?.key ?? "").trim();
      const value = String(row?.value ?? "").trim();
      if (!key || !value) continue;
      mapped[key] = value;
    }
    await game.settings.set(MODULE_ID, "skillAliases", mapped);
    rerenderCharacterSheets();
    rerenderSettingsApps();
    ui.notifications.info("Indy Downtime Tracker: skill aliases saved.");
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
    const skillAliases = getSkillAliases();
    const skillOptions = getSkillOptions();
    const phases = this._phaseConfig.map((phase, index) => {
      const groups = getPhaseGroups(phase).map((group) => {
        const checks = (group.checks ?? []).map((check) => ({
          id: check.id,
          name: check.name ?? "",
          skill: check.skill ?? "",
          description: check.description ?? "",
          dc: Number(check.dc ?? 0),
          dependsOnValue: (check.dependsOn ?? []).join(", "),
        }));
        return {
          id: group.id,
          name: group.name ?? "",
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
    initDependencyDragDrop(html, debugLog);
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
        const base = order.length ? order.map((id) => ({ id })) : this._phaseConfig;
        this._phaseConfig = applyPhaseConfigFormData(base, data);
      } catch (error) {
        debugLog("Phase config sync failed", { error: error?.message });
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
      captureCollapseState();
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
      captureCollapseState();
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
      captureCollapseState();
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
      captureCollapseState();
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
      captureCollapseState();
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
      captureCollapseState();
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
      captureCollapseState();
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
      captureCollapseState();
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
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object ?? {});
    const trackerId = data.trackerId ?? getCurrentTrackerId();
    const order = parseList(data.phaseOrder);
    const phaseConfig = order.length ? order.map((id) => ({ id })) : getPhaseConfig(trackerId);
    const updated = applyPhaseConfigFormData(phaseConfig, data);
    setTrackerPhaseConfig(trackerId, updated);
    rerenderCharacterSheets();
    rerenderSettingsApps();
    ui.notifications.info("Indy Downtime Tracker: phase configuration saved.");
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
    const skillAliases = getSkillAliases();
    const phases = phaseConfig.map((phase, index) => {
      const phaseState = state.phases[phase.id] ?? {};
      const checkRows = getPhaseChecks(phase).map((check) => ({
        id: check.id,
        name: getPhaseCheckLabel(check, skillAliases),
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
  DowntimeRepSkillAliases,
  DowntimeRepPhaseConfig,
  DowntimeRepProgressState,
  DowntimeRepSettingsExport,
  DowntimeRepStateExport,
};
