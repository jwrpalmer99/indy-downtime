import { parseList } from "./parse.js";
import { normalizeCheckDependencies, normalizePhaseConfig } from "./phase.js";

function mergeDependencyDetails(depIds, existingDeps) {
  const normalized = normalizeCheckDependencies(existingDeps ?? []);
  const existingMap = new Map(normalized.map((dep) => [dep.id, dep]));
  return depIds.map((id) => existingMap.get(id) ?? { id });
}

function initDependencyDragDrop(html, logger = () => {}) {
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

  const renderDeps = (container) => {
    const chips = container.find(".drep-deps-chips");
    if (!chips.length) return;
    chips.empty();

    const checkInput = container.find(".drep-deps-input-checks").first();
    const groupInput = container.find(".drep-deps-input-groups").first();

    const checkIds = checkInput.length ? parseList(checkInput.val()) : [];
    const groupIds = groupInput.length ? parseList(groupInput.val()) : [];

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
  const dialogContainer = html.closest(".drep-dialog").length
    ? html.closest(".drep-dialog")
    : html;
  const windowContent = dialogContainer.find(".window-content").first();

  const findScrollableElement = (root) => {
    if (!root || !root.querySelectorAll) return null;
    let best = null;
    let bestDelta = 0;
    const nodes = [root, ...root.querySelectorAll("*")];
    for (const node of nodes) {
      if (!node || !node.scrollHeight || !node.clientHeight) continue;
      const delta = node.scrollHeight - node.clientHeight;
      if (delta <= 1) continue;
      const style = getComputedStyle(node);
      if (!style || !["auto", "scroll"].includes(style.overflowY)) continue;
      if (delta > bestDelta) {
        best = node;
        bestDelta = delta;
      }
    }
    return best;
  };

  const resolveScrollable = () => {
    const roots = [
      dialogContainer[0],
      windowContent[0],
      html[0],
      document.scrollingElement,
    ].filter(Boolean);
    for (const root of roots) {
      const candidate = findScrollableElement(root);
      if (candidate) return candidate;
    }
    return roots[0] || null;
  };

  let scrollContainer = resolveScrollable();
  logger("Scroll container", {
    tag: scrollContainer?.tagName,
    className: scrollContainer?.className,
    scrollHeight: scrollContainer?.scrollHeight,
    clientHeight: scrollContainer?.clientHeight,
  });
  let scrollDirection = 0;
  let scrollRaf = null;

  const getScrollCandidates = () => {
    const candidates = [
      scrollContainer,
      windowContent[0],
      dialogContainer[0],
      html[0],
      document.scrollingElement,
    ].filter(Boolean);
    const seen = new Set();
    return candidates.filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  };

  const getBoundsElement = () => scrollContainer ?? windowContent[0] ?? dialogContainer[0] ?? html[0] ?? null;

  const tryScroll = (delta) => {
    for (const element of getScrollCandidates()) {
      if (element.scrollHeight <= element.clientHeight) continue;
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
      const prev = element.scrollTop;
      const next = Math.min(maxScroll, Math.max(0, prev + delta));
      if (next !== prev) {
        element.scrollTop = next;
        scrollContainer = element;
        return true;
      }
    }
    return false;
  };

  const startAutoScroll = () => {
    if (scrollDirection === 0) {
      scrollRaf = null;
      return;
    }
    const didScroll = tryScroll(scrollDirection * 8);
    if (!didScroll) {
      scrollContainer = resolveScrollable();
    }
    scrollRaf = requestAnimationFrame(startAutoScroll);
  };

  const handleDragOver = (event) => {
    if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
      scrollContainer = resolveScrollable();
    }
    if (!scrollContainer) return;

    const boundsElement = getBoundsElement();
    if (!boundsElement) return;
    const rect = boundsElement.getBoundingClientRect();
    const threshold = 60;
    const y = Number.isFinite(event.clientY) ? event.clientY : event.originalEvent?.clientY;
    const isNearTop = y < rect.top + threshold;
    const isNearBottom = y > rect.bottom - threshold;
   
    if (isNearTop) {
      const distance = rect.top + threshold - y;
      scrollDirection = -Math.min(1, Math.max(0.15, distance / threshold));
      if (!scrollRaf) startAutoScroll();
    } else if (isNearBottom) {
      const distance = y - (rect.bottom - threshold);
      scrollDirection = Math.min(1, Math.max(0.15, distance / threshold));
      if (!scrollRaf) startAutoScroll();
    } else {
      scrollDirection = 0;
      if (scrollRaf) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = null;
      }
    }
  };

  const stopAutoScroll = () => {
    scrollDirection = 0;
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
    scrollContainer = null;
  };
  const updateInputList = (input, id) => {
    const existing = parseList(input.val());
    if (existing.includes(id)) return existing;
    existing.push(id);
    input.val(existing.join(", "));
    return existing;
  };

  html.find(".drep-check-card").attr("draggable", true);
  html.find(".drep-check-chip").attr("draggable", true);
  html.on("dragstart", ".drep-check-card, .drep-check-chip", (event) => {
    if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
      scrollContainer = resolveScrollable();
    }
    const checkId = event.currentTarget?.dataset?.checkId;
    if (!checkId) return;
    event.originalEvent?.dataTransfer?.setData(
      "text/plain",
      JSON.stringify({ type: "check", id: checkId })
    );
    logger("Drag check", { checkId });
  });

  html.find(".drep-group-chip").attr("draggable", true);
  html.on("dragstart", ".drep-group-chip", (event) => {
    if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
      scrollContainer = resolveScrollable();
    }
    const groupId = event.currentTarget?.dataset?.groupId;
    if (!groupId) return;
    event.originalEvent?.dataTransfer?.setData(
      "text/plain",
      JSON.stringify({ type: "group", id: groupId })
    );
    logger("Drag group", { groupId });
  });
  html.on("dragover", (event) => {
    event.preventDefault();
    handleDragOver(event);
  });

  $(document).on("dragover.drepAutoScroll", (event) => {
    handleDragOver(event);
  });

  html.on("dragend drop", () => {
    stopAutoScroll();
  });

  html.on("dragover", ".drep-deps", (event) => {
    event.preventDefault();
    if (event.originalEvent?.dataTransfer) {
      event.originalEvent.dataTransfer.dropEffect = "move";
    }
  });

  html.on("drop", ".drep-deps", (event) => {
    event.preventDefault();
    const container = $(event.currentTarget);
    const raw = event.originalEvent?.dataTransfer?.getData("text/plain");
    if (!raw) return;
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      return;
    }
    if (!payload?.id || !payload?.type) return;

    const depsType = container.data("depsType");
    if (depsType === "check" && payload.type !== "check") return;

    if (depsType === "check") {
      const checkId = container.data("checkId");
      if (payload.id === checkId) return;
      const input = container.find(".drep-deps-input-checks").first();
      if (!input.length) return;
      updateInputList(input, payload.id);
    } else {
      if (payload.type === "check") {
        const input = container.find(".drep-deps-input-checks").first();
        if (!input.length) return;
        updateInputList(input, payload.id);
      } else if (payload.type === "group") {
        const input = container.find(".drep-deps-input-groups").first();
        if (!input.length) return;
        updateInputList(input, payload.id);
      }
    }

    renderDeps(container);
  });

  html.on("click", ".drep-dep-remove", (event) => {
    event.preventDefault();
    const chip = $(event.currentTarget).closest(".drep-dep-chip");
    const container = chip.closest(".drep-deps");
    const depType = chip.data("depType");
    const depId = chip.data("depId");
    if (!depId) return;

    const inputClass = depType === "group" ? ".drep-deps-input-groups" : ".drep-deps-input-checks";
    const input = container.find(inputClass).first();
    if (!input.length) return;
    const next = parseList(input.val()).filter((entry) => entry !== depId);
    input.val(next.join(", "));
    renderDeps(container);
  });

  html.find(".drep-deps").each((_, element) => {
    renderDeps($(element));
  });
}

function applyPhaseConfigFormData(phaseConfig, formData) {
  const phasesData = formData?.phases ?? {};
  const updated = phaseConfig.map((phase) => {
    const data = phasesData?.[phase.id] ?? {};
    const next = foundry.utils.deepClone(phase);

    if (typeof data.name === "string" && data.name.trim()) {
      next.name = data.name.trim();
    }
    if (typeof data.narrativeDuration === "string") {
      next.narrativeDuration = data.narrativeDuration.trim();
    }
    if (typeof data.expectedGain === "string") {
      next.expectedGain = data.expectedGain.trim();
    }
    if (Number.isFinite(Number(data.target))) {
      next.target = Math.max(0, Number(data.target));
    }
    next.allowCriticalBonus = Boolean(data.allowCriticalBonus);
    next.failureEvents = Boolean(data.failureEvents);
    if (typeof data.failureEventTable === "string") {
      next.failureEventTable = data.failureEventTable.trim();
    }
    if (typeof data.image === "string") {
      next.image = data.image.trim();
    }
    if (typeof data.phaseCompleteMessage === "string") {
      next.phaseCompleteMessage = data.phaseCompleteMessage.trim();
    }
    if (typeof data.phaseCompleteMacro === "string") {
      next.phaseCompleteMacro = data.phaseCompleteMacro.trim();
    }

    const groups = [];
    for (const [groupId, groupData] of Object.entries(data.groups ?? {})) {
      const groupName = typeof groupData?.name === "string" ? groupData.name.trim() : "";
      const maxChecksRaw = Number(groupData?.maxChecks);
      const existingGroup = (phase.groups ?? []).find((entry) => entry.id === groupId);
      const existingMax = Number(existingGroup?.maxChecks ?? 0);
      const maxChecks = Number.isFinite(maxChecksRaw) && maxChecksRaw >= 0
        ? maxChecksRaw
        : (Number.isFinite(existingMax) ? existingMax : 0);
      const checks = [];
      for (const [checkId, checkData] of Object.entries(groupData?.checks ?? {})) {
        const name = typeof checkData?.name === "string" ? checkData.name.trim() : "";
        const skill = typeof checkData?.skill === "string" ? checkData.skill.trim() : "";
        const dc = Number(checkData?.dc);
        const description =
          typeof checkData?.description === "string" ? checkData.description.trim() : "";
        const existingGroup = (phase.groups ?? []).find((entry) => entry.id === groupId);
        const existingCheck = (existingGroup?.checks ?? []).find((entry) => entry.id === checkId);
        const hasDependsOn = Object.prototype.hasOwnProperty.call(checkData ?? {}, "dependsOn");
        let dependsOn = normalizeCheckDependencies(existingCheck?.dependsOn ?? []);
        if (hasDependsOn) {
          const depIds = parseList(checkData?.dependsOn ?? "");
          dependsOn = mergeDependencyDetails(depIds, existingCheck?.dependsOn ?? []);
        }
        checks.push({
          id: checkId,
          name,
          skill,
          description,
          dc: Number.isFinite(dc) ? dc : 0,
          value: 1,
          dependsOn,
        });
      }
      groups.push({ id: groupId, name: groupName, checks, maxChecks });
    }
    next.groups = groups;

    next.successLines = parseLineData(data.successLines);
    next.failureLines = parseLineData(data.failureLines);

    return next;
  });

  return normalizePhaseConfig(updated);
}

function parseLineData(linesData) {
  const lines = [];
  for (const [lineId, lineData] of Object.entries(linesData ?? {})) {
    const text = typeof lineData?.text === "string" ? lineData.text.trim() : "";
    const dependsOnChecks = parseList(lineData?.dependsOnChecks ?? "");
    const dependsOnGroups = parseList(lineData?.dependsOnGroups ?? "");
    lines.push({
      id: lineId,
      text,
      dependsOnChecks,
      dependsOnGroups,
    });
  }
  return lines;
}

function updatePhaseImagesFromForm(phaseConfig, formData) {
  if (!Array.isArray(phaseConfig) || !formData) return;
  for (const phase of phaseConfig) {
    const key = `phaseImage_${phase.id}`;
    if (Object.prototype.hasOwnProperty.call(formData, key)) {
      const value = String(formData[key] ?? "").trim();
      phase.image = value;
    }
  }
}

export {
  initDependencyDragDrop,
  applyPhaseConfigFormData,
  updatePhaseImagesFromForm,
};
