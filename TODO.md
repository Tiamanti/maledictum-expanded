# maledictum-expanded TODO

## RTF source issues (require fixing the source RTF or adding special-case parsing)

- **Assassin (Infractionists)** — `"Pict Recorder 2x Clips of Manstoppers 1d10 Solars"` is three possessions merged into one (no comma in RTF source). These should be separate: `Pict Recorder`, `2x Clips of Manstoppers`, `1d10 Solars`.

- **Dissolute Noble** — `"Mesh -"` appears in possessions. Likely `Mesh Vest` + a stray dash artifact from the RTF. RTF source needs cleanup.

- **Chaos Spawn** — attack `"When the Chaos Spawn makes a Hideous Mutation attack, roll a d10..."` is a rule description captured as an attack name because the RTF uses a colon after the rule name before a long paragraph. Attack parser misidentifies this as a weapon attack.

## New matching opportunities

- **`Astral Telepathy` power (1 unmatched)** — exists in the beastiary for Astropath. Check whether the system has it under a different name (e.g. ImpMal inquisition pack). If not, it is genuinely custom.

- **`silencer` (lowercase) possession on Oathsworn Bodyguard** — currently ends up as a custom possession. The modifications registry has a `Silencer` entry. Consider checking possessions against `system-modifications.json` the same way equipment is checked against `system-protection.json`.

- **Additional protection/equipment aliases** — several "A set of X armour" entries in Custom Possessions could potentially resolve to system protection items if aliases were added. Requires reviewing each case to confirm the stat blocks intend the same item (risk of false positives for faction-specific armour).
