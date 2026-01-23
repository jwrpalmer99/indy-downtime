import { debugLog, getIntervalLabel, getSkillLabel } from "./labels.js";

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

    ui.notifications.error("Indy Downtime Tracker: actor cannot roll skills.");

    return null;

  }

  try {

    if (game.user?.isGM && actor.hasPlayerOwner) {

      return await rollSkillDirect(actor, skillKey, advantage, disadvantage);

    }

    const config = { skill: skillKey };

    if (advantage) {

      config.advantage = true;

    }

    if (disadvantage) {

      config.disadvantage = true;

    }

    const rolls = await actor.rollSkill(

      config,

      { fastForward: true },

      {}

    );

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
  const checkLabel = getPhaseCheckLabel(selectedCheck);
  const rollData = getCheckRollData(
    activePhase,
    selectedCheck,
    activePhase.checkProgress
  );
  const skillKey = rollData.skill;
  const skillLabel = skillKey ? getSkillLabel(skillKey) : selectedCheck.skill;
  const dc = rollData.dc;

  const roll = await rollSkill(
    actor,
    skillKey,
    rollData.advantage,
    rollData.disadvantage
  );

  if (!roll) return;

  const total = roll.total ?? roll._total ?? 0;

  const success = total >= dc;

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

    total,

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

async function postSummaryMessage({

  actor,

  checkLabel,

  skillLabel,

  dc,

  total,

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

        <h3>${getIntervalLabel(trackerId)} Check: ${checkLabel}</h3>

        <p><strong>Actor:</strong> ${actor.name}</p>

        <p><strong>Skill:</strong> ${skillLabel}</p>

        <p><strong>DC:</strong> ${dc}</p>

        <p><strong>Result:</strong> ${total} (${outcome})</p>

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

  rollSkill,

  rollSkillDirect,

  runIntervalRoll,

  runPhaseCompleteMacro,

  postSummaryMessage,

  handleCompletion,

  isCriticalSuccess,

  rollFailureEventTable,

};
