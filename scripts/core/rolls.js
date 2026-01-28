import { debugLog, getIntervalLabel, getSkillLabel, getCheckRollMode, normalizeNarrativeOutcome, getNarrativeOutcomeLabel, isNarrativeOutcomeSuccess } from "./labels.js";
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
  completeGroupProgress,
  completePhaseProgress,
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
function getCheckSuccessChance({ dc, bonus, advantage, disadvantage, trackerId } = {}) {
  if (getCheckRollMode(trackerId) !== "d20") return null;
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

function resolveActorMethod(actor, methodName) {
  if (typeof actor?.[methodName] === "function") {
    return actor[methodName].bind(actor);
  }

  if (typeof Actor?.prototype?.[methodName] === "function") {
    return Actor.prototype[methodName].bind(actor);
  }

  return null;
}

async function rollSkill(actor, skillKey, advantage, disadvantage, difficulty = null) {
  if (advantage && disadvantage) {
    advantage = false;
    disadvantage = false;
  }
  if (isAbilityKey(skillKey)) {
    return rollAbility(actor, getAbilityKey(skillKey), advantage, disadvantage);
  }
  let rollSkillFn = resolveActorMethod(actor, "rollSkill");

  if (!rollSkillFn) {
    if (game.system?.id === "pf2e") {
      const pf2eRoll = await rollPf2eSkill(actor, skillKey, advantage, disadvantage);
      if (pf2eRoll) return pf2eRoll;
    } else {
      rollSkillFn = resolveActorMethod(actor, "setupSkillTest");
      if (!rollSkillFn) {
        rollSkillFn = resolveActorMethod(actor, "skillCheck");
      }
    }
  }

  if (!rollSkillFn) {
    ui.notifications.error(
      "Indy Downtime Tracker: actor cannot roll skills. Set Indy Downtime Tracker to use manual results or use a compatible system."
    );
    return null;
  } 
  try {
    if (game.user?.isGM && actor.hasPlayerOwner) {
      return await rollSkillDirect(actor, skillKey, advantage, disadvantage);
    }
    // Detect Midi-QOL (works in v13)
    const hasMidi = !!game.modules.get("midi-qol")?.active;
    // Base config works for both
     if (game.system?.id == "dnd5e")
    {
      const rollConfig = { skill: skillKey };
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
      const rolls = await rollSkillFn.call(actor, rollConfig, {
        fastForward: true,
        event
      });
   
      if (Array.isArray(rolls)) {
        return rolls[0] ?? null;
      }
    }
    else if (game.system?.id == "CoC7")
    {
      //coc7
      let difstring  = "?";
      switch (difficulty)
      {
        case "regular":
          difstring = "0";
          break;
        case "hard":
          difstring = "+";
          break;
        case "extreme":
          difstring = "++";
          break;
      }
      let options = { difficulty : difstring};
      let skillString = skillKey.toString();
      const rolls = await rollSkillFn.call(actor, skillString, true, options);        
      return rolls ?? null;
    }    
    else 
    {
      //system agnostic
      let skillString = skillKey.toString();
      const rolls = await rollSkillFn.call(actor, skillString, {});        
      return rolls ?? null;
    }
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
    activePhase.checkProgress,
    activePhase.resolvedChecks
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
    activePhase.checkProgress,
    activePhase.resolvedChecks,
    resolvedTrackerId
  );
  const skillKey = rollData.skill || selectedCheck.skill || "";
  const skillLabel = skillKey ? getSkillLabel(skillKey) : selectedCheck.skill;
  const rollMode = getCheckRollMode(resolvedTrackerId);
  if (rollMode === "narrative") {
    ui.notifications.warn("Indy Downtime Tracker: narrative checks must be resolved manually.");
    return;
  }
  const dc = rollData.dc;
  const difficulty = rollData.difficulty ?? "";
  const difficultyLabel = rollData.difficultyLabel ?? getDifficultyLabel(difficulty);
  const roll = await rollSkill(
    actor,
    skillKey,
    rollData.advantage,
    rollData.disadvantage,
    rollData.difficulty
  );
  if (!roll) return;
  const firstPositive = (...values) =>
  values.find(v => typeof v === "number" && v > 0) ?? 0;

  const total = firstPositive(
    roll.total,
    roll._total,
    roll.roll?.total,
    roll.roll?._total,
    roll.dice.total
  );
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
    if (selectedCheck.completeGroupOnSuccess) {
      completeGroupProgress(activePhase, selectedCheck.groupId, activePhase.checkProgress);
    }
    if (selectedCheck.completePhaseOnSuccess) {
      completePhaseProgress(activePhase, activePhase.checkProgress);
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
  const macroResult = success ? "success" : "failure";
  state.log.unshift({
    checkNumber: state.checkCount,
    phaseId: activePhase.id,
    phaseName: activePhase.name,
    actorId: actor.id,
    actorName: actor.name,
    actorUuid: actor.uuid ?? "",
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
  await grantCheckSuccessItems({
    check: selectedCheck,
    actor,
    actorId: actor?.id ?? "",
    actorUuid: actor?.uuid ?? "",
    result: macroResult,
  });
  await runCheckCompleteMacro({
    phase: activePhase,
    check: selectedCheck,
    actor,
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? "",
    actorUuid: actor?.uuid ?? "",
    trackerId: resolvedTrackerId,
    result: macroResult,
    checkName: checkLabel,
    phaseName: activePhase.name,
  });
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
async function runManualIntervalResult({ actor, checkId, checkChoice, trackerId, success, outcome }) {
  const resolvedTrackerId = trackerId ?? getCurrentTrackerId();
  const state = getWorldState(resolvedTrackerId);
  const activePhase = getActivePhase(state, resolvedTrackerId);
  if (activePhase.completed) return;
  const availableChecks = getPhaseAvailableChecks(
    activePhase,
    activePhase.checkProgress,
    activePhase.resolvedChecks
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
    activePhase.checkProgress,
    activePhase.resolvedChecks,
    resolvedTrackerId
  );
  const skillKey = rollData.skill || selectedCheck.skill || "";
  const skillLabel = skillKey ? getSkillLabel(skillKey) : selectedCheck.skill;
  const rollMode = getCheckRollMode(resolvedTrackerId);
  const dc = rollData.dc;
  const difficulty = rollData.difficulty ?? "";
  const difficultyLabel = rollData.difficultyLabel ?? getDifficultyLabel(difficulty);
  const useDifficultyLabel = rollMode === "d100" || rollMode === "narrative";
  const dcLabel = useDifficultyLabel ? difficultyLabel : (Number.isFinite(dc) ? String(dc) : "");
  const dcLabelType = useDifficultyLabel ? "Difficulty" : "DC";
  const normalizedOutcome = rollMode === "narrative" ? normalizeNarrativeOutcome(outcome) : "";
  const resolvedOutcome = rollMode === "narrative" ? (normalizedOutcome || "failure") : "";
  const outcomeLabel = rollMode === "narrative" ? getNarrativeOutcomeLabel(resolvedOutcome) : "";
  const isSuccess = rollMode === "narrative"
    ? isNarrativeOutcomeSuccess(resolvedOutcome)
    : Boolean(success);
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
    if (selectedCheck.completeGroupOnSuccess) {
      completeGroupProgress(activePhase, selectedCheck.groupId, activePhase.checkProgress);
    }
    if (selectedCheck.completePhaseOnSuccess) {
      completePhaseProgress(activePhase, activePhase.checkProgress);
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
  if (rollMode === "narrative") {
    activePhase.resolvedChecks = activePhase.resolvedChecks ?? {};
    activePhase.resolvedChecks[selectedCheck.id] = resolvedOutcome;
  }
  state.phases[activePhase.id] = {
    progress: activePhase.progress,
    completed: activePhase.completed,
    failuresInRow: activePhase.failuresInRow,
    checkProgress: activePhase.checkProgress ?? {},
    resolvedChecks: activePhase.resolvedChecks ?? {},
  };
  if (isPhaseComplete(activePhase)) {
    state.phases[activePhase.id].completed = true;
    await handleCompletion(state, activePhase, actor, resolvedTrackerId);
  }
  const macroResult = resolvedOutcome || (isSuccess ? "success" : "failure");
  state.log.unshift({
    checkNumber: state.checkCount,
    phaseId: activePhase.id,
    phaseName: activePhase.name,
    actorId: actor.id,
    actorName: actor.name,
    actorUuid: actor.uuid ?? "",
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
    outcome: resolvedOutcome,
    outcomeLabel,
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
  await grantCheckSuccessItems({
    check: selectedCheck,
    actor,
    actorId: actor?.id ?? "",
    actorUuid: actor?.uuid ?? "",
    result: macroResult,
  });
  await runCheckCompleteMacro({
    phase: activePhase,
    check: selectedCheck,
    actor,
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? "",
    actorUuid: actor?.uuid ?? "",
    trackerId: resolvedTrackerId,
    result: macroResult,
    checkName: checkLabel,
    phaseName: activePhase.name,
  });
  await postManualSummaryMessage({
    actor,
    checkLabel,
    skillLabel,
    dc,
    dcLabel,
    dcLabelType,
    outcomeLabel,
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
  outcomeLabel,
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
  const resultLine = outcomeLabel
    ? `<p><strong>Outcome:</strong> ${outcomeLabel}</p>`
    : `<p><strong>Result:</strong> ${outcome} (Manual)</p>`;
  const content = `
      <div class="drep-chat">
        <h4>${getIntervalLabel(trackerId)} Check: ${checkLabel}</h4>
        <p><strong>Actor:</strong> ${actor.name}</p>
        <p><strong>Skill:</strong> ${skillLabel}</p>
        ${targetLabel ? `<p><strong>${targetType}:</strong> ${targetLabel}</p>` : ""}
        ${resultLine}
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
function normalizeRewardItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === "string") {
        const uuid = entry.trim();
        if (!uuid) return null;
        return { uuid, qty: 1 };
      }
      const uuid = String(entry.uuid ?? entry.itemUuid ?? entry.id ?? "").trim();
      if (!uuid) return null;
      const qtyRaw = Number(entry.qty ?? entry.quantity ?? entry.count ?? 1);
      const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;
      return { uuid, qty };
    })
    .filter(Boolean);
}

function getConsumableType(item) {
  return foundry.utils.getProperty(item, "system.consumableType")
    ?? foundry.utils.getProperty(item, "system.consumable.type")
    ?? null;
}

function getItemQuantityInfo(item) {
  if (!item) return null;
  const valueField = Number(foundry.utils.getProperty(item, "system.quantity.value"));
  if (Number.isFinite(valueField)) {
    return { path: "system.quantity.value", value: valueField };
  }
  const value = Number(foundry.utils.getProperty(item, "system.quantity"));
  if (Number.isFinite(value)) {
    return { path: "system.quantity", value };
  }
  return null;
}

async function resolveRewardActor({ actor, actorId, actorUuid }) {
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
  return resolvedActor;
}

async function grantRewardItemsToActor({ actor, items }) {
  if (!actor || typeof actor.createEmbeddedDocuments !== "function") return;
  const normalized = normalizeRewardItems(items);
  if (!normalized.length) return;
  const creates = [];
  const createOverrides = [];
  const updates = [];
  const summary = new Map();
  const addSummary = (name, qty) => {
    if (!name || !Number.isFinite(qty) || qty <= 0) return;
    summary.set(name, (summary.get(name) ?? 0) + qty);
  };
  for (const entry of normalized) {
    const qty = Number(entry.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    let itemDoc = null;
    try {
      const doc = await fromUuid(entry.uuid);
      itemDoc = doc?.document ?? doc ?? null;
    } catch (error) {
      itemDoc = null;
    }
    if (!itemDoc || itemDoc.documentName !== "Item") continue;
    const itemData = itemDoc.toObject();
    const sourceId = itemData.flags?.core?.sourceId ?? itemDoc.uuid ?? "";
    const targetConsumableType = getConsumableType(itemData);
    const existing = actor.items?.find((owned) => {
      if (sourceId && owned.flags?.core?.sourceId === sourceId) return true;
      if (owned.name !== itemData.name || owned.type !== itemData.type) return false;
      const ownedConsumableType = getConsumableType(owned);
      return ownedConsumableType === targetConsumableType;
    }) ?? null;
    if (existing) {
      const qtyInfo = getItemQuantityInfo(existing);
      if (qtyInfo?.path) {
        updates.push({
          _id: existing.id,
          [qtyInfo.path]: Number(qtyInfo.value) + qty,
        });
        addSummary(existing.name, qty);
        continue;
      }
    }
    const qtyInfo = getItemQuantityInfo(itemData);
    const baseData = foundry.utils.deepClone(itemData);
    delete baseData._id;
    if (qtyInfo?.path) {
      foundry.utils.setProperty(baseData, qtyInfo.path, qty);
      creates.push(baseData);
      createOverrides.push({ path: qtyInfo.path, qty });
      addSummary(itemData.name, qty);
    } else {
      const count = Math.max(1, Math.round(qty));
      for (let i = 0; i < count; i += 1) {
        creates.push(foundry.utils.deepClone(baseData));
        createOverrides.push(null);
      }
      addSummary(itemData.name, count);
    }
  }
  if (updates.length) {
    try {
      await actor.updateEmbeddedDocuments("Item", updates);
    } catch (error) {
      console.error(error);
    }
  }
  if (creates.length) {
    try {
      const created = await actor.createEmbeddedDocuments("Item", creates);
      if (Array.isArray(created) && created.length) {
        const postUpdates = [];
        for (let i = 0; i < created.length; i += 1) {
          const override = createOverrides[i];
          if (!override?.path) continue;
          const doc = created[i];
          if (!doc?.id) continue;
          postUpdates.push({ _id: doc.id, [override.path]: override.qty });
        }
        if (postUpdates.length) {
          await actor.updateEmbeddedDocuments("Item", postUpdates);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }
  if (summary.size) {
    const itemsList = Array.from(summary.entries())
      .map(([name, qty]) => `<li>${qty} x ${name}</li>`)
      .join("");
    const content = `
      <div class="drep-chat">
        <h4>Items Granted</h4>
        <p><strong>Actor:</strong> ${actor.name}</p>
        <ul>${itemsList}</ul>
      </div>`;
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content,
      });
    } catch (error) {
      console.error(error);
    }
  }
}

async function grantCheckSuccessItems({
  check,
  actor,
  actorId,
  actorUuid,
  result,
}) {
  if (!check || !game.user?.isGM) return;
  if (result !== "success" && result !== "triumph") return;
  const items = check.checkSuccessItems ?? [];
  if (!Array.isArray(items) || !items.length) return;
  const resolvedActor = await resolveRewardActor({ actor, actorId, actorUuid });
  if (!resolvedActor) return;
  await grantRewardItemsToActor({ actor: resolvedActor, items });
}

async function grantPhaseCompletionItems({
  phase,
  actor,
  actorId,
  actorUuid,
}) {
  if (!phase || !game.user?.isGM) return;
  const items = phase.phaseCompleteItems ?? [];
  if (!Array.isArray(items) || !items.length) return;
  const resolvedActor = await resolveRewardActor({ actor, actorId, actorUuid });
  if (!resolvedActor) return;
  await grantRewardItemsToActor({ actor: resolvedActor, items });
}
async function runCheckCompleteMacro({
  phase,
  check,
  actor,
  actorId,
  actorName,
  actorUuid,
  trackerId,
  result,
  checkName,
  phaseName,
}) {
  if (!check) return;
  const macroUuid = String(check.checkCompleteMacro ?? "").trim();
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
    const resolvedPhaseName = phaseName ?? phase?.name ?? "";
    const resolvedCheckName = checkName ?? getPhaseCheckLabel(check) ?? "";
    const payload = {
      actor: resolvedActor ?? actor ?? null,
      actorId: actorId ?? "",
      actorName: actorName ?? "",
      actorUuid: actorUuid ?? "",
      phase: phase ?? null,
      phaseName: resolvedPhaseName,
      check: check ?? null,
      checkName: resolvedCheckName,
      result: typeof result === "string" ? result : "",
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
  if (!Array.isArray(state.log)) {
    state.log = [];
  }
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
  await grantPhaseCompletionItems({
    phase: activePhase,
    actor,
    actorId: actor?.id ?? "",
    actorUuid: actor?.uuid ?? "",
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
  grantCheckSuccessItems,
  grantPhaseCompletionItems,
  runCheckCompleteMacro,
  runPhaseCompleteMacro,
};
