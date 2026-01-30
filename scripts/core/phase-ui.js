import { parseList } from "./parse.js";
import { normalizeCheckDependencies, normalizePhaseConfig } from "./phase.js";

function mergeDependencyDetails(depIds, existingDeps) {
  const normalized = normalizeCheckDependencies(existingDeps ?? []);
  const existingMap = new Map(
    normalized.map((dep) => [`${dep.kind || "check"}:${dep.id}`, dep])
  );
  return depIds.map((raw) => {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return null;
    const isGroup = trimmed.startsWith("group:");
    const id = isGroup ? trimmed.slice("group:".length) : trimmed;
    const key = `${isGroup ? "group" : "check"}:${id}`;
    return existingMap.get(key) ?? { id, kind: isGroup ? "group" : "check" };
  }).filter(Boolean);
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
    if (typeof data.phaseCompleteItems === "string") {
      next.phaseCompleteItems = data.phaseCompleteItems.trim();
    }
    if (Object.prototype.hasOwnProperty.call(data, "phaseCompleteGold")) {
      const goldValue = Number(data.phaseCompleteGold);
      next.phaseCompleteGold = Number.isFinite(goldValue) ? goldValue : 0;
    }
    next.showRewardsOnSheet = Boolean(data.showRewardsOnSheet);

    if (Object.prototype.hasOwnProperty.call(data, "groups")) {
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
          const checkCompleteMacro =
            typeof existingCheck?.checkCompleteMacro === "string"
              ? existingCheck.checkCompleteMacro
              : "";
          const checkSuccessItems = Array.isArray(existingCheck?.checkSuccessItems)
            ? existingCheck.checkSuccessItems
            : [];
          const checkSuccessGold = Number(existingCheck?.checkSuccessGold ?? 0);
          const completeGroupOnSuccess = Object.prototype.hasOwnProperty.call(checkData ?? {}, "completeGroupOnSuccess")
            ? Boolean(checkData.completeGroupOnSuccess)
            : Boolean(existingCheck?.completeGroupOnSuccess ?? existingCheck?.completeGroup ?? false);
          const completePhaseOnSuccess = Object.prototype.hasOwnProperty.call(checkData ?? {}, "completePhaseOnSuccess")
            ? Boolean(checkData.completePhaseOnSuccess)
            : Boolean(existingCheck?.completePhaseOnSuccess ?? existingCheck?.completePhase ?? false);
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
            completeGroupOnSuccess,
            completePhaseOnSuccess,
            checkCompleteMacro,
            checkSuccessItems,
            checkSuccessGold: Number.isFinite(checkSuccessGold) ? checkSuccessGold : 0,
            dependsOn,
          });
        }
        groups.push({ id: groupId, name: groupName, checks, maxChecks });
      }
      next.groups = groups;
    }

    if (Object.prototype.hasOwnProperty.call(data, "successLines")) {
      next.successLines = parseLineData(data.successLines);
    }
    if (Object.prototype.hasOwnProperty.call(data, "failureLines")) {
      next.failureLines = parseLineData(data.failureLines);
    }

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

export {
  applyPhaseConfigFormData,
};
