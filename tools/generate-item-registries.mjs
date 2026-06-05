/**
 * Generate item registry JSON files for maledictum-expanded/tools/:
 *   system-talents.json   — talent type items
 *   system-weapons.json   — weapon type items
 *   system-equipment.json — equipment type items
 *   system-powers.json    — power (psychic) type items
 *   system-ammo.json      — ammo type items
 *   system-modifications.json — modification type items
 *   system-protection.json — protection type items
 *
 * Each registry is keyed by lowercase item name → { name, packId, item, effectDocs[] }
 * First pack encountered for a given name wins (core > inquisition > starter-set).
 *
 * Run from packages/maledictum-expanded:
 *   node tools/generate-item-registries.mjs
 *
 * Requires foundry-path.js to be set up (copy from foundry-path.example.js).
 * Override the Data directory with: FOUNDRY_DATA=<path> node tools/generate-item-registries.mjs
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { ClassicLevel } = require(path.resolve(__dirname, "../../../node_modules/classic-level"));

// Derive the Foundry Data directory from foundry-path.js (which returns the module output path).
// foundry-path.js returns e.g. "C:\Users\...\FoundryVTT\Data\modules\maledictum-expanded"
// Two levels up → "C:\Users\...\FoundryVTT\Data"
let FOUNDRY_DATA = process.env.FOUNDRY_DATA;
if (!FOUNDRY_DATA) {
  try {
    const { default: getFoundryPath } = await import(pathToFileURL(path.join(PKG, "foundry-path.js")).href);
    FOUNDRY_DATA = path.resolve(getFoundryPath(), "../..");
  } catch {
    console.error("foundry-path.js not found and FOUNDRY_DATA env var not set.");
    console.error("Copy foundry-path.example.js to foundry-path.js and set your Foundry path.");
    process.exit(1);
  }
}

const ITEM_PACKS = [
  { packId: "impmal-core",        dir: path.join(FOUNDRY_DATA, "modules/impmal-core/packs/items") },
  { packId: "impmal-inquisition", dir: path.join(FOUNDRY_DATA, "modules/impmal-inquisition/packs/items") },
  { packId: "impmal-starter-set", dir: path.join(FOUNDRY_DATA, "modules/impmal-starter-set/packs/items") },
];

const OUT_DIR = __dirname;
const TYPES = ["talent", "weapon", "equipment", "power", "ammo", "modification", "protection"];

// One registry map per type
const registries = Object.fromEntries(TYPES.map(t => [t, {}]));

for (const { packId, dir } of ITEM_PACKS) {
  if (!fs.existsSync(dir)) {
    console.warn(`Skipping ${packId}: directory not found (${dir})`);
    continue;
  }

  const db = new ClassicLevel(dir, { valueEncoding: "json" });

  // First pass: collect items by type
  const itemsByType = Object.fromEntries(TYPES.map(t => [t, new Map()])); // type → (id → item)
  for await (const [k, v] of db.iterator()) {
    if (k.includes(".effects!")) continue;
    if (v?.type && TYPES.includes(v.type)) {
      itemsByType[v.type].set(v._id, v);
    }
  }

  // Second pass: collect effects for each item
  const effectsByItem = new Map(); // itemId → [effectDoc, ...]
  const allIds = new Set(TYPES.flatMap(t => [...itemsByType[t].keys()]));
  for await (const [k, v] of db.iterator()) {
    const m = k.match(/^!items\.effects!([^.]+)\.(.+)$/);
    if (m && allIds.has(m[1])) {
      const itemId = m[1];
      if (!effectsByItem.has(itemId)) effectsByItem.set(itemId, []);
      effectsByItem.get(itemId).push(v);
    }
  }

  await db.close();

  for (const type of TYPES) {
    const registry = registries[type];
    let added = 0;
    for (const [itemId, item] of itemsByType[type]) {
      const key = item.name.toLowerCase();
      if (registry[key]) continue; // first pack wins

      const { folder: _f, ownership: _o, ...itemClean } = item;
      registry[key] = {
        name: item.name,
        packId,
        item: itemClean,
        effectDocs: effectsByItem.get(itemId) || [],
      };
      added++;
    }
    console.log(`  [${packId}] ${type}: ${itemsByType[type].size} found, ${added} added to registry`);
  }
}

const OUT_FILES = {
  talent:       "system-talents.json",
  weapon:       "system-weapons.json",
  equipment:    "system-equipment.json",
  power:        "system-powers.json",
  ammo:         "system-ammo.json",
  modification: "system-modifications.json",
  protection:   "system-protection.json",
};

for (const type of TYPES) {
  const outPath = path.join(OUT_DIR, OUT_FILES[type]);
  const total = Object.keys(registries[type]).length;
  fs.writeFileSync(outPath, JSON.stringify(registries[type], null, 2) + "\n");
  console.log(`Wrote ${total} ${type}s → ${outPath}`);
}
