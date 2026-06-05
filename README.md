# Imperium Maledictum Expanded

A content expansion module for the [Imperium Maledictum](https://foundryvtt.com/packages/impmal) game system on Foundry VTT.

## Contents

**41 NPC compendiums** covering all major factions from the *Maledictum Expanded Beastiary* homebrew:

Adeptus Administratum · Adeptus Arbites · Adeptus Astartes · Adeptus Astra Telepathica · Adeptus Mechanicus · Skitarii Legions · Adeptus Ministorum · Sororitas · Novitiates · Amaranthine Syndicate · Astra Militarum · Militarum Auxilia · Militarum Tempestus · Craftworld Asuryani · Drukhari · Fauna · Heretics · Corpse Grinder Cult · Infinite Empire · Canoptek Constructs · Destroyer Cult · Infractionists & Citizens · Citizens · Gangers · Hangers On & Brutes · Hired Guns · Inquisition · Legiones Daemonica · Khornate · Nurglite · Slaaneshi · Tzeentchian · Logos Historica Verita · Magistratum Imperialis · Navis Imperialis · Nobility Imperialis · Navigator Houses · Orks · Planetary Government · Star Children · T'au Empire

NPC actors include properly linked system items where names match official compendium entries:

-   **Weapons, armour, equipment** — system items with full descriptions, icons, and stats
-   **Talents** — linked to system talent entries with active effects
-   **Psychic powers** — linked to system power entries (discipline, rating, duration)
-   **Modifications & ammo** — Mono-edge, Silencer, Man-Stopper Bullets, etc.
-   **Protection** — Flak Vest, Mesh Vest, Carapace armour, etc.

Two custom NPC roles are also added: **Master** and **Overseer**.

## Requirements

-   Foundry VTT 14+
-   [Imperium Maledictum](https://foundryvtt.com/packages/impmal) system
-   [impmal-core](https://foundryvtt.com/packages/impmal-core) module (v3.3.0+)
-   [impmal-inquisition](https://foundryvtt.com/packages/impmal-inquisition) module (v3.3.0+)

## Development

### Prerequisites

```bash
npm install          # from monorepo root
```

### Build

```bash
npm run build        # watch mode — deploys to local Foundry modules dir
npm run release      # production build
```

Copy `foundry-path.example.js` to `foundry-path.js` and set your local Foundry modules path.

### Importing NPC compendiums from RTF source files

Rebuild all 41 packs from RTF sources (Foundry must be closed):

```bash
npm run import
```

To build a single pack manually:

```bash
python tools/parse-rtf.py <rtf-dir> | node tools/write-pack.mjs packs/<pack-name>
```

The parser reads all `.rtf` files in a directory and outputs a JSON actor array to stdout. Actor names are derived from filenames — the parenthetical role suffix is stripped, e.g. `Administratum Overseer (Troop).rtf` → `Administratum Overseer`.

`write-pack.mjs` writes to a Foundry LevelDB compendium directory. Existing entries with the same name are overwritten. System item registries in `tools/system-*.json` are used to embed system-matched items with their original IDs.

Regenerate system item registries (Foundry must be closed):

```bash
node tools/generate-item-registries.mjs   # from monorepo root
```

Regenerate reference docs:

```bash
node tools/generate-trait-docs.mjs        # docs/traits.md
node tools/generate-items-docs.mjs        # docs/items.md
```