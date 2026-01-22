
function parseList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,;\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length);
}


function parseNumberList(raw) {
  if (!raw) return [];
  return parseList(raw)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}


function parseNarrativeLines(raw) {
  const output = {};
  if (!raw) return output;
  const lines = String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length);
  for (const line of lines) {
    const [rawKey, rawTitle, ...rawText] = line.split("|");
    const key = Number(rawKey);
    if (!Number.isFinite(key)) continue;
    const title = (rawTitle ?? "").trim();
    const text = rawText.join("|").trim();
    if (!title && !text) continue;
    output[key] = { title, text };
  }
  return output;
}


function parseCheckOrder(raw) {
  if (!raw) return [];
  return parseList(raw)
    .map((value) => value.trim())
    .filter((value) => value.length);
}


function parseCheckOrderToken(token) {
  const [skill, stepRaw] = String(token).split(":");
  const step = Number(stepRaw);
  return {
    skill: (skill ?? "").trim(),
    step: Number.isFinite(step) ? step : null,
  };
}


function serializeNumberList(values) {
  if (!Array.isArray(values)) return "";
  return values.filter((value) => Number.isFinite(value)).join(", ");
}


function serializeNarrativeLines(narratives) {
  if (!narratives) return "";
  const entries = Object.entries(narratives)
    .map(([key, value]) => ({
      key: Number(key),
      title: value?.title ?? "",
      text: value?.text ?? "",
    }))
    .filter((entry) => Number.isFinite(entry.key))
    .sort((a, b) => a.key - b.key);
  return entries
    .map((entry) => `${entry.key}|${entry.title}|${entry.text}`)
    .join("\n");
}


function parseJsonPayload(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(error);
    ui.notifications.error("Indy Downtime Tracker: invalid JSON.");
    return null;
  }
}


export {
  parseList,
  parseNumberList,
  parseNarrativeLines,
  parseCheckOrder,
  parseCheckOrderToken,
  serializeNumberList,
  serializeNarrativeLines,
  parseJsonPayload,
};
