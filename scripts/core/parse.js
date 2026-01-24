
function parseList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,;\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length);
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
  parseJsonPayload,
};
