"""Prepara tabelas comparativas estáticas a partir dos resultados oficiais."""

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def integer(value):
    try:
        return int(float(value or 0))
    except ValueError:
        return 0


def build():
    municipal = rows(ROOT / "dashboard/dist/data/municipal-results.csv")
    places = rows(ROOT / "data/processed/polling_places_sections_baixada_santista_2026.csv")
    sections = rows(ROOT / "outputs/tables/up_votes_section_baixada_santista_2026.csv")

    municipalities = {}
    candidates, votes, valid_votes = {}, defaultdict(dict), defaultdict(dict)
    for row in municipal:
        mid = row["municipality_id"]
        cid = row["candidate_id"]
        municipalities[mid] = row["municipality"]
        candidates[cid] = {"id": cid, "name": row["ballot_name_registered"], "office": row["office"]}
        votes[cid][mid] = integer(row["candidate_votes"])
        valid_votes[cid][mid] = integer(row["valid_votes"])

    electorate, neighborhood_electorate, seen_sections = defaultdict(int), defaultdict(int), set()
    neighborhoods = {}
    for row in places:
        mid, zone, section = row["municipality_id"], row["electoral_zone"], row["electoral_section"]
        key = (mid, zone, section)
        if key in seen_sections:
            continue
        seen_sections.add(key)
        registered = integer(row["registered_voters_section"])
        neighborhood = (row.get("neighborhood") or "").strip() or "Bairro não informado"
        electorate[mid] += registered
        neighborhood_electorate[(mid, neighborhood)] += registered
        neighborhoods[(mid, neighborhood)] = {"municipality_id": mid, "municipality": municipalities[mid], "neighborhood": neighborhood}

    neighborhood_votes = defaultdict(int)
    for row in sections:
        mid = row["municipality_id"]
        cid = row["candidate_id"]
        neighborhood = (row.get("neighborhood") or "").strip() or "Bairro não informado"
        neighborhood_votes[(cid, mid, neighborhood)] += integer(row["candidate_votes_section"])

    candidate_rows = []
    for candidate in sorted(candidates.values(), key=lambda item: (item["office"], item["name"])):
        candidate_rows.append({
            **candidate,
            "total_votes": sum(votes[candidate["id"]].values()),
            "votes": votes[candidate["id"]],
            "valid_votes": valid_votes[candidate["id"]],
        })

    neighborhood_rows = []
    for candidate in candidates.values():
        for (mid, neighborhood), place in neighborhoods.items():
            neighborhood_rows.append({
                "candidate_id": candidate["id"], "municipality_id": mid, "municipality": place["municipality"],
                "neighborhood": neighborhood, "votes": neighborhood_votes[(candidate["id"], mid, neighborhood)],
                "electorate": neighborhood_electorate[(mid, neighborhood)],
            })

    payload = {
        "municipalities": [{"id": mid, "name": name, "electorate": electorate[mid]} for mid, name in sorted(municipalities.items(), key=lambda item: item[1])],
        "candidates": candidate_rows,
        "neighborhoods": neighborhood_rows,
    }
    destination = ROOT / "dashboard/dist/data/comparative-tables.json"
    destination.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Tabelas comparativas: {len(candidate_rows)} candidaturas, {len(neighborhood_rows)} recortes de bairro.")


if __name__ == "__main__":
    build()
