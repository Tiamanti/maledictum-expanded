/**
 * Generate docs/items.md — a reference doc listing every unique weapon,
 * equipment item, and psychic power found across all NPC stat blocks,
 * split into system matches vs custom entries.
 *
 * Run from packages/maledictum-expanded:
 *   node tools/generate-items-docs.mjs
 */

import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PKG          = path.resolve(__dirname, "..");
const BEASTIARY    = path.join(PKG, "40K IM Maledictum Expanded Brew", "Maledictum Expanded Beastiary");
const PARSE_SCRIPT = path.join(PKG, "tools/parse-rtf.py");
const TOOLS        = path.join(PKG, "tools");
const OUT          = path.join(PKG, "docs/items.md");

// ── Load registries ───────────────────────────────────────────────────────────
function loadRegistry(file) {
  try { return JSON.parse(fs.readFileSync(path.join(TOOLS, file), "utf-8")); }
  catch { return {}; }
}

const SYSTEM_WEAPONS       = loadRegistry("system-weapons.json");
const SYSTEM_EQUIPMENT     = loadRegistry("system-equipment.json");
const SYSTEM_POWERS        = loadRegistry("system-powers.json");
const SYSTEM_AMMO          = loadRegistry("system-ammo.json");
const SYSTEM_MODIFICATIONS = loadRegistry("system-modifications.json");
const SYSTEM_PROTECTION    = loadRegistry("system-protection.json");

function normaliseSpelling(s) {
  return s
    .replace(/\barmor\b/gi, "armour")
    .replace(/\bcolor\b/gi, "colour")
    .replace(/\bgray\b/gi, "grey");
}

function findInRegistry(registry, name) {
  const lower = name.toLowerCase();
  if (registry[lower]) return registry[lower];
  const base = name.replace(/\s*\([^)]+\)\s*$/, "").trim().toLowerCase();
  if (base !== lower && registry[base]) return registry[base];
  const nospace = lower.replace(/[\s\-]/g, "");
  const found = Object.keys(registry).find(k => k.replace(/[\s\-]/g, "") === nospace);
  if (found) return registry[found];
  const normalised = normaliseSpelling(lower);
  if (normalised !== lower && registry[normalised]) return registry[normalised];
  if (lower.endsWith("s")) {
    const singular = lower.slice(0, -1);
    if (registry[singular]) return registry[singular];
    const singularNospace = singular.replace(/[\s\-]/g, "");
    const foundSingular = Object.keys(registry).find(k => k.replace(/[\s\-]/g, "") === singularNospace);
    if (foundSingular) return registry[foundSingular];
  }
  return null;
}

// ── Name pre-processing (mirrors write-pack.mjs) ─────────────────────────────
const AMMO_CLIP_PATTERNS = [
  { re: /manstopper|man.?stopper/i, alias: "man-stopper bullets" },
  { re: /dumdum|dum.?dum/i,          alias: "dum-dum bullets" },
  { re: /hot.?shot\s+(las\s+)?pack/i, alias: "hot-shot las pack" },
  { re: /inferno\s+shell/i,          alias: "inferno shells" },
  { re: /bleeder/i,                  alias: "bleeder rounds" },
  { re: /blessed/i,                  alias: "blessed rounds" },
  { re: /executioner/i,              alias: "executioner rounds" },
  { re: /tox/i,                      alias: "tox rounds" },
];

const EQUIPMENT_ALIASES = {
  "auspex":           "auspex/scanner",
  "chirurgeon's kit": "chirurgeon's kit (5 uses)",
  "chirurgeons kit":  "chirurgeon's kit (5 uses)",
  "chirurgeon kit":   "chirurgeon's kit (5 uses)",
};

function isAmmoClipName(name) {
  const lower = name.toLowerCase();
  if (/\b(clips?|rounds?|bolts?|shells?|pack|cartridges?)\b/.test(lower)) {
    for (const { re, alias } of AMMO_CLIP_PATTERNS) {
      if (re.test(lower)) return alias;
    }
  }
  return null;
}

// Returns { baseName, quantity, modNames[], ammoAlias|null, resolvedWeaponEntry|null, categoryOverride }
function resolveWeapon(atk) {
  let name = atk.name.trim();
  let quantity = 1;
  const modNames = [];
  let ammoAlias = null;
  let hadWsuffix = false;

  const qtyM = name.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (qtyM) { quantity = parseInt(qtyM[1]); name = qtyM[2].trim(); }

  const ammoSuffix = name.match(/^(.+?)\s+w\/\s*(.+)$/i);
  if (ammoSuffix) {
    hadWsuffix = true;
    name = ammoSuffix[1].trim();
    const raw = ammoSuffix[2].trim();
    for (const { re, alias } of AMMO_CLIP_PATTERNS) {
      if (re.test(raw)) { ammoAlias = alias; break; }
    }
    if (!ammoAlias) ammoAlias = raw;
  }

  if (/^(silenced|suppressed)\s+/i.test(name)) {
    name = name.replace(/^(silenced|suppressed)\s+/i, "");
    modNames.push("Silencer");
  }

  const monoM = name.match(/^mono[-\s]?(.+)$/i);
  if (monoM) { name = monoM[1].trim(); modNames.push("Mono-edge"); }

  let systemEntry = findInRegistry(SYSTEM_WEAPONS, name);
  let categoryOverride = null;
  if (!systemEntry && /^power\s+/i.test(name) && atk.attackType === "melee") {
    const stripped = name.replace(/^power\s+/i, "");
    systemEntry = findInRegistry(SYSTEM_WEAPONS, stripped);
    categoryOverride = "power";
  }
  if (!systemEntry && /^power\s+/i.test(atk.name) && atk.attackType === "melee") {
    categoryOverride = "power";
  }

  // Resolve "w/ X" suffix against ammo first, then modifications
  const ammoEntry = ammoAlias ? findInRegistry(SYSTEM_AMMO, ammoAlias) : null;
  const ammoAsMod = (!ammoEntry && ammoAlias) ? findInRegistry(SYSTEM_MODIFICATIONS, ammoAlias) : null;
  if (ammoAsMod) modNames.push(ammoAlias); // treat as mod for display
  const modEntries = modNames.map(m => findInRegistry(SYSTEM_MODIFICATIONS, m)).filter(Boolean);

  return { rawName: atk.name, baseName: name, quantity, attackType: atk.attackType,
           systemEntry, categoryOverride, modNames, modEntries, hadWsuffix,
           ammoAlias: ammoEntry ? ammoAlias : null, ammoEntry };
}

// Returns { baseName, quantity, systemEntry, ammoEntry, protEntry, isAmmo }
function resolveEquipment(raw) {
  let name = raw.trim();
  let quantity = 1;

  const qtyM = name.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (qtyM) { quantity = parseInt(qtyM[1]); name = qtyM[2].trim(); }

  name = name.replace(/^(a|an|the)\s+/i, "");
  const aliasKey = name.toLowerCase().replace(/[‘’ʼ]/g, "'");
  if (EQUIPMENT_ALIASES[aliasKey]) name = EQUIPMENT_ALIASES[aliasKey];

  const ammoAlias = isAmmoClipName(name);
  if (ammoAlias) {
    return { rawName: raw, baseName: name, quantity, isAmmo: true,
             systemEntry: findInRegistry(SYSTEM_AMMO, ammoAlias), ammoEntry: null, protEntry: null };
  }

  const sysEquip = findInRegistry(SYSTEM_EQUIPMENT, name);
  const sysProt  = !sysEquip ? findInRegistry(SYSTEM_PROTECTION, name) : null;
  return { rawName: raw, baseName: name, quantity, isAmmo: false,
           systemEntry: sysEquip || sysProt, ammoEntry: null, protEntry: sysProt };
}

// Junk possession values that should not appear in the docs table
const JUNK_POSSESSION_RE = new RegExp(
  [
    "^[-–—\\s]+$",          // "-", "–", "—", or any combination of dashes/spaces
    "^none$",                          // literal "None" / "none"
    "^possession description$",        // template placeholder
    "^(they|may|replace|if\\s+the|if\\s+they|any\\s+equipment)\\b", // sentence openers
    "^some\\s+\\S+\\s+(may|can|will|are|have)\\b", // "Some [NPC-type] may/can..." rule notes
  ].join("|"),
  "i"
);

function isJunkPossession(raw) {
  return JUNK_POSSESSION_RE.test(raw.trim());
}

// ── Find leaf RTF directories ─────────────────────────────────────────────────
function hasRtf(dir) {
  try { return fs.readdirSync(dir).some(f => f.toLowerCase().endsWith(".rtf")); }
  catch { return false; }
}
function findLeafDirs(dir) {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (hasRtf(dir)) result.push(dir);
  for (const e of entries.filter(e => e.isDirectory()))
    result.push(...findLeafDirs(path.join(dir, e.name)));
  return result;
}

const leafDirs = findLeafDirs(BEASTIARY);
console.error(`Parsing ${leafDirs.length} directories...`);

// ── Parse all RTF files ───────────────────────────────────────────────────────
// weaponMap key = rawName; equipMap key = rawName; powerMap key = powerName
const weaponMap = new Map(); // rawName → { resolved, actors }
const equipMap  = new Map(); // rawName → { resolved, actors }
const powerMap  = new Map(); // powerName → { systemEntry, actors }

for (const dir of leafDirs) {
  const res = spawnSync("python", [PARSE_SCRIPT, dir], {
    cwd: PKG,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.status !== 0 || !res.stdout.trim()) continue;
  let actors;
  try { actors = JSON.parse(res.stdout); } catch { continue; }

  for (const actor of actors) {
    for (const atk of actor.attacks || []) {
      if (!weaponMap.has(atk.name)) weaponMap.set(atk.name, { resolved: resolveWeapon(atk), actors: new Set() });
      weaponMap.get(atk.name).actors.add(actor.name);
    }
    for (const raw of actor.possessions || []) {
      if (!raw.trim() || isJunkPossession(raw)) continue;
      if (!equipMap.has(raw)) equipMap.set(raw, { resolved: resolveEquipment(raw), actors: new Set() });
      equipMap.get(raw).actors.add(actor.name);
    }
    for (const powerName of actor.powers || []) {
      if (!powerMap.has(powerName)) powerMap.set(powerName, { systemEntry: findInRegistry(SYSTEM_POWERS, powerName), actors: new Set() });
      powerMap.get(powerName).actors.add(actor.name);
    }
  }
}

console.error(`Weapons: ${weaponMap.size}, Equipment: ${equipMap.size}, Powers: ${powerMap.size}`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function escMd(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}
function actorList(actors) {
  return [...actors].sort().join(", ");
}

// ── Categorise weapons ────────────────────────────────────────────────────────
// A weapon "matches" if it resolves to a system weapon, OR has mods/ammo derived from it.
const weapMatched  = []; // { rawName, resolved, actors } — resolves to system weapon
const weapModified = []; // { rawName, resolved, actors } — custom weapon + mods/ammo/Power
const weapCustom   = []; // { rawName, resolved, actors } — fully unrecognised

for (const [rawName, { resolved, actors }] of weaponMap) {
  const entry = { rawName, resolved, actors };
  const hasMods = resolved.modNames.length > 0 || resolved.ammoAlias || resolved.hadWsuffix;
  const powerCustom = resolved.categoryOverride && !resolved.systemEntry;
  if (hasMods || powerCustom) weapModified.push(entry);
  else if (resolved.systemEntry) weapMatched.push(entry);
  else weapCustom.push(entry);
}
weapMatched.sort((a, b) => a.rawName.localeCompare(b.rawName));
weapModified.sort((a, b) => a.rawName.localeCompare(b.rawName));
weapCustom.sort((a, b) => a.rawName.localeCompare(b.rawName));

// ── Categorise equipment ──────────────────────────────────────────────────────
const equipMatched  = [];
const equipCustom   = [];

for (const [rawName, { resolved, actors }] of equipMap) {
  if (resolved.systemEntry) equipMatched.push({ rawName, resolved, actors });
  else equipCustom.push({ rawName, resolved, actors });
}
equipMatched.sort((a, b) => a.rawName.localeCompare(b.rawName));
equipCustom.sort((a, b) => a.rawName.localeCompare(b.rawName));

// ── Categorise powers ─────────────────────────────────────────────────────────
const powerMatched  = [];
const powerUnmatched = [];
for (const [name, { systemEntry, actors }] of powerMap) {
  if (systemEntry) powerMatched.push({ name, systemEntry, actors });
  else powerUnmatched.push({ name, actors });
}
powerMatched.sort((a, b) => a.name.localeCompare(b.name));
powerUnmatched.sort((a, b) => a.name.localeCompare(b.name));

// ── Render ────────────────────────────────────────────────────────────────────
const lines = [];

lines.push("# Item Reference");
lines.push("");
lines.push("Generated automatically from all NPC stat block RTF files.");
lines.push(
  `**${weapMatched.length} system weapons**, **${weapModified.length} derived weapons** (base + mods/ammo/Power), ` +
  `**${weapCustom.length} fully custom weapons**. ` +
  `**${equipMatched.length} system equipment/protection matches**, **${equipCustom.length} custom possessions**. ` +
  `**${powerMatched.length} system powers**, **${powerUnmatched.length} unmatched**.`
);
lines.push("");

// ── Weapons ───────────────────────────────────────────────────────────────────
lines.push("## Weapons");
lines.push("");

lines.push("### System Weapon Matches");
lines.push("");
lines.push("These attack entries resolve directly to a system compendium weapon.");
lines.push("");
lines.push("| RTF Name | System Weapon | Pack | Type | Actors |");
lines.push("|---|---|---|---|---|");
for (const { rawName, resolved, actors } of weapMatched) {
  const { systemEntry, attackType, baseName, quantity, categoryOverride } = resolved;
  const sysName = systemEntry.name;
  let display = escMd(rawName);
  if (baseName !== rawName.trim()) display += ` *(base: ${escMd(baseName)})*`;
  if (baseName.toLowerCase() !== sysName.toLowerCase()) display += ` *(→ ${escMd(sysName)})*`;
  const tags = [];
  if (quantity > 1) tags.push(`×${quantity}`);
  if (categoryOverride) tags.push(`category: ${categoryOverride}`);
  if (tags.length) display += ` [${tags.join(", ")}]`;
  lines.push(`| ${display} | \`${escMd(systemEntry.packId)}\` | ${attackType} | ${actorList(actors)} |`);
}
lines.push("");

lines.push("### Derived Weapons");
lines.push("");
lines.push("These entries produce a base weapon (custom or system) plus modifications, ammo, or a Power category override.");
lines.push("");
lines.push("| RTF Name | Base Weapon | Mods / Ammo / Notes | Actors |");
lines.push("|---|---|---|---|");
for (const { rawName, resolved, actors } of weapModified) {
  const { baseName, modNames, ammoAlias, categoryOverride, quantity } = resolved;
  const baseWeapon = resolved.systemEntry
    ? `\`${resolved.systemEntry.packId}\` ${escMd(resolved.systemEntry.name)}`
    : `*custom* ${escMd(baseName)}`;
  const notes = [
    ...modNames.map(m => `mod: ${m}`),
    ammoAlias ? `ammo: ${ammoAlias}` : null,
    categoryOverride ? `category: ${categoryOverride}` : null,
    quantity > 1 ? `×${quantity}` : null,
  ].filter(Boolean).join(", ");
  lines.push(`| **${escMd(rawName)}** | ${baseWeapon} | ${notes} | ${actorList(actors)} |`);
}
lines.push("");

lines.push("### Custom Weapons");
lines.push("");
lines.push("These attack entries have no matching system compendium weapon and no derived interpretation.");
lines.push("");
lines.push("| Name | Type | Actors |");
lines.push("|---|---|---|");
for (const { rawName, resolved, actors } of weapCustom) {
  lines.push(`| **${escMd(rawName)}** | ${resolved.attackType} | ${actorList(actors)} |`);
}
lines.push("");

// ── Equipment ─────────────────────────────────────────────────────────────────
lines.push("## Equipment & Possessions");
lines.push("");

lines.push("### System Matches");
lines.push("");
lines.push("These possessions resolve to a system compendium item (equipment, protection, or ammo).");
lines.push("");
lines.push("| RTF Name | System Item | Type | Pack | Actors |");
lines.push("|---|---|---|---|---|");
for (const { rawName, resolved, actors } of equipMatched) {
  const { systemEntry, baseName, quantity } = resolved;
  const sysName = systemEntry.name;
  let display = escMd(rawName);
  if (baseName !== rawName.trim()) display += ` *(→ ${escMd(baseName)})*`;
  if (baseName.toLowerCase() !== sysName.toLowerCase()) display += ` *(→ ${escMd(sysName)})*`;
  if (quantity > 1) display += ` [×${quantity}]`;
  const itemType = resolved.protEntry ? "protection" : (resolved.isAmmo ? "ammo" : "equipment");
  lines.push(`| ${display} | \`${escMd(systemEntry.packId)}\` | ${itemType} | ${actorList(actors)} |`);
}
lines.push("");

lines.push("### Custom Possessions");
lines.push("");
lines.push("These possessions have no matching system compendium entry.");
lines.push("");
lines.push("| Name | Actors |");
lines.push("|---|---|");
for (const { rawName, resolved, actors } of equipCustom) {
  let display = escMd(rawName);
  if (resolved.baseName !== rawName.trim()) display += ` *(→ ${escMd(resolved.baseName)})*`;
  lines.push(`| **${display}** | ${actorList(actors)} |`);
}
lines.push("");

// ── Psychic Powers ────────────────────────────────────────────────────────────
lines.push("## Psychic Powers");
lines.push("");
lines.push(`${powerMatched.length} system matches, ${powerUnmatched.length} unmatched.`);
lines.push("");

lines.push("### System Power Matches");
lines.push("");
lines.push("These power names (extracted from TRAITS descriptions) resolve to system compendium powers.");
lines.push("");
lines.push("| RTF Name | System Power | Pack | Discipline | Rating | Actors |");
lines.push("|---|---|---|---|---|---|");
for (const { name, systemEntry, actors } of powerMatched) {
  const sysName    = systemEntry.name;
  const same       = name === sysName ? "" : ` *(→ ${escMd(sysName)})*`;
  const discipline = systemEntry.item?.system?.discipline || "";
  const rating     = systemEntry.item?.system?.rating ?? "";
  lines.push(`| ${escMd(name)}${same} | \`${escMd(systemEntry.packId)}\` | ${discipline} | ${rating} | ${actorList(actors)} |`);
}
lines.push("");

lines.push("### Unmatched Powers");
lines.push("");
lines.push("These power names were found in trait descriptions but have no matching system compendium entry.");
lines.push("");
lines.push("| Name | Actors |");
lines.push("|---|---|");
for (const { name, actors } of powerUnmatched) {
  lines.push(`| **${escMd(name)}** | ${actorList(actors)} |`);
}
lines.push("");

// ── Write ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join("\n"));
console.log(`Wrote ${OUT}`);
