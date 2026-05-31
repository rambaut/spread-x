export function pickTopoObjectKey(topology, preferredNames = []) {
  const objects = topology?.objects || {};
  const keys = Object.keys(objects);
  if (!keys.length) return null;

  const preferred = preferredNames.map(name => String(name).toLowerCase());
  const direct = keys.find(k => preferred.includes(String(k).toLowerCase()));
  if (direct) return direct;

  const fuzzy = keys.find(k => preferred.some(name => String(k).toLowerCase().includes(name)));
  return fuzzy || keys[0];
}
