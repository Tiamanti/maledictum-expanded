#!/usr/bin/env python3
"""
Parse ImpMal RTF stat block files and output a JSON actor array to stdout.

Usage:
    python tools/parse-rtf.py <dir>       # all .rtf files in directory
    python tools/parse-rtf.py <file.rtf>  # single file

Pipe output to write-pack.mjs to import into a Foundry LevelDB compendium.
Requires: pip install striprtf
"""

import sys
import re
import json
from pathlib import Path
from striprtf.striprtf import rtf_to_text

# ── Skill → characteristic mapping ──────────────────────────────────────────
SKILL_CHAR = {
    "athletics": "str",
    "awareness": "per",
    "dexterity": "ag",
    "discipline": "wil",
    "fortitude": "tgh",
    "intuition": "per",
    "linguistics": "int",
    "logic": "int",
    "lore": "int",
    "medicae": "int",
    "melee": "ws",
    "navigation": "int",
    "piloting": "ag",
    "presence": "wil",
    "psychic": "wil",
    "ranged": "bs",
    "rapport": "fel",
    "reflexes": "ag",
    "stealth": "ag",
    "tech": "int",
}

CHAR_KEYS = ["ws", "bs", "str", "tgh", "ag", "int", "per", "wil", "fel"]
ALL_SKILLS = list(SKILL_CHAR.keys())


def strip_pipe(s):
    return s.rstrip("|").strip()


def trait_key(name):
    """'Rapid Fire' → 'rapidFire', 'Two-Handed' → 'twoHanded'"""
    name = re.sub(r"\s*\([^)]+\)", "", name).strip()
    words = re.split(r"[\s\-]+", name)
    return words[0].lower() + "".join(w.capitalize() for w in words[1:])


def parse_weapon_traits(traits_str):
    """'Loud, Rapid Fire (3), Two-Handed' → [{"key": ...}, ...]"""
    if not traits_str.strip():
        return []
    result = []
    for part in re.split(r",\s*(?=[A-Z])", traits_str.strip().rstrip(".")):
        part = part.strip()
        if part:
            result.append({"key": trait_key(part)})
    return result


def parse_attack(text):
    """Parse 'Name: AttackType (Spec), Rating, Damage. Traits.' → dict."""
    colon = text.index(":")
    name = text[:colon].strip()
    rest = text[colon + 1 :].strip()

    parts = rest.split(",")
    weapon = {"name": name, "attackType": "melee", "spec": "", "rating": 0,
              "damage_base": "", "damage_SL": False, "range": "", "traits": [],
              "description": ""}

    if not parts:
        return weapon

    # Part 0: "Melee (One-Handed)" or "Ranged (Long Gun)"
    type_part = parts[0].strip()
    m = re.match(r"(Melee|Ranged)\s*\(([^)]+)\)", type_part, re.I)
    if m:
        weapon["attackType"] = m.group(1).lower()
        weapon["spec"] = m.group(2).strip().lower().replace(" ", "_").replace("-", "")
    elif re.match(r"Melee", type_part, re.I):
        weapon["attackType"] = "melee"
    elif re.match(r"Ranged", type_part, re.I):
        weapon["attackType"] = "ranged"

    # Part 1: rating
    if len(parts) > 1:
        rating_str = parts[1].strip()
        if rating_str.isdigit():
            weapon["rating"] = int(rating_str)

    # Remaining: may contain damage, range, traits, description
    tail = ",".join(parts[2:]).strip() if len(parts) > 2 else ""

    # Range notation: [Range] or [Medium Range]
    range_m = re.search(r"\[([^\]]+)\]", tail)
    if range_m:
        weapon["range"] = range_m.group(1).strip()
        tail = tail[: range_m.start()] + tail[range_m.end() :]

    # Damage: "N + SL Damage" or "N Damage"
    dmg_m = re.search(r"(\d+)\s*\+\s*SL\s+Damage", tail, re.I)
    if dmg_m:
        weapon["damage_base"] = dmg_m.group(1)
        tail = tail[: dmg_m.start()] + tail[dmg_m.end() :]
    else:
        dmg_m = re.search(r"(\d+)\s+Damage", tail, re.I)
        if dmg_m:
            weapon["damage_base"] = dmg_m.group(1)
            tail = tail[: dmg_m.start()] + tail[dmg_m.end() :]

    # Anything before the first sentence that is not a trait list goes to description
    # Split on ". " to separate short trait-like tokens from long descriptions
    tail = tail.strip().strip(",").strip()

    # Split on ". " — first period-terminated segment(s) are traits, the rest is description
    segments = re.split(r"\.\s+", tail)
    trait_parts = []
    desc_parts = []
    for seg in segments:
        seg = seg.strip().rstrip(".")
        if not seg:
            continue
        # A segment is "trait-like" if it's short and has no lowercase-run > 3 words
        word_count = len(seg.split())
        if word_count <= 8 and not re.search(r"[a-z]{20,}", seg):
            trait_parts.append(seg)
        else:
            desc_parts.append(seg + ".")

    weapon["traits"] = parse_weapon_traits(", ".join(trait_parts))
    weapon["description"] = " ".join(desc_parts)

    return weapon


def parse_skills(skills_text, characteristics):
    """
    Parse the Skills line. Returns (skill_advances, specialisations).
    skill_advances: {skill_key: int}
    specialisations: [{"skill": str, "name": str, "advances": int}]
    """
    skill_advances = {k: 0 for k in ALL_SKILLS}
    raw_spec_totals = {}   # (skill_key, spec_name) -> total
    raw_base_totals = {}   # skill_key -> total

    for entry in re.split(r",\s*", skills_text.strip().rstrip(".")):
        entry = entry.strip()
        if not entry:
            continue
        # "SkillName (Spec) value" or "SkillName value"
        m = re.match(r"^(.+?)\s+\(([^)]+)\)\s+(\d+)$", entry)
        if m:
            sk = m.group(1).strip().lower()
            sp = m.group(2).strip()
            total = int(m.group(3))
            if sk in SKILL_CHAR:
                raw_spec_totals[(sk, sp)] = total
            continue
        m = re.match(r"^(.+?)\s+(\d+)$", entry)
        if m:
            sk = m.group(1).strip().lower()
            total = int(m.group(2))
            if sk in SKILL_CHAR:
                raw_base_totals[sk] = total

    # Compute base advances
    for sk, total in raw_base_totals.items():
        char_val = characteristics.get(SKILL_CHAR[sk], 0)
        skill_advances[sk] = max(0, (total - char_val) // 5)

    # Compute specialisation advances (accounting for base)
    specialisations = []
    for (sk, sp), total in raw_spec_totals.items():
        char_val = characteristics.get(SKILL_CHAR[sk], 0)
        base_adv = skill_advances.get(sk, 0)
        base_contribution = char_val + base_adv * 5
        spec_adv = max(0, (total - base_contribution) // 5)
        specialisations.append({"skill": sk, "name": sp, "advances": spec_adv})

    return skill_advances, specialisations


def name_from_filename(path):
    """'Administratum Overseer (Troop).rtf' → 'Administratum Overseer'"""
    return re.sub(r"\s*\([^)]+\)\s*$", "", path.stem).strip()


def parse_file(path):
    with open(path, "r", encoding="latin-1") as f:
        content = f.read()
    text = rtf_to_text(content)

    lines = [strip_pipe(l) for l in text.split("\n")]

    actor = {
        "name": "",
        "size": "medium",
        "species": "",
        "faction": "",
        "role": "troop",
        "characteristics": {k: 0 for k in CHAR_KEYS},
        "armour": 0,
        "wounds": 0,
        "criticals": 0,
        "initiative": 0,
        "speed": "normal",
        "resolve": 0,
        "skill_advances": {k: 0 for k in ALL_SKILLS},
        "specialisations": [],
        "traits": [],
        "attacks": [],
        "possessions": [],
    }

    i = 0
    # Find name: skip "Name" header token, take next non-empty line
    while i < len(lines):
        if lines[i] == "Name":
            i += 1
            while i < len(lines) and not lines[i]:
                i += 1
            if i < len(lines):
                actor["name"] = lines[i]
            i += 1
            break
        elif lines[i]:
            actor["name"] = lines[i]
            i += 1
            break
        i += 1

    section = None
    section_buf = []

    def flush_section():
        nonlocal section, section_buf
        if section == "traits":
            blocks = re.split(r"\n\n+", "\n".join(section_buf).strip())
            for block in blocks:
                block = block.strip()
                if not block:
                    continue
                m = re.match(r"^([^:]+):\s*(.+)", block, re.DOTALL)
                if m:
                    actor["traits"].append({
                        "name": m.group(1).strip(),
                        "description": m.group(2).strip(),
                    })
        elif section == "attacks":
            blocks = re.split(r"\n\n+", "\n".join(section_buf).strip())
            for block in blocks:
                block = block.strip()
                if not block or ":" not in block:
                    continue
                try:
                    actor["attacks"].append(parse_attack(block))
                except Exception as e:
                    print(f"  Warning: failed to parse attack '{block[:60]}': {e}", file=sys.stderr)
        section = None
        section_buf = []

    while i < len(lines):
        line = lines[i]
        i += 1

        # Size / species / faction / role
        m = re.match(
            r"(Small|Medium|Large|Enormous|Monstrous)\s+(\w+)\s*(?:\(([^)]+)\))?,\s*(\w+)",
            line, re.I,
        )
        if m:
            actor["size"] = m.group(1).lower()
            actor["species"] = m.group(2)
            actor["faction"] = m.group(3) or ""
            actor["role"] = m.group(4).lower()
            continue

        # Characteristics header row
        flat = line.replace(" ", "")
        if re.match(r"WS\|BS\|", flat, re.I):
            if i < len(lines):
                vals = lines[i].split("|")
                for k, v in zip(CHAR_KEYS, vals):
                    try:
                        actor["characteristics"][k] = int(v.strip())
                    except ValueError:
                        pass
                i += 1
            continue

        # Armour / Wounds / Criticals header
        if re.match(r"Armo[u]?r\|", flat, re.I):
            if i < len(lines):
                vals = lines[i].split("|")
                try:
                    actor["armour"] = int(vals[0].strip())
                except (ValueError, IndexError):
                    pass
                try:
                    actor["wounds"] = int(vals[1].strip())
                except (ValueError, IndexError):
                    pass
                try:
                    actor["criticals"] = int(vals[2].strip())
                except (ValueError, IndexError):
                    pass
                i += 1
            continue

        # Initiative / Speed / Resolve header
        if re.match(r"Initiative\|", flat, re.I):
            if i < len(lines):
                vals = lines[i].split("|")
                try:
                    actor["initiative"] = int(vals[0].strip())
                except (ValueError, IndexError):
                    pass
                try:
                    actor["speed"] = vals[1].strip().lower()
                except IndexError:
                    pass
                try:
                    actor["resolve"] = int(vals[2].strip())
                except (ValueError, IndexError):
                    pass
                i += 1
            continue

        # Skills line
        m = re.match(r"^Skills?:\s*(.+)", line, re.I)
        if m:
            skill_advances, specialisations = parse_skills(
                m.group(1), actor["characteristics"]
            )
            actor["skill_advances"] = skill_advances
            actor["specialisations"] = specialisations
            continue

        # Section: TRAITS
        if re.match(r"^TRAITS?$", line, re.I):
            flush_section()
            section = "traits"
            section_buf = []
            continue

        # Section: ATTACKS
        if re.match(r"^ATTACKS?$", line, re.I):
            flush_section()
            section = "attacks"
            section_buf = []
            continue

        # Possessions
        m = re.match(r"^Possessions?:\s*(.+)", line, re.I)
        if m:
            flush_section()
            poss_text = m.group(1).rstrip(".")
            actor["possessions"] = [p.strip() for p in poss_text.split(",")]
            continue

        if section is not None:
            section_buf.append(line)

    flush_section()
    actor["name"] = name_from_filename(path)
    return actor


def main():
    if len(sys.argv) < 2:
        print("Usage: parse-rtf.py <dir|file.rtf>", file=sys.stderr)
        sys.exit(1)

    target = Path(sys.argv[1])
    if target.is_dir():
        files = sorted(target.glob("*.rtf"))
    else:
        files = [target]

    actors = []
    for path in files:
        print(f"Parsing {path.name}...", file=sys.stderr)
        try:
            actors.append(parse_file(path))
        except Exception as e:
            print(f"  Error: {e}", file=sys.stderr)

    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(actors, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
