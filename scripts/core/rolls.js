import { debugLog, getIntervalLabel, getSkillAliases, getSkillLabel, resolveSkillKey } from "./labels.js";
import {
  getActivePhase,
  getPhaseCheckById,
  getPhaseDefinition,
  getPhaseCheckLabel,
  getPhaseCheckTarget,
  getPhaseDc,
  getPhaseProgress,
  getPhaseAvailableChecks,
  initializePhaseState,
  isPhaseComplete,
  pickLineForCheck,
} from "./phase.js";
import {
  getNextIncompletePhaseId,
  getWorldState,
  setWorldState,
} from "./state.js";
import { getCurrentTrackerId } from "./tracker.js";

async function rollSkill(actor, skillKey, advantage) {
  if (!actor?.rollSkill) {
    ui.notifications.error("Indy Downtime Tracker: actor cannot roll skills.");
    return null;
  }
  try {
    if (game.user?.isGM && actor.hasPlayerOwner) {
      return await rollSkillDirect(actor, skillKey, advantage);
    }
    const config = { skill: skillKey };
    if (advantage) {
      config.advantage = true;
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
      return rollSkillDirect(actor, skillKey, advantage);
    }
    ui.notifications.error("Indy Downtime Tracker: roll failed.");
    return null;
  }
}

async function rollSkillDirect(actor, skillKey, advantage) {
  const skillData = actor.system?.skills?.[skillKey];
  const mod = Number(skillData?.total ?? skillData?.mod ?? 0);
  const formula = advantage ? "2d20kh + @mod" : "1d20 + @mod";
  const roll = await new Roll(formula, { mod }).evaluate({ async: true });
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${getSkillLabel(skillKey)} Check`,
  });
  return roll;
}

async function runIntervalRoll({ actor, checkChoice, trackerId }) {
  const skillAliases = getSkillAliases();
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

  const skillKey = resolveSkillKey(selectedCheck.skill, skillAliases);
  const skillLabel = skillKey ? getSkillLabel(skillKey) : selectedCheck.skill;
  const checkLabel = getPhaseCheckLabel(selectedCheck, skillAliases);

  const dc = getPhaseDc(activePhase, selectedCheck);
  const roll = await rollSkill(actor, skillKey, false);
  if (!roll) return;

  const total = roll.total ?? roll._total ?? 0;
  const success = total >= dc;

  state.checkCount = Number.isFinite(state.checkCount) ? state.checkCount + 1 : 1;

  let progressGained = 0;
  let criticalBonusApplied = false;
  let successLine = "";
  let failureLine = "";

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
    successLine = pickLineForCheck(
      activePhase.successLines,
      selectedCheck.id,
      selectedCheck.groupId
    );
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
    skillChoice: selectedCheck.skill,
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
        <h3>${getIntervalLabel()} Check: ${checkLabel}</h3>
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
