#!/usr/bin/env node
/**
 * Build all NPC compendiums from RTF source files and update module.json.
 *
 * Walks "40K IM Maledictum Expanded Brew/Maledictum Expanded Beastiary",
 * runs parse-rtf.py | write-pack.mjs for every directory that contains RTFs,
 * then rewrites module.json packs and packFolders to match.
 *
 * Usage: node tools/build-compendiums.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BEASTIARY = path.join(
  ROOT,
  "40K IM Maledictum Expanded Brew",
  "Maledictum Expanded Beastiary",
);
const PACKS_DIR = path.join(ROOT, "packs");
const MODULE_JSON_PATH = path.join(ROOT, "module.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hasRtf(dir) {
  try {
    return fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith(".rtf"));
  } catch {
    return false;
  }
}

function getSubdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function containsRtfsRecursive(dir) {
  if (hasRtf(dir)) return true;
  return getSubdirs(dir).some(containsRtfsRecursive);
}

// ── Directory walker ──────────────────────────────────────────────────────────

/**
 * Walk a directory tree.
 *
 * Returns:
 *   packDirs  — [{slug, name, dir}] for every dir with direct RTF files
 *   folderNode — null for leaf dirs; packFolder object for dirs with subdirs
 */
function processDir(dir) {
  const name = path.basename(dir);
  const slug = slugify(name);
  const hasOwn = hasRtf(dir);
  const activeSubs = getSubdirs(dir).filter(containsRtfsRecursive);

  const packDirs = hasOwn ? [{ slug, name, dir }] : [];

  if (activeSubs.length === 0) {
    return { packDirs, folderNode: null };
  }

  // Dir has subdirs — needs a folder node; collect packs and nested folders
  const folderPacks = hasOwn ? [slug] : [];
  const folderFolders = [];

  for (const sub of activeSubs) {
    const result = processDir(sub);
    packDirs.push(...result.packDirs);

    if (result.folderNode === null) {
      // Leaf subdir — its packs live directly in this folder
      folderPacks.push(...result.packDirs.map((p) => p.slug));
    } else {
      // Subdir itself has children — nest as a sub-folder
      folderFolders.push(result.folderNode);
    }
  }

  const folderNode = { name, sorting: "a", color: "", packs: folderPacks };
  if (folderFolders.length) folderNode.folders = folderFolders;

  return { packDirs, folderNode };
}

// ── Pack builder ──────────────────────────────────────────────────────────────

function buildPack(slug, name, dir) {
  const packDir = path.join(PACKS_DIR, slug);
  if (fs.existsSync(packDir)) fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });

  process.stdout.write(`  Building "${name}" → packs/${slug} ... `);

  const parse = spawnSync("python", ["tools/parse-rtf.py", dir], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (parse.status !== 0) {
    console.error(`FAILED (parse)\n${parse.stderr}`);
    return;
  }

  let actors;
  try {
    actors = JSON.parse(parse.stdout);
  } catch {
    console.error("FAILED (invalid JSON from parser)");
    return;
  }

  if (actors.length === 0) {
    console.log("skipped (no actors)");
    fs.rmSync(packDir, { recursive: true, force: true });
    return;
  }

  const write = spawnSync("node", ["tools/write-pack.mjs", packDir], {
    cwd: ROOT,
    input: parse.stdout,
    encoding: "utf-8",
  });

  if (write.status !== 0) {
    console.error(`FAILED (write)\n${write.stderr}`);
    return;
  }

  const summary = write.stdout.trim().split("\n").pop();
  console.log(summary);
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Ensure Python dependency is available
const pip = spawnSync("pip", ["install", "striprtf"], { encoding: "utf-8" });
if (pip.status !== 0) {
  console.error("Failed to install striprtf:", pip.stderr);
  process.exit(1);
}

const topLevelDirs = getSubdirs(BEASTIARY).filter(containsRtfsRecursive);

const rootPacks = [];
const rootFolders = [];
const allPackDirs = [];

for (const dir of topLevelDirs) {
  const { packDirs, folderNode } = processDir(dir);
  allPackDirs.push(...packDirs);

  if (folderNode === null) {
    rootPacks.push(...packDirs.map((p) => p.slug));
  } else {
    rootFolders.push(folderNode);
  }
}

console.log(`Found ${allPackDirs.length} compendiums to build.\n`);

for (const { slug, name, dir } of allPackDirs) {
  buildPack(slug, name, dir);
}

// Update module.json
const moduleJson = JSON.parse(fs.readFileSync(MODULE_JSON_PATH, "utf-8"));

moduleJson.packs = allPackDirs.map(({ slug, name }) => ({
  name: slug,
  label: name,
  path: `packs/${slug}`,
  type: "Actor",
  ownership: { PLAYER: "NONE", ASSISTANT: "OWNER" },
  system: "impmal",
  flags: {},
}));

const rootFolderNode = {
  name: "Maledictum Expanded",
  sorting: "m",
  color: "",
  packs: rootPacks,
};
if (rootFolders.length) rootFolderNode.folders = rootFolders;

moduleJson.packFolders = [rootFolderNode];

fs.writeFileSync(MODULE_JSON_PATH, JSON.stringify(moduleJson, null, 2) + "\n");

console.log(`\nUpdated module.json with ${allPackDirs.length} packs.`);
