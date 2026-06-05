/**
 * Show item type breakdown per actor in a pack.
 *
 * Run from packages/maledictum-expanded:
 *   node tools/check-pack-types.mjs <pack-dir>
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { ClassicLevel } = require(path.resolve(__dirname, "../../../node_modules/classic-level"));

const PACK_DIR = process.argv[2];
if (!PACK_DIR) { console.error("Usage: node tools/check-pack-types.mjs <pack-dir>"); process.exit(1); }

const db = new ClassicLevel(PACK_DIR, { valueEncoding: "json" });
const actors = new Map();
const itemsByActor = new Map();

for await (const [k, v] of db.iterator()) {
  if (k.startsWith("!actors!") && !k.includes(".")) actors.set(v._id, v);
  if (k.startsWith("!actors.items!") && !k.includes(".effects!")) {
    const aid = k.split("!")[2].split(".")[0];
    if (!itemsByActor.has(aid)) itemsByActor.set(aid, []);
    itemsByActor.get(aid).push(v);
  }
}
await db.close();

for (const [aid, actor] of actors) {
  const items = itemsByActor.get(aid) || [];
  const byType = {};
  for (const it of items) byType[it.type] = (byType[it.type] || 0) + 1;
  console.log(`${actor.name}: ${JSON.stringify(byType)}`);
  for (const t of ["power", "weapon", "protection", "modification", "ammo"]) {
    for (const it of items.filter(i => i.type === t))
      console.log(`  ${t}: ${it.name}`);
  }
}
