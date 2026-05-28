# Imperium Maledictum Expanded

A content expansion module for the [Imperium Maledictum](https://foundryvtt.com/packages/impmal) game system on Foundry VTT.

## Contents

- **Adeptus Administratum** — NPC compendium with troops, elites, and leaders from the Administratum and Adeptus Arbites factions

## Requirements

- Foundry VTT 14+
- [Imperium Maledictum](https://foundryvtt.com/packages/impmal) system

## Development

### Prerequisites

```
npm install          # from monorepo root
```

### Build

```bash
npm run build        # watch mode
npm run release      # production build
```

Copy `foundry-path.example.js` to `foundry-path.js` and set your local Foundry modules path.

### Importing NPC compendiums from RTF source files

```bash
python tools/parse-rtf.py <rtf-dir> | node tools/write-pack.mjs packs/<pack-name>
```

The parser accepts a directory of `.rtf` stat block files and outputs a JSON array to stdout. Actor names are derived from filenames — the parenthetical role suffix is stripped, e.g. `Administratum Overseer (Troop).rtf` → `Administratum Overseer`.

`write-pack.mjs` writes to a Foundry LevelDB compendium directory. Existing entries with the same name are overwritten.