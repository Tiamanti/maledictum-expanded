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

System item registries (`tools/system-*.json`) are generated from your local Foundry install and are **not committed** to the repo. Generate them before the first import, and whenever the official ImpMal modules are updated (Foundry must be closed):

```bash
npm run registries
```

Rebuild all 41 packs from RTF sources (Foundry must be closed):

```bash
npm run import
```

To build a single pack manually:

```bash
python tools/parse-rtf.py <rtf-dir> | node tools/write-pack.mjs packs/<pack-name>
```

The parser reads all `.rtf` files in a directory and outputs a JSON actor array to stdout. Actor names are derived from filenames — the parenthetical role suffix is stripped, e.g. `Administratum Overseer (Troop).rtf` → `Administratum Overseer`.

`write-pack.mjs` writes to a Foundry LevelDB compendium directory. Existing entries with the same name are overwritten. System item registries are used to embed system-matched items with their original IDs.

Regenerate reference docs:

```bash
npm run docs        # both docs/traits.md and docs/items.md
npm run docs:traits # docs/traits.md only
npm run docs:items  # docs/items.md only
```