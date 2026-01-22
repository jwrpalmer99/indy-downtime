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
  getPhaseCheckLabel,
  getPhaseCheckTarget,
  getRestrictedActorUuids,
  getSkillAliases,
  getSkillLabel,
  getSkillOptions,
  getTabIcon,
  getTabLabel,
  getTrackerById,
  getTrackers,
  resolveSkillKey,
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
      showLockedChecksToPlayers: tracker?.showLockedChecksToPlayers !== false,
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
      showLockedChecksToPlayers: Boolean(formData.showLockedChecksToPlayers),
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

    const applyFlowUpdate = (payload) => {
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
        const dependsOn = Array.isArray(payload.dependsOn) ? payload.dependsOn : [];
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
          input.value = dependsOn.join(", ");
          renderCheckDeps(input);
        }
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
    const skillAliases = getSkillAliases();
    const phaseNumber = phase ? getPhaseNumber(phase.id, this._trackerId) : 1;
    const phaseName = phase?.name ?? "Phase";

    const checkLabels = {};
    const successByCheck = {};
    const failureByCheck = {};
    const successByGroup = {};
    const failureByGroup = {};
    const unassignedSuccess = [];
    const unassignedFailure = [];

    for (const line of phase?.successLines ?? []) {
      if (!line?.text) continue;
      const hasChecks = Array.isArray(line.dependsOnChecks) && line.dependsOnChecks.length;
      const hasGroups = Array.isArray(line.dependsOnGroups) && line.dependsOnGroups.length;
      if (hasChecks) {
        for (const checkId of line.dependsOnChecks) {
          successByCheck[checkId] = successByCheck[checkId] ?? [];
          successByCheck[checkId].push({ id: line.id, text: line.text });
        }
      } else if (hasGroups) {
        for (const groupId of line.dependsOnGroups) {
          successByGroup[groupId] = successByGroup[groupId] ?? [];
          successByGroup[groupId].push({ id: line.id, text: line.text });
        }
      } else {
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
      } else if (hasGroups) {
        for (const groupId of line.dependsOnGroups) {
          failureByGroup[groupId] = failureByGroup[groupId] ?? [];
          failureByGroup[groupId].push({ id: line.id, text: line.text });
        }
      } else {
        unassignedFailure.push({ id: line.id, text: line.text });
      }
    }

    const groups = getPhaseGroups(phase).map((group) => {
      const checks = (group.checks ?? []).map((check) => {
        const skillKey = check.skill ? resolveSkillKey(check.skill, skillAliases) : "";
        const skillLabel = skillKey ? getSkillLabel(skillKey) : (check.skill ?? "");
        const name = check.name || skillLabel || "Check";
        checkLabels[check.id] = name;
        return {
          id: check.id,
          name,
          skillLabel,
          dc: Number(check.dc ?? 0),
          dependsOn: check.dependsOn ?? [],
          successLines: successByCheck[check.id] ?? [],
          failureLines: failureByCheck[check.id] ?? [],
        };
      });
      return {
        id: group.id,
        name: group.name || "Group",
        checks,
        successLines: successByGroup[group.id] ?? [],
        failureLines: failureByGroup[group.id] ?? [],
      };
    });

    for (const group of groups) {
      for (const check of group.checks) {
        check.dependsOnEntries = (check.dependsOn ?? []).map((id) => ({ id, label: checkLabels[id] || id }));
      }
    }

    return {
      ...context,
      phaseNumber,
      phaseName,
      groups,
      unassignedSuccess,
      unassignedFailure,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = $(this.element);
    html.find(".drep-flow-line-chip").attr("draggable", true);
    html.find(".drep-flow-check").attr("draggable", true);

    const promptLineAssignment = (targetLabel) => new Promise((resolve) => {
      const content = `<p>Copy or move this line to <strong>${targetLabel}</strong>?</p>`;
      new Dialog({
        title: "Assign Line",
        content,
        buttons: {
          copy: {
            label: "Copy",
            callback: () => resolve("copy"),
          },
          move: {
            label: "Move",
            callback: () => resolve("move"),
          },
          cancel: {
            label: "Cancel",
            callback: () => resolve(null),
          },
        },
        default: "move",
        close: () => resolve(null),
      }).render(true);
    });

    html.on("click", ".drep-flow-line-remove", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const lineId = event.currentTarget?.parentElement?.dataset?.drepLineId;
      const lineType = event.currentTarget?.parentElement?.dataset?.drepLineType;
      if (!lineId || !lineType) return;

      const phaseConfig = getPhaseConfig(this._trackerId);
      const phase = this._phase ?? phaseConfig.find((entry) => entry.id === this._phaseId) ?? phaseConfig[0];
      if (!phase) return;
      const listKey = lineType === "success" ? "successLines" : "failureLines";
      const line = (phase[listKey] ?? []).find((entry) => entry.id === lineId);
      if (!line) return;
      line.dependsOnChecks = [];
      line.dependsOnGroups = [];
      if (this._onUpdate) {
        this._onUpdate({
          kind: "line",
          phaseId: phase.id,
          lineId,
          lineType,
          dependsOnChecks: [],
          dependsOnGroups: [],
        });
      }
      this._phase = phase;
      this.render(true);
    });

    html.on("dragstart", ".drep-flow-line-chip", (event) => {
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

    html.on("dragstart", ".drep-flow-check", (event) => {
      if (event.target?.closest(".drep-flow-line-chip")) return;
      const checkId = event.currentTarget?.dataset?.drepCheckId;
      if (!checkId) return;
      const payload = JSON.stringify({ type: "check", checkId });
      if (event.originalEvent?.dataTransfer) {
        event.originalEvent.dataTransfer.setData("text/plain", payload);
        event.originalEvent.dataTransfer.effectAllowed = "move";
      }
    });

    html.on("click", ".drep-flow-dep-remove", (event) => {
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
      const current = Array.isArray(targetCheck.dependsOn) ? targetCheck.dependsOn : [];
      const nextDepends = current.filter((id) => id !== depId);
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

    html.on("dragover", ".drep-flow-check", (event) => {
      event.preventDefault();
      event.currentTarget?.classList?.add("is-drop-target");
      if (event.originalEvent?.dataTransfer) {
        event.originalEvent.dataTransfer.dropEffect = "move";
      }
    });

    html.on("dragleave", ".drep-flow-check", (event) => {
      event.currentTarget?.classList?.remove("is-drop-target");
    });

    html.on("drop", ".drep-flow-check", async (event) => {
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
        const current = Array.isArray(targetCheck.dependsOn) ? targetCheck.dependsOn : [];
        if (current.includes(sourceCheckId)) return;
        const nextDepends = [...current, sourceCheckId];
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
