import { debugLog, getIntervalLabel, getSkillLabel, getCheckRollMode } from "./labels.js";
import {
  getActivePhase,
  getPhaseCheckById,
  getPhaseDefinition,
  getPhaseCheckLabel,
  getPhaseCheckTarget,
  getPhaseDc,
  getCheckRollData,
  getPhaseProgress,
  getPhaseAvailableChecks,
  initializePhaseState,
  isPhaseComplete,
  pickLineForCheck,
  pickLineForGroup,
  isGroupComplete,
  getDifficultyLabel,
  normalizeDifficulty,
} from "./phase.js";
import {
  getNextIncompletePhaseId,
  getWorldState,
  setWorldState,
} from "./state.js";
import { getCurrentTrackerId } from "./tracker.js";
function isAbilityKey(skillKey) {
  return typeof skillKey === "string" && skillKey.startsWith("ability:");
}
function getAbilityKey(skillKey) {
  if (typeof skillKey !== "string") return "";
  return skillKey.split(":")[1] ?? "";
}
function resolveSkillStatistic(skills, skillKey) {
  if (!skills || !skillKey) return null;
  if (skills instanceof Map) {
    if (skills.has(skillKey)) return skills.get(skillKey);
    const values = Array.from(skills.values());
    for (const entry of values) {
      if (!entry) continue;
      if (entry.slug === skillKey || entry.id === skillKey || entry.key === skillKey) {
        return entry;
      }
    }
    return null;
  }
  if (typeof skills === "object") {
    if (Object.prototype.hasOwnProperty.call(skills, skillKey)) {
      return skills[skillKey];
    }
    for (const entry of Object.values(skills)) {
      if (!entry) continue;
      if (entry.slug === skillKey || entry.id === skillKey || entry.key === skillKey) {
        return entry;
      }
    }
  }
  return null;
}
function getActorCheckBonus(actor, skillKey) {
  if (!actor || !skillKey) return null;
  if (isAbilityKey(skillKey)) {
    const abilityKey = getAbilityKey(skillKey);
    if (!abilityKey) return null;
    const abilities = actor.system?.abilities ?? actor.abilities ?? {};
    const abilityKeyLower = abilityKey.toLowerCase();
    const abilityKeyUpper = abilityKey.toUpperCase();
    const abilityData =
      abilities?.[abilityKey] ??
      abilities?.[abilityKeyLower] ??
      abilities?.[abilityKeyUpper] ??
      null;
    const raw = abilityData?.mod ?? abilityData?.value ?? abilityData?.check?.mod ?? abilityData?.check?.modifier?.value;
    const bonus = Number(raw);
    return Number.isFinite(bonus) ? bonus : null;
  }
  const skills = actor.system?.skills ?? actor.skills ?? null;
  const skillData = resolveSkillStatistic(skills, skillKey);
  const raw = skillData?.total
    ?? skillData?.mod
    ?? skillData?.value
    ?? skillData?.check?.mod
    ?? skillData?.check?.modifier?.value
    ?? skillData?.modifier?.value;
  const bonus = Number(raw);
  return Number.isFinite(bonus) ? bonus : null;
}
function getCheckSuccessChance({ dc, bonus, advantage, disadvantage } = {}) {
  if (getCheckRollMode() === "d100") return null;
  const dcValue = Number(dc);
  const bonusValue = Number(bonus);
  if (!Number.isFinite(dcValue) || !Number.isFinite(bonusValue)) return null;
  const target = dcValue - bonusValue;
  let chance = (21 - target) / 20;
  chance = Math.max(0, Math.min(1, chance));
  if (advantage && !disadvantage) {
    return 1 - Math.pow(1 - chance, 2);
  }
  if (disadvantage && !advantage) {
    return Math.pow(chance, 2);
  }
  return chance;
}

const D100_DIFFICULTY_MULTIPLIERS = {
  easy: 2,
  regular: 1,
  difficult: 0.5,
  extreme: 0.2,
};

function getD100TargetValue(skillValue, difficulty) {
  const base = Number(skillValue);
  if (!Number.isFinite(base)) return null;
  const normalized = normalizeDifficulty(difficulty);
  const multiplier = D100_DIFFICULTY_MULTIPLIERS[normalized] ?? 1;
  const target = Math.floor(base * multiplier);
  return Math.min(100, Math.max(0, target));
}
async function rollPf2eSkill(actor, skillKey, advantage, disadvantage) {
  if (!actor || !skillKey) return null;
  const skills = actor.skills ?? actor.system?.skills ?? null;
  let statistic = null;
  if (skills instanceof Map) {
    statistic = skills.get(skillKey) ?? null;
  } else if (skills && typeof skills === "object") {
    statistic = skills[skillKey] ?? null;
  }
  if (!statistic && skills) {
    const values = skills instanceof Map ? Array.from(skills.values()) : Object.values(skills)
    for (const entry of values) {
      if (!entry) continue;
      if (entry.slug === skillKey || entry.id === skillKey || entry.key === skillKey) {
        statistic = entry;
        break;
      }
    }
  }
  if (!statistic) return null;
  if (advantage && disadvantage) {
    advantage = false;
    disadvantage = false;
  }
  const options = { skipDialog: true };
  if (advantage) {
    options.rollTwice = "keep-higher";
  } else if (disadvantage) {
    options.rollTwice = "keep-lower";
  }
  try {
    if (typeof statistic.roll === "function") {
      return await statistic.roll(options);
    }
    if (statistic.check && typeof statistic.check.roll === "function") {
      return await statistic.check.roll(options);
    }
    if (typeof statistic.check === "function") {
      return await statistic.check(options);
    }
  } catch (error) {
    console.error(error);
  }
  return null;
}
async function rollSkill(actor, skillKey, advantage, disadvantage) {
  if (advantage && disadvantage) {
    advantage = false;
    disadvantage = false;
  }
  if (isAbilityKey(skillKey)) {
    return rollAbility(actor, getAbilityKey(skillKey), advantage, disadvantage);
  }
  if (!actor?.rollSkill) {
    if (game.system?.id === "pf2e") {
      const pf2eRoll = await rollPf2eSkill(actor, skillKey, advantage, disadvantage);
      if (pf2eRoll) return pf2eRoll;
    }
    ui.notifications.error("Indy Downtime Tracker: actor cannot roll skills. Set Indy Downtime Tracker to use manual results or use a compatible system.");
    return null;
  }
  try {
    if (game.user?.isGM && actor.hasPlayerOwner) {
      return await rollSkillDirect(actor, skillKey, advantage, disadvantage);
    }
    // Detect Midi-QOL (works in v13)
    const hasMidi = !!game.modules.get("midi-qol")?.active;
    // Base config works for both
    const rollConfig = { skill: "Persuasion", trait: "Persuasion" };
    // Put adv/dis in the right place depending on Midi-QOL
    if (hasMidi) {
      rollConfig.midiOptions = {
        advantage: !!advantage,
        disadvantage: !!disadvantage
      };
    } else {
      // dnd5e native path
      if (advantage && !disadvantage) rollConfig.advantage = true;
      if (disadvantage && !advantage) rollConfig.disadvantage = true;
    }
    // Fast-forward + modifier-keys (safe for both; mostly matters for Midi)
    const event =
      advantage && !disadvantage ? { altKey: true } :
      disadvantage && !advantage ? { ctrlKey: true } :
      {};
    const rolls = await actor.rollSkill(rollConfig, {
      fastForward: true,
      event
    });
    if (Array.isArray(rolls)) {
      return rolls[0] ?? null;
    }
    return rolls ?? null;
  } catch (error) {
    console.error(error);
    if (game.user?.isGM && actor.hasPlayerOwner) {
      return rollSkillDirect(actor, skillKey, advantage, disadvantage);
    }
    ui.notifications.error("Indy Downtime Tracker: roll failed.");
    return null;
  }
}
async function rollSkillDirect(actor, skillKey, advantage, disadvantage) {
  const skillData = actor.system?.skills?.[skillKey];
  const mod = Number(skillData?.total ?? skillData?.mod ?? 0);
  const formula = advantage ? "2d20kh + @mod" : (disadvantage ? "2d20kl + @mod" : "1d20 + @mod");
  const roll = await new Roll(formula, { mod }).evaluate({ async: true });
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${getSkillLabel(skillKey)} Check`,
  });
  return roll;
}
async function rollAbility(actor, abilityKey, advantage, disadvantage) {
  if (advantage && disadvantage) {
    advantage = false;
    disadvantage = false;
  }
  if (!abilityKey) {
    ui.notifications.error("Indy Downtime Tracker: ability key missing.");
    return null;
  }
  const options = { fastForward: true };
  if (advantage) {
    options.advantage = true;
  }
  if (disadvantage) {
    options.disadvantage = true;
  }
  const abilityOptions = {
    ...options,
    ability: abilityKey,
  };
  let lastError = null;
  const tryRoll = async (fn, ...args) => {
    if (typeof fn !== "function") return null;
    try {
      const result = await fn.call(actor, ...args);
      if (Array.isArray(result)) {
        return result[0] ?? null;
      }
      return result ?? null;
    } catch (error) {
      lastError = error;
      return null;
    }
  };
  try {
    if (game.user?.isGM && actor?.hasPlayerOwner) {
      return await rollAbilityDirect(actor, abilityKey, advantage, disadvantage);
    }
    let roll = null;
    roll = await tryRoll(actor?.rollAbilityTest, abilityKey, options);
    if (!roll) roll = await tryRoll(actor?.rollAbilityTest, abilityOptions);
    if (!roll) roll = await tryRoll(actor?.rollAbilityCheck, abilityKey, options);
    if (!roll) roll = await tryRoll(actor?.rollAbilityCheck, abilityOptions);
    if (!roll) roll = await tryRoll(actor?.rollAbility, abilityKey, options);
    if (!roll) roll = await tryRoll(actor?.rollAbility, abilityOptions);
    if (roll) return roll;
    return await rollAbilityDirect(actor, abilityKey, advantage, disadvantage);
  } catch (error) {
    console.error(error ?? lastError);
    if (game.user?.isGM && actor?.hasPlayerOwner) {
      return rollAbilityDirect(actor, abilityKey, advantage, disadvantage);
    }
    ui.notifications.error("Indy Downtime Tracker: ability roll failed.");
    return null;
  }
}
async function rollAbilityDirect(actor, abilityKey, advantage, disadvantage) {
  if (!actor) return null;
  const abilityData = actor.system?.abilities?.[abilityKey] ?? {};
  const mod = Number(abilityData?.mod ?? abilityData?.value ?? 0);
  const formula = advantage ? "2d20kh + @mod" : (disadvantage ? "2d20kl + @mod" : "1d20 + @mod");
  const roll = await new Roll(formula, { mod }).evaluate({ async: true });
  const label = getSkillLabel("ability:" + abilityKey);
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${label} Check`,
  });
  return roll;
}
async function runIntervalRoll({ actor, checkChoice, trackerId }) {
  const resolvedTrackerId = trackerId ?? getCurrentTrackerId();
  const state = getWorldState(resolvedTrackerId);
  const activePhase = getActivePhase(state, resolvedTrackerId);
  if (activePhase.completed) return;
  const availableChecks = getPhaseAvailableChecks(
    activePhase,
    activePhase.checkProgress
  );
  if (!availableChecks.length) {
    ui.notifications.warn("Indy Downtime Tracker: configure checks before rolling.");
    return;
  }
  let selectedCheck =
    (checkChoice && getPhaseCheckById(activePhase, checkChoice)) || null;
  if (!selectedCheck || !availableChecks.find((check) => check.id === selectedCheck.id)) {
    selectedCheck = availableChecks[0];
  }
  if (!selectedCheck) return;
  debugLog("Rolling check", {
    trackerId: resolvedTrackerId,
    checkId: selectedCheck.id,
    checkName: getPhaseCheckLabel(selectedCheck),
    checkProgress: { ...activePhase.checkProgress },
  });
  const checkLabel = getPhaseCheckLabel(selectedCheck);
  const rollData = getCheckRollData(
    activePhase,
    selectedCheck,
    activePhase.checkProgress
  );
  const skillKey = rollData.skill;
  const skillLabel = skillKey ? getSkillLabel(skillKey) : selectedCheck.skill;
  const rollMode = getCheckRollMode();
  const dc = rollData.dc;
  const difficulty = rollData.difficulty ?? "";
  const difficultyLabel = rollData.difficultyLabel ?? getDifficultyLabel(difficulty);
  const roll = await rollSkill(
    actor,
    skillKey,
    rollData.advantage,
    rollData.disadvantage
  );
  if (!roll) return;
  const total = roll.total ?? roll._total ?? 0;
  let success = false;
  let dcLabel = Number.isFinite(dc) ? String(dc) : "";
  let dcLabelType = "DC";
  let targetValue = null;
  if (rollMode === "d100") {
    const baseValue = getActorCheckBonus(actor, skillKey);
    targetValue = getD100TargetValue(baseValue, difficulty);
    if (!Number.isFinite(targetValue)) {
      ui.notifications.warn("Indy Downtime Tracker: check target not available.");
      return;
    }
    success = total <= targetValue;
    dcLabel = difficultyLabel;
    dcLabelType = "Difficulty";
  } else {
    success = total >= dc;
  }
  const formula = roll.formula || roll._formula || "";
  state.checkCount = Number.isFinite(state.checkCount) ? state.checkCount + 1 : 1;
  let progressGained = 0;
  let criticalBonusApplied = false;
  let successLine = "";
  let failureLine = "";
  const beforeGroupComplete = isGroupComplete(
    activePhase,
    selectedCheck.groupId,
    activePhase.checkProgress
  );
  if (success) {
    const currentValue = Number(activePhase.checkProgress?.[selectedCheck.id] ?? 0);
    const target = getPhaseCheckTarget(selectedCheck);
    if (currentValue < target) {
      progressGained = 1;
      let nextValue = Math.min(currentValue + 1, target);
      if (activePhase.allowCriticalBonus && isCriticalSuccess(roll)) {
        const boosted = Math.min(nextValue + 1, target);
        if (boosted > nextValue) {
          nextValue = boosted;
          progressGained += 1;
          criticalBonusApplied = true;
        }
      }
      activePhase.checkProgress[selectedCheck.id] = nextValue;
    }
    activePhase.progress = getPhaseProgress(activePhase, activePhase.checkProgress);
    activePhase.completed = isPhaseComplete({ ...activePhase, progress: activePhase.progress });
    activePhase.failuresInRow = 0;
    const afterGroupComplete = isGroupComplete(
      activePhase,
      selectedCheck.groupId,
      activePhase.checkProgress
    );
    if (!beforeGroupComplete && afterGroupComplete) {
      successLine = pickLineForGroup(activePhase.successLines, selectedCheck.groupId);
    }
    if (!successLine) {
      successLine = pickLineForCheck(
        activePhase.successLines,
        selectedCheck.id,
        selectedCheck.groupId,
        { allowGroup: false }
      );
    }
  } else {
    activePhase.failuresInRow = Number(activePhase.failuresInRow ?? 0) + 1;
    failureLine = pickLineForCheck(
      activePhase.failureLines,
      selectedCheck.id,
      selectedCheck.groupId
    );
  }
  const failureEvent = Boolean(!success && activePhase.failureEvents);
  let failureEventResult = "";
  if (!success && failureEvent) {
    failureEventResult = await rollFailureEventTable(activePhase, actor);
  }
  debugLog("Updated progress", {
    trackerId: resolvedTrackerId,
    checkId: selectedCheck.id,
    checkProgress: { ...activePhase.checkProgress },
  });
  state.phases[activePhase.id] = {
    progress: activePhase.progress,
    completed: activePhase.completed,
    failuresInRow: activePhase.failuresInRow,
    checkProgress: activePhase.checkProgress ?? {},
  };
  if (isPhaseComplete(activePhase)) {
    state.phases[activePhase.id].completed = true;
    await handleCompletion(state, activePhase, actor, resolvedTrackerId);
  }
  state.log.unshift({
    checkNumber: state.checkCount,
    phaseId: activePhase.id,
    phaseName: activePhase.name,
    actorId: actor.id,
    actorName: actor.name,
    checkId: selectedCheck.id,
    checkName: checkLabel,
    groupId: selectedCheck.groupId,
    groupName: selectedCheck.groupName,
    skillChoice: skillKey,
    skillKey,
    skillLabel,
    dc,
    dcLabel,
    dcLabelType,
    difficulty,
    targetValue,
    total,
    success,
    progressGained,
    criticalBonusApplied,
    successLine,
    failureLine,
    failureEvent,
    failureEventResult,
    timestamp: Date.now(),
  });
  state.log = state.log.slice(0, 50);
  await setWorldState(state, resolvedTrackerId);
  await postSummaryMessage({
    actor,
    checkLabel,
    skillLabel,
    dc,
    dcLabel,
    dcLabelType,
    total,
    formula,
    success,
    progress: state.phases[activePhase.id].progress,
    progressTarget: activePhase.target,
    progressGained,
    criticalBonusApplied,
    successLine,
    failureLine,
    failureEvent,
    failureEventResult,
    trackerId: resolvedTrackerId,
  });
}
async function runManualIntervalResult({ actor, checkId, checkChoice, trackerId, success }) {
  const resolvedTrackerId = trackerId ?? getCurrentTrackerId();
  const state = getWorldState(resolvedTrackerId);
  const activePhase = getActivePhase(state, resolvedTrackerId);
  if (activePhase.completed) return;
  const availableChecks = getPhaseAvailableChecks(
    activePhase,
    activePhase.checkProgress
  );
  if (!availableChecks.length) {
    ui.notifications.warn("Indy Downtime Tracker: configure checks before rolling.");
    return;
  }
  let selectedCheck = null;
  if (checkId) {
    selectedCheck =
      availableChecks.find((check) => check.id === checkId) ||
      getPhaseCheckById(activePhase, checkId);
  }
  if (!selectedCheck && checkChoice) {
    selectedCheck = getPhaseCheckById(activePhase, checkChoice);
  }
  if (!selectedCheck || !availableChecks.find((check) => check.id === selectedCheck.id)) {
    selectedCheck = availableChecks[0];
  }
  if (!selectedCheck) return;
  debugLog("Manual check result", {
    trackerId: resolvedTrackerId,
    checkId: selectedCheck.id,
    checkName: getPhaseCheckLabel(selectedCheck),
    checkProgress: { ...activePhase.checkProgress },
  });
  const checkLabel = getPhaseCheckLabel(selectedCheck);
  const rollData = getCheckRollData(
    activePhase,
    selectedCheck,
    activePhase.checkProgress
  );
  const skillKey = rollData.skill;
  const skillLabel = skillKey ? getSkillLabel(skillKey) : selectedCheck.skill;
  const rollMode = getCheckRollMode();
  const dc = rollData.dc;
  const difficulty = rollData.difficulty ?? "";
  const difficultyLabel = rollData.difficultyLabel ?? getDifficultyLabel(difficulty);
  const dcLabel = rollMode === "d100" ? difficultyLabel : (Number.isFinite(dc) ? String(dc) : "");
  const dcLabelType = rollMode === "d100" ? "Difficulty" : "DC";
  const isSuccess = Boolean(success);
  const total = "Manual";
  const formula = "manual";
  state.checkCount = Number.isFinite(state.checkCount) ? state.checkCount + 1 : 1;
  let progressGained = 0;
  let criticalBonusApplied = false;
  let successLine = "";
  let failureLine = "";
  const beforeGroupComplete = isGroupComplete(
    activePhase,
    selectedCheck.groupId,
    activePhase.checkProgress
  );
  if (isSuccess) {
    const currentValue = Number(activePhase.checkProgress?.[selectedCheck.id] ?? 0);
    const target = getPhaseCheckTarget(selectedCheck);
    if (currentValue < target) {
      progressGained = 1;
      const nextValue = Math.min(currentValue + 1, target);
      activePhase.checkProgress[selectedCheck.id] = nextValue;
    }
    activePhase.progress = getPhaseProgress(activePhase, activePhase.checkProgress);
    activePhase.completed = isPhaseComplete({ ...activePhase, progress: activePhase.progress });
    activePhase.failuresInRow = 0;
    const afterGroupComplete = isGroupComplete(
      activePhase,
      selectedCheck.groupId,
      activePhase.checkProgress
    );
    if (!beforeGroupComplete && afterGroupComplete) {
      successLine = pickLineForGroup(activePhase.successLines, selectedCheck.groupId);
    }
    if (!successLine) {
      successLine = pickLineForCheck(
        activePhase.successLines,
        selectedCheck.id,
        selectedCheck.groupId,
        { allowGroup: false }
      );
    }
  } else {
    activePhase.failuresInRow = Number(activePhase.failuresInRow ?? 0) + 1;
    failureLine = pickLineForCheck(
      activePhase.failureLines,
      selectedCheck.id,
      selectedCheck.groupId
    );
  }
  const failureEvent = Boolean(!isSuccess && activePhase.failureEvents);
  let failureEventResult = "";
  if (!isSuccess && failureEvent) {
    failureEventResult = await rollFailureEventTable(activePhase, actor);
  }
  debugLog("Updated progress (manual)", {
    trackerId: resolvedTrackerId,
    checkId: selectedCheck.id,
    checkProgress: { ...activePhase.checkProgress },
  });
  state.phases[activePhase.id] = {
    progress: activePhase.progress,
    completed: activePhase.completed,
    failuresInRow: activePhase.failuresInRow,
    checkProgress: activePhase.checkProgress ?? {},
  };
  if (isPhaseComplete(activePhase)) {
    state.phases[activePhase.id].completed = true;
    await handleCompletion(state, activePhase, actor, resolvedTrackerId);
  }
  state.log.unshift({
    checkNumber: state.checkCount,
    phaseId: activePhase.id,
    phaseName: activePhase.name,
    actorId: actor.id,
    actorName: actor.name,
    checkId: selectedCheck.id,
    checkName: checkLabel,
    groupId: selectedCheck.groupId,
    groupName: selectedCheck.groupName,
    skillChoice: skillKey,
    skillKey,
    skillLabel,
    dc,
    dcLabel,
    dcLabelType,
    difficulty,
    total,
    success: isSuccess,
    progressGained,
    criticalBonusApplied,
    successLine,
    failureLine,
    failureEvent,
    failureEventResult,
    manual: true,
    timestamp: Date.now(),
  });
  state.log = state.log.slice(0, 50);
  await setWorldState(state, resolvedTrackerId);
  await postManualSummaryMessage({
    actor,
    checkLabel,
    skillLabel,
    dc,
    dcLabel,
    dcLabelType,
    success: isSuccess,
    progress: state.phases[activePhase.id].progress,
    progressTarget: activePhase.target,
    progressGained,
    successLine,
    failureLine,
    failureEvent,
    failureEventResult,
    trackerId: resolvedTrackerId,
  });
}
async function postSummaryMessage({
  actor,
  checkLabel,
  skillLabel,
  dc,
  dcLabel,
  dcLabelType,
  total,
  formula,
  success,
  progress,
  progressTarget,
  progressGained,
  criticalBonusApplied,
  successLine,
  failureLine,
  failureEvent,
  failureEventResult,
  trackerId,
}) {
  const outcome = success ? "Success" : "Failure";
  const targetLabel = dcLabel ?? (Number.isFinite(dc) ? String(dc) : "");
  const targetType = dcLabelType || "DC";
  const progressLine = success
    ? `<p><strong>Progress:</strong> ${progress} / ${progressTarget}${
        progressGained ? ` (+${progressGained})` : ""
      }</p>`
    : `<p><strong>Progress:</strong> ${progress} / ${progressTarget}</p>`;
  const criticalLine = criticalBonusApplied
    ? "<p><strong>Critical:</strong> Bonus progress applied.</p>"
    : "";
  const successBlock = successLine
    ? `<div class="narrative"><strong>Success:</strong> ${successLine}</div>`
    : "";
  const failureBlock = failureLine
    ? `<div class="narrative"><strong>${
        failureEvent ? "Event" : "Strain"
      }:</strong> ${failureLine}</div>`
    : "";
  const failureEventBlock = failureEventResult
    ? `<div class="narrative"><strong>Event Table:</strong> ${failureEventResult}</div>`
    : "";
  const content = `
      <div class="drep-chat">
        <h4>${getIntervalLabel(trackerId)} Check: ${checkLabel}</h4>
        <p><strong>Actor:</strong> ${actor.name}</p>
        <p><strong>Skill:</strong> ${skillLabel}</p>
        ${targetLabel ? `<p><strong>${targetType}:</strong> ${targetLabel}</p>` : ""}
        <p><strong>Result:</strong> ${total} [${formula}] (${outcome})</p>
        ${progressLine}
        ${criticalLine}
        ${successBlock}
        ${failureBlock}
        ${failureEventBlock}
      </div>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });
}
async function postManualSummaryMessage({
  actor,
  checkLabel,
  skillLabel,
  dc,
  dcLabel,
  dcLabelType,
  success,
  progress,
  progressTarget,
  progressGained,
  successLine,
  failureLine,
  failureEvent,
  failureEventResult,
  trackerId,
}) {
  const outcome = success ? "Success" : "Failure";
  const targetLabel = dcLabel ?? (Number.isFinite(dc) ? String(dc) : "");
  const targetType = dcLabelType || "DC";
  const progressLine = success
    ? `<p><strong>Progress:</strong> ${progress} / ${progressTarget}${
        progressGained ? ` (+${progressGained})` : ""
      }</p>`
    : `<p><strong>Progress:</strong> ${progress} / ${progressTarget}</p>`;
  const successBlock = successLine
    ? `<div class="narrative"><strong>Success:</strong> ${successLine}</div>`
    : "";
  const failureBlock = failureLine
    ? `<div class="narrative"><strong>${
        failureEvent ? "Event" : "Strain"
      }:</strong> ${failureLine}</div>`
    : "";
  const failureEventBlock = failureEventResult
    ? `<div class="narrative"><strong>Event Table:</strong> ${failureEventResult}</div>`
    : "";
  const content = `
      <div class="drep-chat">
        <h4>${getIntervalLabel(trackerId)} Check: ${checkLabel}</h4>
        <p><strong>Actor:</strong> ${actor.name}</p>
        <p><strong>Skill:</strong> ${skillLabel}</p>
        ${targetLabel ? `<p><strong>${targetType}:</strong> ${targetLabel}</p>` : ""}
        <p><strong>Result:</strong> ${outcome} (Manual)</p>
        ${progressLine}
        ${successBlock}
        ${failureBlock}
        ${failureEventBlock}
      </div>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });
}
async function runPhaseCompleteMacro({ phase, actor, actorId, actorName, actorUuid, trackerId }) {
  if (!phase) return;
  const macroUuid = String(phase.phaseCompleteMacro ?? "").trim();
  if (!macroUuid || !game.user?.isGM) return;
  let resolvedActor = actor ?? null;
  if (!resolvedActor || typeof resolvedActor.createEmbeddedDocuments !== "function") {
    if (actorUuid) {
      try {
        const doc = await fromUuid(actorUuid);
        resolvedActor = doc?.document ?? doc ?? resolvedActor;
      } catch (error) {
        // ignore
      }
    }
  }
  if ((!resolvedActor || typeof resolvedActor.createEmbeddedDocuments !== "function") && actorId && game.actors) {
    resolvedActor = game.actors.get(actorId) ?? resolvedActor;
  }
  let macro = null;
  try {
    macro = await fromUuid(macroUuid);
  } catch (error) {
    macro = null;
  }
  if (!macro && game.macros) {
    macro = game.macros.get(macroUuid) ?? game.macros.getName?.(macroUuid) ?? null;
  }
  if (macro?.execute) {
    const payload = {
      actor: resolvedActor ?? actor ?? null,
      actorId: actorId ?? "",
      actorName: actorName ?? "",
      actorUuid: actorUuid ?? "",
      phase,
      trackerId,
    };
    const previousArgs = globalThis.args;
    globalThis.args = [payload];
    try {
      await macro.execute(payload);
    } finally {
      globalThis.args = previousArgs;
    }
  }
}
async function handleCompletion(state, activePhase, actor, trackerId) {
  const nextPhaseId = getNextIncompletePhaseId(state, trackerId);
  const nextPhase = nextPhaseId
    ? getPhaseDefinition(nextPhaseId, trackerId)
    : null;
  const nextPhaseName = nextPhase?.name ?? "";
  state.log.unshift({
    type: "phase-complete",
    phaseId: activePhase.id,
    phaseName: activePhase.name,
    nextPhaseId: nextPhaseId || "",
    nextPhaseName,
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? "",
    actorUuid: actor?.uuid ?? "",
    timestamp: Date.now(),
  });
  state.log = state.log.slice(0, 50);
  if (nextPhase && nextPhaseId !== activePhase.id) {
    state.activePhaseId = nextPhaseId;
    initializePhaseState(state, nextPhase);
  }
  await setWorldState(state, trackerId);
  const baseNote = nextPhaseName
    ? `Next phase activated: ${nextPhaseName}.`
    : "All phases completed.";
  const message = String(activePhase.phaseCompleteMessage ?? "").trim();
  const completionNote = message || baseNote;
  const extraNote = message && nextPhaseName ? baseNote : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="drep-chat"><h3>Phase Complete</h3><p>${completionNote}</p>${
      extraNote ? `<p class="drep-muted">${extraNote}</p>` : ""
    }</div>`,
  });
  await runPhaseCompleteMacro({
    phase: activePhase,
    actor,
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? "",
    actorUuid: actor?.uuid ?? "",
    trackerId,
  });
}
function isCriticalSuccess(roll) {
  const die = roll?.dice?.[0];
  if (!die || !die.results?.length) return false;
  const result =
    die.results[0]?.result ?? die.results[0]?.value ?? die.total ?? 0;
  return die.faces && result === die.faces;
}
async function rollFailureEventTable(phase, actor) {
  const uuid = typeof phase?.failureEventTable === "string"
    ? phase.failureEventTable.trim()
    : "";
  if (!uuid) return "";
  let table = null;
  try {
    table = await fromUuid(uuid);
  } catch (error) {
    console.error(error);
  }
  if (!table || table.documentName !== "RollTable") {
    debugLog("Failure event table not found", { uuid });
    return "";
  }
  try {
    const draw = await table.draw({ displayChat: true });
    const results = draw?.results ?? [];
    const label = results.map((result) => result.text).filter(Boolean).join(", ");
    return label || table.name || "";
  } catch (error) {
    console.error(error);
    ui.notifications.warn("Indy Downtime Tracker: failed to roll event table.");
    return "";
  }
}
export {
  getActorCheckBonus,
  getCheckSuccessChance,
  runIntervalRoll,
  runManualIntervalResult,
  runPhaseCompleteMacro,
};
