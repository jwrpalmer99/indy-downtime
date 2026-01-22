import { debugLog, getIntervalLabel, getSkillAliases, getSkillLabel, pickFailureLine, resolveSkillKey, shouldHideDc } from "./labels.js";
import {
  getActivePhase,
  getDefaultSkills,
  getPhaseConfig,
  getPhaseDc,
  getPhaseDefinition,
  getPhase1ContextNote,
  getPhase1Narrative,
  getPhase1SkillProgress,
  getPhase1TotalProgress,
  getPhaseSkillList,
  getPhaseSkillTarget,
  getForcedSkillChoice,
  getNextOrderedSkillChoice,
  hasForcedSkillRule,
  initializePhaseState,
  isPhaseComplete,
} from "./phase.js";
import {
  buildPhase1ProgressLine,
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


async function runIntervalRoll({ actor, skillChoice, trackerId }) {
  const skillAliases = getSkillAliases();
  const resolvedTrackerId = trackerId ?? getCurrentTrackerId();
  const phaseConfig = getPhaseConfig(resolvedTrackerId);
  const state = getWorldState(resolvedTrackerId);
  const activePhase = getActivePhase(state, resolvedTrackerId);
  if (activePhase.completed) return;

  const orderedSkillChoice = getNextOrderedSkillChoice(activePhase);
  const forcedSkillChoice =
    getForcedSkillChoice(activePhase) || orderedSkillChoice;
  let allowedSkills = getPhaseSkillList(activePhase);
  if (activePhase.id === "phase1") {
    const progress = getPhase1SkillProgress(activePhase);
    allowedSkills = allowedSkills.filter((key) => {
      const target = getPhaseSkillTarget(activePhase, key);
      return (progress[key] ?? 0) < target;
    });
  }
  if (!allowedSkills.length) {
    ui.notifications.warn("Indy Downtime Tracker: configure skills before rolling.");
    return;
  }
  const resolvedSkillChoice = forcedSkillChoice
    ? forcedSkillChoice
    : skillChoice || allowedSkills[0] || getDefaultSkills()[0] || "";
  const finalSkillChoice = allowedSkills.includes(resolvedSkillChoice)
    ? resolvedSkillChoice
    : allowedSkills[0] || getDefaultSkills()[0] || "";
  const skillKey = resolveSkillKey(finalSkillChoice, skillAliases);
  const skillLabel = getSkillLabel(skillKey);

  const dc = getPhaseDc(activePhase, finalSkillChoice);
  const roll = await rollSkill(actor, skillKey, false);
  if (!roll) return;

  const total = roll.total ?? roll._total ?? 0;
  const success = total >= dc;

  state.checkCount = Number.isFinite(state.checkCount) ? state.checkCount + 1 : 1;

  let progressGained = 0;
  let criticalBonusApplied = false;
  let narrative = null;
  let contextNote = "";
  if (success) {
    if (activePhase.id === "phase1") {
      const phase1Progress = getPhase1SkillProgress(activePhase);
      const currentValue = phase1Progress[finalSkillChoice] ?? 0;
      const maxValue = getPhaseSkillTarget(activePhase, finalSkillChoice);
      if (currentValue < maxValue) {
        progressGained = 1;
        let nextValue = Math.min(currentValue + 1, maxValue);
        if (
          activePhase.allowCriticalBonus &&
          isCriticalSuccess(roll)
        ) {
          const boosted = Math.min(nextValue + 1, maxValue);
          if (boosted > nextValue) {
            nextValue = boosted;
            progressGained += 1;
            criticalBonusApplied = true;
          }
        }
        phase1Progress[finalSkillChoice] = nextValue;
        activePhase.skillProgress = phase1Progress;
        narrative = getPhase1Narrative(
          activePhase,
          finalSkillChoice,
          activePhase.skillProgress
        );
        contextNote = getPhase1ContextNote(
          finalSkillChoice,
          activePhase.skillProgress,
          progressGained > 0
        );
      }
      activePhase.progress = getPhase1TotalProgress(activePhase);
      activePhase.completed = isPhaseComplete(activePhase);
      activePhase.failuresInRow = 0;
    } else {
      progressGained = 1;
      if (
        activePhase.allowCriticalBonus &&
        isCriticalSuccess(roll)
      ) {
        progressGained += 1;
        criticalBonusApplied = true;
      }
      activePhase.progress = Math.min(
        activePhase.progress + progressGained,
        activePhase.target
      );
      activePhase.failuresInRow = 0;
      narrative =
        activePhase.progressNarrative?.[activePhase.progress] ?? null;
    }
  } else if (hasForcedSkillRule(activePhase)) {
    activePhase.failuresInRow += 1;
  }

  const failureLine = success
    ? null
    : pickFailureLine(activePhase.failureLines);
  const failureEvent = Boolean(!success && activePhase.failureEvents);
  let failureEventResult = "";
  if (!success && failureEvent) {
    failureEventResult = await rollFailureEventTable(activePhase, actor);
  }

  state.phases[activePhase.id] = {
    progress: activePhase.progress,
    completed: activePhase.completed,
    failuresInRow: activePhase.failuresInRow,
    skillProgress: activePhase.skillProgress ?? undefined,
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
    skillChoice: finalSkillChoice,
    skillKey,
    skillLabel,
    dc,
    total,
    success,
    progressGained,
    criticalBonusApplied,
    narrativeTitle: narrative?.title ?? "",
    narrativeText: narrative?.text ?? "",
    contextNote,
    skillProgress: activePhase.skillProgress ?? undefined,
    failureLine: failureLine ?? "",
    failureEvent,
    failureEventResult,
    timestamp: Date.now(),
  });
  state.log = state.log.slice(0, 50);

  await setWorldState(state, resolvedTrackerId);
  await postSummaryMessage({
    actor,
    skillLabel,
    dc,
    total,
    success,
    progress: state.phases[activePhase.id].progress,
    progressTarget: activePhase.target,
    progressGained,
    criticalBonusApplied,
    narrative,
    contextNote,
    failureLine,
    failureEvent,
    failureEventResult,
    forcedSkillChoice,
    forcedSkillLabel: forcedSkillChoice
      ? getSkillLabel(resolveSkillKey(forcedSkillChoice, skillAliases))
      : "",
    phase1SkillProgress: activePhase.skillProgress,
    phase1SkillTargets: activePhase.skillTargets,
    phase1SkillList: getPhaseSkillList(activePhase),
  });
}


async function postSummaryMessage({
  actor,
  skillLabel,
  dc,
  total,
  success,
  progress,
  progressTarget,
  progressGained,
  criticalBonusApplied,
  narrative,
  contextNote,
  failureLine,
  failureEvent,
  failureEventResult,
  forcedSkillChoice,
  forcedSkillLabel,
  phase1SkillProgress,
  phase1SkillTargets,
  phase1SkillList,
}) {
  const outcome = success ? "Success" : "Failure";
  const progressLine = success
    ? `<p><strong>Progress:</strong> ${progress} / ${progressTarget}${
        progressGained ? ` (+${progressGained})` : ""
      }</p>`
    : `<p><strong>Progress:</strong> ${progress} / ${progressTarget}</p>`;
  const phase1Line = buildPhase1ProgressLine(
    phase1SkillProgress,
    phase1SkillTargets,
    phase1SkillList
  );
  const phase1Block = phase1Line
    ? `<p><strong>Phase 1:</strong> ${phase1Line}</p>`
    : "";
  const criticalLine = criticalBonusApplied
    ? "<p><strong>Critical:</strong> Bonus progress applied.</p>"
    : "";
  const forcedNote = forcedSkillChoice
    ? `<p><strong>Note:</strong> Two failures in a row. ${forcedSkillLabel} was required.</p>`
    : "";
  const narrativeBlock = narrative
    ? `<div class="narrative"><strong>${narrative.title}:</strong> ${narrative.text}</div>`
    : "";
  const contextBlock = contextNote
    ? `<div class="narrative"><strong>Note:</strong> ${contextNote}</div>`
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
        <h3>${getIntervalLabel()} Check: ${skillLabel}</h3>
        <p><strong>Actor:</strong> ${actor.name}</p>
        <p><strong>DC:</strong> ${dc}</p>
        <p><strong>Result:</strong> ${total} (${outcome})</p>
        ${progressLine}
        ${phase1Block}
        ${criticalLine}
        ${forcedNote}
        ${narrativeBlock}
        ${contextBlock}
        ${failureBlock}
        ${failureEventBlock}
      </div>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });
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
    timestamp: Date.now(),
  });
  state.log = state.log.slice(0, 50);

  if (nextPhase && nextPhaseId !== activePhase.id) {
    state.activePhaseId = nextPhaseId;
    initializePhaseState(state, nextPhase);
  }

  if (activePhase.id === "phase3") {
    const existing = state.journalId && game.journal.get(state.journalId);
    if (!existing) {
      const entry = await JournalEntry.create({
        name: "The Shared Ember",
        content: `
            <h2>The Shared Ember</h2>
            <p>The Shared Ember exists. Ash-Twenty-Seven emerges, and the Cogs now have a safe place.</p>
          `,
        folder: null,
      });
      state.journalId = entry?.id ?? "";
    }
  }

  await setWorldState(state, trackerId);

  const completionNote = nextPhaseName
    ? `Next phase activated: ${nextPhaseName}.`
    : "All phases completed.";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="drep-chat"><h3>Phase Complete</h3><p>${completionNote}</p></div>`,
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
  postSummaryMessage,
  handleCompletion,
  isCriticalSuccess,
  rollFailureEventTable,
};
