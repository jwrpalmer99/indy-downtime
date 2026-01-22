import {
  parseCheckOrder,
  parseCheckOrderToken,
  parseList,
  parseNarrativeLines,
  parseNumberList,
} from "./parse.js";
import { getSkillAliases, getSkillLabel, resolveSkillKey } from "./labels.js";
import { buildDefaultCheckOrder, getPhaseSkillList, normalizePhaseConfig } from "./phase.js";

function refreshPhaseSkillSections(html, phaseId, isPhase1) {
  const skillAliases = getSkillAliases();
  const skillText = html
    .find(`.drep-skill-list[data-phase-id='${phaseId}']`)
    .val();
  const skills = parseList(skillText);
  if (!skills.length) return;

  const penaltySelect = html.find(
    `.drep-penalty-skill[data-phase-id='${phaseId}']`
  );
  if (penaltySelect.length) {
    const current = penaltySelect.val();
    penaltySelect.empty();
    for (const key of skills) {
      const label = getSkillLabel(resolveSkillKey(key, skillAliases));
      penaltySelect.append(`<option value="${key}">${label}</option>`);
    }
    if (skills.includes(current)) {
      penaltySelect.val(current);
    }
  }

  const targetValues = isPhase1
    ? extractPhaseSkillValues(html, phaseId, "skillTargets")
    : {};
  const stepValues = isPhase1
    ? extractPhaseSkillValues(html, phaseId, "skillDcSteps")
    : {};
  const narrativeValues = isPhase1
    ? extractPhaseSkillValues(html, phaseId, "skillNarratives")
    : {};

  if (isPhase1) {
    const targetContainer = html.find(
      `.drep-skill-targets[data-phase-id='${phaseId}'] .drep-state-grid`
    );
    const stepContainer = html.find(
      `.drep-skill-steps[data-phase-id='${phaseId}'] .drep-state-grid`
    );
    const narrativeContainer = html.find(
      `.drep-skill-narratives[data-phase-id='${phaseId}']`
    );

    if (targetContainer.length) {
      targetContainer.empty();
      for (const key of skills) {
        const label = getSkillLabel(resolveSkillKey(key, skillAliases));
        const value = targetValues[key] ?? "";
        targetContainer.append(`
          <label>
            ${label}
            <input type="number" name="phases.${phaseId}.skillTargets.${key}" value="${value}" min="0" />
          </label>
        `);
      }
    }

    if (stepContainer.length) {
      stepContainer.empty();
      for (const key of skills) {
        const label = getSkillLabel(resolveSkillKey(key, skillAliases));
        const value = stepValues[key] ?? "";
        stepContainer.append(`
          <label>
            ${label}
            <input type="text" name="phases.${phaseId}.skillDcSteps.${key}" value="${value}" placeholder="13, 14, 15" />
          </label>
        `);
      }
    }

    if (narrativeContainer.length) {
      const summary = narrativeContainer.find("summary");
      narrativeContainer.children(".form-group").remove();
      for (const key of skills) {
        const label = getSkillLabel(resolveSkillKey(key, skillAliases));
        const value = narrativeValues[key] ?? "";
        const block = $(`
          <div class="form-group">
            <label>${label}</label>
            <textarea name="phases.${phaseId}.skillNarratives.${key}" rows="4"></textarea>
            <p class="notes"><span class="drep-note-lines">One line per step:<br>step|Title|Text</span></p>
          </div>
        `);
        block.find("textarea").val(value);
        summary.after(block);
      }
    }
  } else {
    const dcContainer = html.find(
      `.drep-skill-dcs[data-phase-id='${phaseId}'] .drep-state-grid`
    );
    const dcValues = extractPhaseSkillValues(html, phaseId, "skillDcs");
    if (dcContainer.length) {
      dcContainer.empty();
      for (const key of skills) {
        const label = getSkillLabel(resolveSkillKey(key, skillAliases));
        const value = dcValues[key] ?? "";
        dcContainer.append(`
          <label>
            ${label}
            <input type="number" name="phases.${phaseId}.skillDcs.${key}" value="${value}" min="0" />
          </label>
        `);
      }
    }
  }
  const checkOrderList = html.find(
    `.drep-check-order-list[data-phase-id='${phaseId}']`
  );
  if (checkOrderList.length) {
    const labelForEntry = (entry) => {
      const token = parseCheckOrderToken(entry);
      const skillKey = token.skill || entry;
      const label = getSkillLabel(resolveSkillKey(skillKey, skillAliases));
      if (isPhase1) {
        const step = token.step ?? 1;
        return `${label} ${step}`;
      }
      return label;
    };
    const phase = {
      id: isPhase1 ? "phase1" : phaseId,
      skills,
      skillTargets: targetValues,
    };
    const order = buildDefaultCheckOrder(phase);
    checkOrderList.empty();
    for (const entry of order) {
      checkOrderList.append(
        `<li draggable="true" data-order="${entry}">${labelForEntry(entry)}</li>`
      );
    }
    const checkOrderInput = html.find(
      `input[name='phases.${phaseId}.checkOrder']`
    );
    if (checkOrderInput.length) {
      checkOrderInput.val(order.join(", "));
    }
  }
}


function extractPhaseSkillValues(html, phaseId, field) {
  const values = {};
  html
    .find(`[name^="phases.${phaseId}.${field}."]`)
    .each((_, input) => {
      const name = input.name;
      const key = name.split(".").pop();
      values[key] = $(input).val();
    });
  return values;
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

    if (typeof data.skills === "string" && data.skills.trim()) {
      next.skills = parseList(data.skills);
    }

    if (next.id === "phase1") {
      const skillTargets = {};
      const skillDcSteps = {};
      const skillNarratives = {};
      for (const key of getPhaseSkillList(next)) {
        const targetValue = data.skillTargets?.[key];
        if (Number.isFinite(Number(targetValue))) {
          skillTargets[key] = Math.max(0, Number(targetValue));
        } else if (Number.isFinite(next.skillTargets?.[key])) {
          skillTargets[key] = Number(next.skillTargets?.[key]);
        }

        const stepRaw = data.skillDcSteps?.[key];
        if (typeof stepRaw === "string") {
          const steps = parseNumberList(stepRaw);
          if (steps.length) {
            skillDcSteps[key] = steps;
          }
        }
        if (!skillDcSteps[key] && Array.isArray(next.skillDcSteps?.[key])) {
          skillDcSteps[key] = next.skillDcSteps[key];
        }

        const narrativeRaw = data.skillNarratives?.[key];
        if (typeof narrativeRaw === "string") {
          const parsed = parseNarrativeLines(narrativeRaw);
          if (Object.keys(parsed).length) {
            skillNarratives[key] = parsed;
          }
        }
        if (!skillNarratives[key] && next.skillNarratives?.[key]) {
          skillNarratives[key] = next.skillNarratives[key];
        }
      }
      next.skillTargets = skillTargets;
      next.skillDcSteps = skillDcSteps;
      next.skillNarratives = skillNarratives;
    } else {
      const skillDcs = {};
      for (const key of getPhaseSkillList(next)) {
        const dcValue = data.skillDcs?.[key];
        if (Number.isFinite(Number(dcValue))) {
          skillDcs[key] = Math.max(0, Number(dcValue));
        } else if (Number.isFinite(next.skillDcs?.[key])) {
          skillDcs[key] = Number(next.skillDcs?.[key]);
        }
      }
      next.skillDcs = skillDcs;
      if (typeof data.progressNarrative === "string") {
        const parsed = parseNarrativeLines(data.progressNarrative);
        if (Object.keys(parsed).length) {
          next.progressNarrative = parsed;
        }
      }
    }

    const penaltySkill =
      typeof data.dcPenaltySkill === "string"
        ? data.dcPenaltySkill.trim()
        : "";
    next.dcPenaltySkill = next.skills.includes(penaltySkill)
      ? penaltySkill
      : next.skills.includes("insight")
        ? "insight"
        : next.skills[0] ?? "";
    const penaltyValue = Number(data.dcPenaltyPerMissing);
    next.dcPenaltyPerMissing = Number.isFinite(penaltyValue)
      ? Math.max(0, penaltyValue)
      : Number(next.dcPenaltyPerMissing ?? 0);

    if (typeof data.failureLines === "string") {
      const lines = data.failureLines
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length);
      if (lines.length) {
        next.failureLines = lines;
      }
    }

    if (typeof data.failureEventTable === "string") {
      next.failureEventTable = data.failureEventTable.trim();
    }

        if (typeof data.image === "string") {
      next.image = data.image.trim();
    }

    next.enforceCheckOrder = Boolean(data.enforceCheckOrder);
    if (typeof data.checkOrder === "string") {
      next.checkOrder = parseCheckOrder(data.checkOrder);
    }

    return next;
  });

  return normalizePhaseConfig(updated);
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

function getCheckOrderListPhase (list) {
      let a = list
        .find("li")
        .map((_, item) => $(item).attr("data-order") ?? $(item).data("order"))
        .get();
      return a;
}

function isCheckOrderValid (order) {
      const lastBySkill = new Map();
      for (const entry of order) {
        const [skill, stepRaw] = String(entry).split(":");
        const step = Number(stepRaw);
        if (!skill || !Number.isFinite(step)) continue;
        const last = lastBySkill.get(skill);
        if (last !== undefined && step < last) {
          return false;
        }
        lastBySkill.set(skill, step);
      }
      return true;
    };



        function rebuildCheckOrderList(list, order) {
          const items = new Map();
          list.find("li").each((_, item) => {
            const key = $(item).attr("data-order") ?? $(item).data("order");
            if (!key) return;
            items.set(key, item);
          });
          list.empty();
          for (const entry of order) {
            const item = items.get(entry);
            if (item) list.append(item);
          }
        };

export {
  refreshPhaseSkillSections,
  extractPhaseSkillValues,
  applyPhaseConfigFormData,
  updatePhaseImagesFromForm,
  getCheckOrderListPhase,
  isCheckOrderValid,
  rebuildCheckOrderList
};
