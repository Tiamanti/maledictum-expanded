#!/usr/bin/env node
/**
 * Read parsed actor JSON from stdin and write to a Foundry LevelDB compendium.
 *
 * Usage:
 *   python tools/parse-rtf.py <rtf-dir> | node tools/write-pack.mjs <pack-dir>
 *
 * The pack-dir must already exist (as an empty directory or existing LevelDB).
 * Existing entries with the same actor name are overwritten.
 *
 * Requires classic-level in the monorepo root node_modules.
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// classic-level lives in the monorepo root node_modules (3 levels up from tools/)
const classicLevelPath = path.resolve(__dirname, "../../../node_modules/classic-level");
const require = createRequire(import.meta.url);
const { ClassicLevel } = require(classicLevelPath);

const PACK_DIR = process.argv[2];
if (!PACK_DIR) {
  console.error("Usage: node write-pack.mjs <pack-dir>");
  process.exit(1);
}

// ── System item registries ────────────────────────────────────────────────────
// All keyed by lowercase item name → { name, packId, item, effectDocs[] }
// Regenerate with: node tools/generate-item-registries.mjs (monorepo root)

function loadRegistry(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, filename), "utf-8"));
  } catch {
    return {};
  }
}

const SYSTEM_TALENTS       = loadRegistry("system-talents.json");
const SYSTEM_WEAPONS       = loadRegistry("system-weapons.json");
const SYSTEM_EQUIPMENT     = loadRegistry("system-equipment.json");
const SYSTEM_POWERS        = loadRegistry("system-powers.json");
const SYSTEM_AMMO          = loadRegistry("system-ammo.json");
const SYSTEM_MODIFICATIONS = loadRegistry("system-modifications.json");
const SYSTEM_PROTECTION    = loadRegistry("system-protection.json");

// Normalise US → UK spelling so "Armor Bane" matches "armour bane", etc.
function normaliseSpelling(s) {
  return s
    .replace(/\barmor\b/gi, "armour")
    .replace(/\bcolor\b/gi, "colour")
    .replace(/\bgray\b/gi, "grey");
}

function findInRegistry(registry, name) {
  const lower = name.toLowerCase();
  if (registry[lower]) return registry[lower];
  // Strip trailing parenthetical: "Drilled (Kill Team)" → "Drilled"
  const base = name.replace(/\s*\([^)]+\)\s*$/, "").trim().toLowerCase();
  if (base !== lower && registry[base]) return registry[base];
  // Strip all spaces/hyphens: "Night Shroud" → "nightshroud"
  const nospace = lower.replace(/[\s\-]/g, "");
  const found = Object.keys(registry).find(k => k.replace(/[\s\-]/g, "") === nospace);
  if (found) return registry[found];
  // US → UK spelling: "Armor Bane" → "armour bane"
  const normalised = normaliseSpelling(lower);
  if (normalised !== lower && registry[normalised]) return registry[normalised];
  // Strip trailing plural 's': "Bolt Pistols" → "Bolt Pistol"
  if (lower.endsWith("s")) {
    const singular = lower.slice(0, -1);
    if (registry[singular]) return registry[singular];
    const singularNospace = singular.replace(/[\s\-]/g, "");
    const foundSingular = Object.keys(registry).find(k => k.replace(/[\s\-]/g, "") === singularNospace);
    if (foundSingular) return registry[foundSingular];
  }
  return null;
}

function findSystemTalent(name)        { return findInRegistry(SYSTEM_TALENTS, name); }
function findSystemWeapon(name)        { return findInRegistry(SYSTEM_WEAPONS, name); }
function findSystemEquipment(name)     { return findInRegistry(SYSTEM_EQUIPMENT, name); }
function findSystemPower(name)         { return findInRegistry(SYSTEM_POWERS, name); }
function findSystemAmmo(name)          { return findInRegistry(SYSTEM_AMMO, name); }
function findSystemModification(name)  { return findInRegistry(SYSTEM_MODIFICATIONS, name); }
function findSystemProtection(name)    { return findInRegistry(SYSTEM_PROTECTION, name); }

// ── Equipment name aliases ────────────────────────────────────────────────────
// Exact-name shortcuts that the registry fuzzy-matching can't infer.
const EQUIPMENT_ALIASES = {
  "auspex":             "auspex/scanner",
  "chirurgeon's kit":   "chirurgeon's kit (5 uses)",
  "chirurgeons kit":    "chirurgeon's kit (5 uses)",
  "chirurgeon kit":     "chirurgeon's kit (5 uses)",
};

// Ammo patterns found in equipment/possession lines.
// "Manstopper clips" / "Man-Stopper rounds" etc. → "Man-Stopper Bullets"
const AMMO_CLIP_PATTERNS = [
  { re: /manstopper|man.?stopper/i, alias: "man-stopper bullets" },
  { re: /dumdum|dum.?dum/i,          alias: "dum-dum bullets" },       // no system entry yet
  { re: /hot.?shot\s+(las\s+)?pack/i, alias: "hot-shot las pack" },
  { re: /inferno\s+shell/i,          alias: "inferno shells" },
  { re: /bleeder/i,                  alias: "bleeder rounds" },
  { re: /blessed/i,                  alias: "blessed rounds" },
  { re: /executioner/i,              alias: "executioner rounds" },
  { re: /tox/i,                      alias: "tox rounds" },
];

function isAmmoClipName(name) {
  const lower = name.toLowerCase();
  if (/\b(clips?|rounds?|bolts?|shells?|pack|cartridges?)\b/.test(lower)) {
    for (const { re, alias } of AMMO_CLIP_PATTERNS) {
      if (re.test(lower)) return alias;
    }
  }
  return null;
}

// ── Weapon name pre-processing ────────────────────────────────────────────────
// Returns { baseName, quantity, modNames[], ammoAlias|null }
function parseWeaponName(rawName) {
  let name = rawName.trim();
  let quantity = 1;
  const modNames = [];
  let ammoAlias = null;

  // "2x Bolt Pistols" / "2× Force Swords"
  const qtyM = name.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (qtyM) { quantity = parseInt(qtyM[1]); name = qtyM[2].trim(); }

  // "Autopistol w/ Manstopper" → weapon + ammo
  const ammoSuffix = name.match(/^(.+?)\s+w\/\s*(.+)$/i);
  if (ammoSuffix) {
    name = ammoSuffix[1].trim();
    // Normalise ammo suffix to a registry alias
    const ammoRaw = ammoSuffix[2].trim();
    for (const { re, alias } of AMMO_CLIP_PATTERNS) {
      if (re.test(ammoRaw)) { ammoAlias = alias; break; }
    }
    if (!ammoAlias) ammoAlias = ammoRaw; // try literal lookup
  }

  // "Silenced X" / "Suppressed X"
  if (/^(silenced|suppressed)\s+/i.test(name)) {
    name = name.replace(/^(silenced|suppressed)\s+/i, "");
    modNames.push("Silencer");
  }

  // "Mono-Knife" / "Mono-sword" / "Monosword"
  const monoM = name.match(/^mono[-\s]?(.+)$/i);
  if (monoM) { name = monoM[1].trim(); modNames.push("Mono-edge"); }

  return { baseName: name, quantity, modNames, ammoAlias };
}

// ── Equipment name pre-processing ────────────────────────────────────────────
// Returns { baseName, quantity }
function parseEquipmentName(rawName) {
  let name = rawName.trim();
  let quantity = 1;

  // "2x Krak Grenades" / "3x Frag Grenades"
  const qtyM = name.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (qtyM) { quantity = parseInt(qtyM[1]); name = qtyM[2].trim(); }

  // Strip leading articles: "a Backpack" → "Backpack"
  name = name.replace(/^(a|an|the)\s+/i, "");

  // Apply known aliases
  const aliasKey = name.toLowerCase();
  if (EQUIPMENT_ALIASES[aliasKey]) name = EQUIPMENT_ALIASES[aliasKey];

  return { baseName: name, quantity };
}

// ── ID generation ────────────────────────────────────────────────────────────
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function makeId(len = 16) {
  let id = "";
  for (let i = 0; i < len; i++) {
    id += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return id;
}

// ── Skill characteristic defaults ────────────────────────────────────────────
const SKILL_CHAR = {
  athletics: "str", awareness: "per", dexterity: "ag", discipline: "wil",
  fortitude: "tgh", intuition: "per", linguistics: "int", logic: "int",
  lore: "int", medicae: "int", melee: "ws", navigation: "int", piloting: "ag",
  presence: "wil", psychic: "wil", ranged: "bs", rapport: "fel",
  reflexes: "ag", stealth: "ag", tech: "int",
};

const ALL_SKILLS = Object.keys(SKILL_CHAR);

const STATS = {
  coreVersion: "14.363",
  systemId: "impmal",
  systemVersion: "4.0.0",
  createdTime: Date.now(),
  modifiedTime: Date.now(),
  lastModifiedBy: null,
  exportSource: null,
  compendiumSource: null,
  duplicateSource: null,
};

function baseOwnership() {
  return { default: 0 };
}

// ── Item builders ─────────────────────────────────────────────────────────────

function buildTrait(actorId, parsed) {
  const id = makeId();
  return {
    key: `!actors.items!${actorId}.${id}`,
    value: {
      type: "trait",
      name: parsed.name,
      _id: id,
      img: "modules/impmal-core/assets/icons/blank.webp",
      system: {
        notes: {
          player: `<p>${parsed.description}</p>`,
          gm: "",
        },
        attack: {
          enabled: false, type: "melee", characteristic: "",
          skill: { key: "", specialisation: "" },
          damage: { SL: false, base: "", characteristic: "", ignoreAP: false },
          range: "", traits: { list: [] }, self: false,
        },
        test: {
          enabled: false, target: "self", difficulty: "challenging",
          characteristic: "", skill: { key: "", specialisation: "" }, self: false,
        },
        roll: { enabled: false, formula: "", label: "" },
        category: "standard",
        vehicle: { maneuverable: 0 },
      },
      effects: [],
      folder: null,
      sort: 0,
      ownership: baseOwnership(),
      flags: {},
      _stats: { ...STATS },
    },
  };
}

// Build item + effect sub-docs from a registry entry (works for any item type).
// systemOverrides: optional partial system-field overrides, e.g. { quantity: 2, category: "power" }
function buildItemFromSystem(actorId, registryEntry, systemOverrides = {}) {
  const src = registryEntry.item;
  const itemId = src._id;

  const itemEntry = {
    key: `!actors.items!${actorId}.${itemId}`,
    value: {
      ...src,
      _id: itemId,
      ownership: baseOwnership(),
      folder: null,
      sort: 0,
      _stats: { ...STATS },
      system: Object.keys(systemOverrides).length
        ? { ...src.system, ...systemOverrides }
        : src.system,
    },
  };

  const effectEntries = (registryEntry.effectDocs || []).map((eff) => ({
    key: `!actors.items.effects!${actorId}.${itemId}.${eff._id}`,
    value: { ...eff, _stats: { ...STATS } },
  }));

  return [itemEntry, ...effectEntries];
}

// Keep the old name as an alias used further below
function buildTalentFromSystem(actorId, registryEntry) {
  return buildItemFromSystem(actorId, registryEntry);
}

function buildSpecialisation(actorId, parsed) {
  const id = makeId();
  return {
    key: `!actors.items!${actorId}.${id}`,
    value: {
      type: "specialisation",
      name: parsed.name,
      _id: id,
      img: "modules/impmal-core/assets/icons/generic.webp",
      system: {
        notes: { player: "", gm: "" },
        advances: parsed.advances,
        restricted: false,
        skill: parsed.skill,
      },
      effects: [],
      sort: 0,
      ownership: baseOwnership(),
      flags: {},
      _stats: { ...STATS },
    },
  };
}

function buildWeapon(actorId, parsed) {
  const id = makeId();
  const isRanged = parsed.attackType === "ranged";
  return {
    key: `!actors.items!${actorId}.${id}`,
    value: {
      type: "weapon",
      name: parsed.name,
      _id: id,
      img: isRanged
        ? "modules/impmal-core/assets/icons/weapons/ranged-weapon.webp"
        : "modules/impmal-core/assets/icons/weapons/melee-weapon.webp",
      system: {
        notes: { player: parsed.description ? `<p>${parsed.description}</p>` : "", gm: "" },
        encumbrance: { value: 0 },
        cost: 0,
        availability: "",
        quantity: 1,
        equipped: { value: true, hand: "", force: false },
        damage: {
          base: parsed.damage_base || "",
          characteristic: "",
          SL: parsed.damage_SL ?? false,
          ignoreAP: false,
        },
        traits: { list: parsed.traits || [] },
        ammoCost: 0,
        attackType: parsed.attackType,
        category: "",
        spec: parsed.spec || "",
        range: parsed.range || "",
        rangeModifier: { value: 0, override: "" },
        mag: { value: 1, current: 0 },
        ammo: { id: "" },
        mods: { list: [] },
        slots: { list: [], value: 0 },
      },
      effects: [],
      folder: null,
      sort: 0,
      ownership: baseOwnership(),
      flags: {},
      _stats: { ...STATS },
    },
  };
}

function buildEquipment(actorId, name) {
  const id = makeId();
  return {
    key: `!actors.items!${actorId}.${id}`,
    value: {
      type: "equipment",
      name: name.trim(),
      _id: id,
      img: "modules/impmal-core/assets/icons/equipment/equipment.webp",
      system: {
        notes: { player: "", gm: "" },
        equipped: { value: false, hand: "", force: false },
        encumbrance: { value: 0 },
        cost: 0,
        availability: "",
        quantity: 1,
        uses: { value: null, max: null, enabled: false },
        test: {
          difficulty: "challenging", characteristic: "",
          skill: { key: "", specialisation: "" }, self: false,
        },
        traits: { list: [] },
        slots: { list: [], value: 0 },
      },
      effects: [],
      folder: null,
      sort: 0,
      ownership: baseOwnership(),
      flags: {},
      _stats: { ...STATS },
    },
  };
}

// ── Actor builder ─────────────────────────────────────────────────────────────

function buildActor(parsed) {
  const actorId = makeId();
  // itemEntries go into actor.items[]; subEntries are sub-documents (effects, etc.)
  const itemEntries = [];
  const subEntries = [];

  // Specialisations
  for (const spec of parsed.specialisations || []) {
    itemEntries.push(buildSpecialisation(actorId, spec));
  }

  // seenItemIds: prevents two items with the same system _id in one actor
  const seenItemIds = new Set();

  function addFromSystem(registryEntry, systemOverrides = {}) {
    if (!registryEntry || seenItemIds.has(registryEntry.item._id)) return false;
    seenItemIds.add(registryEntry.item._id);
    const [entry, ...effects] = buildItemFromSystem(actorId, registryEntry, systemOverrides);
    itemEntries.push(entry);
    subEntries.push(...effects);
    return true;
  }

  // Traits — use system talent when name matches, otherwise keep as custom trait
  for (const trait of parsed.traits || []) {
    const systemTalent = findSystemTalent(trait.name);
    if (!addFromSystem(systemTalent)) itemEntries.push(buildTrait(actorId, trait));
  }

  // Attacks (weapons) — parse name, match system, apply quantity/category/mod overrides
  for (const atk of parsed.attacks || []) {
    const { baseName, quantity, modNames, ammoAlias } = parseWeaponName(atk.name);
    const qty = quantity > 1 ? { quantity } : {};

    // Resolve weapon: exact, then with "Power" prefix stripped (melee only)
    let systemWeapon = findSystemWeapon(baseName);
    let categoryOverride = null;
    if (!systemWeapon && /^power\s+/i.test(baseName) && atk.attackType === "melee") {
      const stripped = baseName.replace(/^power\s+/i, "");
      systemWeapon = findSystemWeapon(stripped);
      categoryOverride = "power";
    }
    if (!systemWeapon && /^power\s+/i.test(atk.name) && atk.attackType === "melee") {
      categoryOverride = "power";
    }

    if (systemWeapon) {
      const overrides = { ...qty, ...(categoryOverride ? { category: categoryOverride } : {}) };
      addFromSystem(systemWeapon, overrides);
    } else {
      const entry = buildWeapon(actorId, { ...atk, name: baseName });
      if (quantity > 1) entry.value.system.quantity = quantity;
      if (categoryOverride) entry.value.system.category = categoryOverride;
      itemEntries.push(entry);
    }

    // Modifications (Mono-edge, Silencer, …)
    for (const modName of modNames) addFromSystem(findSystemModification(modName));

    // Ammo from "w/ X" suffix
    if (ammoAlias) addFromSystem(findSystemAmmo(ammoAlias) || findSystemModification(ammoAlias));
  }

  // Possessions — parse quantity/articles, match ammo/equipment/protection
  for (const raw of parsed.possessions || []) {
    if (!raw.trim()) continue;
    const { baseName, quantity } = parseEquipmentName(raw);
    if (!baseName) continue;
    const qty = quantity > 1 ? { quantity } : {};

    // Check for ammo-clip patterns first ("Manstopper clips")
    const ammoAlias = isAmmoClipName(baseName);
    if (ammoAlias) {
      const sysAmmo = findSystemAmmo(ammoAlias);
      if (!addFromSystem(sysAmmo, qty)) {
        // no system match — add as generic equipment
        const entry = buildEquipment(actorId, baseName);
        if (quantity > 1) entry.value.system.quantity = quantity;
        itemEntries.push(entry);
      }
      continue;
    }

    // Try equipment, then protection
    const sysEquip = findSystemEquipment(baseName);
    const sysProt  = !sysEquip ? findSystemProtection(baseName) : null;
    const match    = sysEquip || sysProt;

    if (!addFromSystem(match, qty)) {
      const entry = buildEquipment(actorId, baseName);
      if (quantity > 1) entry.value.system.quantity = quantity;
      itemEntries.push(entry);
    }
  }

  // Psychic powers — extracted by parser from trait descriptions
  for (const powerName of parsed.powers || []) {
    addFromSystem(findSystemPower(powerName));
  }

  // Build skills section
  const skills = {};
  for (const sk of ALL_SKILLS) {
    skills[sk] = {
      characteristic: SKILL_CHAR[sk],
      advances: (parsed.skill_advances || {})[sk] ?? 0,
      modifier: 0,
    };
  }

  const characteristics = {};
  for (const [k, v] of Object.entries(parsed.characteristics || {})) {
    characteristics[k] = { starting: v, advances: 0, modifier: 0 };
  }

  const actorDoc = {
    name: parsed.name,
    type: "npc",
    _id: actorId,
    img: "modules/impmal-core/assets/tokens/unknown.webp",
    system: {
      characteristics,
      skills,
      notes: { player: "", gm: "" },
      combat: {
        size: parsed.size || "medium",
        armourModifier: 0,
        speed: {
          land: { value: parsed.speed || "normal", modifier: 0 },
          fly: { value: "none", modifier: 0 },
        },
        wounds: { max: parsed.wounds || 0, value: 0 },
        criticals: { max: 0, value: 0 },
        hitLocations: {
          head:     { range: [1, 1], label: "IMPMAL.Head",     abbrev: "IMPMAL.HeadAbbrev" },
          leftArm:  { range: [2, 2], label: "IMPMAL.LeftArm",  abbrev: "IMPMAL.LeftArmAbbrev" },
          rightArm: { range: [3, 3], label: "IMPMAL.RightArm", abbrev: "IMPMAL.RightArmAbbrev" },
          leftLeg:  { range: [4, 4], label: "IMPMAL.LeftLeg",  abbrev: "IMPMAL.LeftLegAbbrev" },
          rightLeg: { range: [5, 5], label: "IMPMAL.RightLeg", abbrev: "IMPMAL.RightLegAbbrev" },
          body:     { range: [6, 10], label: "IMPMAL.Body",    abbrev: "IMPMAL.BodyAbbrev" },
        },
        resolve: parsed.resolve || 0,
        armour: { formula: parsed.armour_formula || "", value: parsed.armour || 0, useItems: false },
      },
      faction: { id: "", name: parsed.faction || "" },
      species: parsed.species || "",
      role: parsed.role || "troop",
      warp: { charge: 0, state: 0, sustaining: { list: [] } },
      autoCalc: { wounds: false, criticals: true, initiative: true },
    },
    prototypeToken: {
      name: parsed.name,
      displayName: 30,
      actorLink: false,
      width: 1, height: 1, depth: 1,
      texture: {
        src: "modules/impmal-core/assets/tokens/unknown.webp",
        anchorX: 0.5, anchorY: 0.5, fit: "contain",
        scaleX: 1, scaleY: 1, tint: "#ffffff", alphaThreshold: 0.75,
      },
      lockRotation: false, rotation: 0, alpha: 1, disposition: -1,
      displayBars: 20,
      bar1: { attribute: null }, bar2: { attribute: null },
      light: {
        negative: false, priority: 0, alpha: 0.5, angle: 360,
        bright: 0, color: null, coloration: 1, dim: 0, attenuation: 0.5,
        luminosity: 0.5, saturation: 0, contrast: 0, shadows: 0,
        animation: { type: null, speed: 5, intensity: 5, reverse: false },
        darkness: { min: 0, max: 1 },
      },
      sight: {
        enabled: false, range: 0, angle: 360, visionMode: "basic",
        color: null, attenuation: 0.1, brightness: 0, saturation: 0, contrast: 0,
      },
      detectionModes: {},
      occludable: { radius: 0 },
      ring: {
        enabled: false,
        colors: { ring: null, background: null },
        effects: 1,
        subject: { scale: 1, texture: null },
      },
      turnMarker: { mode: 1, animation: null, src: null, disposition: false },
      movementAction: null,
      flags: {}, randomImg: false, appendNumber: false, prependAdjective: false,
    },
    items: itemEntries.map((it) => it.value._id),
    effects: [],
    folder: null,
    ownership: baseOwnership(),
    flags: {},
    _stats: { ...STATS },
    sort: 0,
  };

  return [
    { key: `!actors!${actorId}`, value: actorDoc },
    ...itemEntries,
    ...subEntries,
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Read all stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8");
  const actors = JSON.parse(raw);

  const db = new ClassicLevel(PACK_DIR, { valueEncoding: "json" });

  // Load existing entries to check for name collisions
  const existing = new Map(); // name -> actorId
  for await (const [k, v] of db.iterator()) {
    if (k.startsWith("!actors!") && !k.includes(".")) {
      existing.set(v.name, v._id);
    }
  }

  let added = 0;
  let updated = 0;

  for (const parsed of actors) {
    if (existing.has(parsed.name)) {
      // Delete old entries for this actor
      const oldId = existing.get(parsed.name);
      const batch = db.batch();
      batch.del(`!actors!${oldId}`);
      for await (const [k] of db.iterator({ gte: `!actors.items!${oldId}`, lte: `!actors.items!${oldId}~` })) {
        batch.del(k);
      }
      for await (const [k] of db.iterator({ gte: `!actors.items.effects!${oldId}`, lte: `!actors.items.effects!${oldId}~` })) {
        batch.del(k);
      }
      await batch.write();
      updated++;
    } else {
      added++;
    }

    const entries = buildActor(parsed);
    const batch = db.batch();
    for (const { key, value } of entries) {
      batch.put(key, value);
    }
    await batch.write();
    console.log(`  ${existing.has(parsed.name) ? "Updated" : "Added"}: ${parsed.name}`);
  }

  await db.close();
  console.log(`Done. Added: ${added}, Updated: ${updated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
