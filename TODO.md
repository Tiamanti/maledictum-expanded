# maledictum-expanded TODO

## Docs generation bugs (`generate-items-docs.mjs`)

- **`Stub Pistol w/ Dumdums` in wrong section** — appears in "System Weapon Matches" but has a `w/` suffix so should be in "Derived Weapons" (base: Stub Pistol, ammo attempted: dum-dum bullets, no system match → custom ammo). The `hasMods` check needs to account for `ammoAlias` being set even when no system ammo is found.

- **`a Chirurgeon's Kit` in Custom** — after article strip it becomes "Chirurgeon's Kit", which should hit the `chirurgeon's kit` alias → `Chirurgeon's Kit (5 uses)` → system match. The docs generator appears to not apply the alias after article stripping (compare: `Chirurgeons Kit` on line 393 which does match). Check `parseEquipmentName` in `generate-items-docs.mjs` against `write-pack.mjs`.

## Custom possessions junk (docs filtering)

Items in the Custom Possessions table that should not appear there:

- **`-` entries (78 actors)** — actors with no possessions; the dash is literal RTF content. Filter in `generate-items-docs.mjs` (or upstream in the parser).
- **`None` entries (13 actors)** — same pattern, different RTF convention.
- **Leftover rule notes** that survive the parser fix — long-sentence instructions that couldn't be caught by the parenthetical-comma fix alone. Examples: `"Replace Pulse Rifle with..."`, `"If the Lychguard is armed with..."`, `"they do not benefit from..."`, `"May also be equipped..."`. Can be filtered by checking for known sentence-opener patterns (`^they `, `^may `, `^replace `, `^if the`, `^if they`, `^any equipment`, etc.) or by a character-length threshold.
- **`"Possession Description"` placeholder** — Bloodletter, Bondless Dealer, Ebon Geist. Template artefact, should be dropped.

## New matching opportunities

- **`Astral Telepathy` power (1 unmatched)** — exists in the beastiary for Astropath. Check whether the system has it under a different name (e.g. ImpMal inquisition pack). If not, it is genuinely custom.

- **`silencer` (lowercase) possession on Oathsworn Bodyguard** — currently ends up as a custom possession. The modifications registry has a `Silencer` entry. Consider checking possessions against `system-modifications.json` the same way equipment is checked against `system-protection.json`.

- **Additional protection/equipment aliases** — several "A set of X armour" entries in Custom Possessions could potentially resolve to system protection items if aliases were added. Requires reviewing each case to confirm the stat blocks intend the same item (risk of false positives for faction-specific armour).
