/**
 * Generate docs/traits.md — a reference doc listing every unique trait found
 * across all NPC stat blocks.
 *
 * Run from packages/maledictum-expanded:
 *   node tools/generate-trait-docs.mjs
 */

import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PKG = path.resolve(__dirname, "..");
const BEASTIARY = path.join(PKG, "40K IM Maledictum Expanded Brew", "Maledictum Expanded Beastiary");
const PARSE_SCRIPT = path.join(PKG, "tools/parse-rtf.py");
const TALENT_REGISTRY_PATH = path.join(PKG, "tools/system-talents.json");
const OUT = path.join(PKG, "docs/traits.md");

// ── Load system talent registry ───────────────────────────────────────────────
let systemTalents = {};
try {
  systemTalents = JSON.parse(fs.readFileSync(TALENT_REGISTRY_PATH, "utf-8"));
} catch {
  console.warn("system-talents.json not found — no talent matching");
}

function findSystemTalent(traitName) {
  const lower = traitName.toLowerCase();
  if (systemTalents[lower]) return systemTalents[lower];
  const base = traitName.replace(/\s*\([^)]+\)\s*$/, "").trim().toLowerCase();
  if (base !== lower && systemTalents[base]) return systemTalents[base];
  return null;
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
// traitMap: name → { description, actors: Set<string> }
const traitMap = new Map();

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
    for (const trait of actor.traits || []) {
      if (!traitMap.has(trait.name)) {
        traitMap.set(trait.name, { description: trait.description || "", actors: new Set() });
      }
      traitMap.get(trait.name).actors.add(actor.name);
    }
  }
}

console.error(`Found ${traitMap.size} unique traits`);

// ── Split into matched / unmatched ────────────────────────────────────────────
const matched = [];   // { traitName, systemEntry, description, actors }
const unmatched = []; // { traitName, description, actors }

for (const [traitName, { description, actors }] of traitMap) {
  const systemEntry = findSystemTalent(traitName);
  const entry = { traitName, description, actors };
  if (systemEntry) matched.push({ ...entry, systemEntry });
  else unmatched.push(entry);
}

matched.sort((a, b) => a.traitName.localeCompare(b.traitName));
unmatched.sort((a, b) => a.traitName.localeCompare(b.traitName));

// ── Render Markdown ───────────────────────────────────────────────────────────
function escMd(s) {
  return s.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function actorList(actors) {
  return [...actors].sort().join(", ");
}

const lines = [];

lines.push("# Trait Reference");
lines.push("");
lines.push(`Generated automatically from all NPC stat block RTF files.`);
lines.push(`**${matched.length} system talent matches**, **${unmatched.length} custom traits**.`);
lines.push("");

// ── Section 1: System talent matches ─────────────────────────────────────────
lines.push("## System Talent Matches");
lines.push("");
lines.push("These traits resolve to a system compendium talent when building packs.");
lines.push("");
lines.push("| RTF Name | System Talent | Pack | Actors |");
lines.push("|---|---|---|---|");

for (const { traitName, systemEntry, actors } of matched) {
  const systemName = systemEntry.name;
  const same = traitName === systemName ? "" : ` *(→ ${escMd(systemName)})*`;
  lines.push(`| ${escMd(traitName)}${same} | \`${escMd(systemEntry.packId)}\` | ${actorList(actors)} |`);
}

lines.push("");

// ── Section 2: Custom traits ──────────────────────────────────────────────────
lines.push("## Custom Traits");
lines.push("");
lines.push("These traits are module-specific and have no matching system compendium entry.");
lines.push("");
lines.push("| Name | Description | Actors |");
lines.push("|---|---|---|");

for (const { traitName, description, actors } of unmatched) {
  lines.push(`| **${escMd(traitName)}** | ${escMd(description)} | ${actorList(actors)} |`);
}

lines.push("");

// ── Write output ──────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join("\n"));
console.log(`Wrote ${OUT}`);
