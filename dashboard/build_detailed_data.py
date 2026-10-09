"""Gera o recorte estático do explorador a partir das tabelas oficiais validadas."""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def coordinate(value, minimum, maximum):
    try:
        parsed = float(value.replace(",", "."))
        return parsed if minimum <= parsed <= maximum else None
    except (ValueError, AttributeError):
        return None


def build():
    section_rows = read_csv(ROOT / "outputs/tables/up_votes_section_baixada_santista_2026.csv")
    zone_rows = read_csv(ROOT / "outputs/tables/up_votes_municipality_zone_baixada_santista_2026.csv")
    place_rows = read_csv(ROOT / "data/processed/polling_places_sections_baixada_santista_2026.csv")
    municipalities, places, sections, candidates = {}, {}, [], {}
    for row in place_rows:
        m, z, s, p = (row[k] for k in ("municipality_id", "electoral_zone", "electoral_section", "polling_place_id"))
        key = f"{m}:{z}:{p}"
        municipalities[m] = row["municipality"]
        places[key] = {
            "id": p, "municipality_id": m, "zone": z, "name": row["polling_place"],
            "address": row["address"], "neighborhood": row["neighborhood"],
            "latitude": coordinate(row["latitude"], -25, -23),
            "longitude": coordinate(row["longitude"], -48, -45),
        }
        sections.append([m, z, s, key])
    votes = []
    for row in section_rows:
        cid = row["candidate_id"]
        candidates[cid] = {"name": row["ballot_name"], "office": row["office"]}
        votes.append([cid, row["municipality_id"], row["electoral_zone"], row["electoral_section"], int(row["candidate_votes_section"])])
    zones = [[r["candidate_id"], r["municipality_id"], r["electoral_zone"], int(r["candidate_votes_zone"])] for r in zone_rows]
    for row in zone_rows:
        candidates[row["candidate_id"]] = {"name": row["ballot_name"], "office": row["office"]}
    section_totals, zone_totals = {}, {}
    for cid, m, z, s, v in votes:
        key = (cid, m, z)
        section_totals[key] = section_totals.get(key, 0) + v
    for cid, m, z, v in zones:
        key = (cid, m, z)
        if key in zone_totals:
            raise ValueError(f"Chave de zona duplicada: {key}")
        zone_totals[key] = v
    if any(section_totals.get(k, 0) != zone_totals.get(k, 0) for k in section_totals.keys() | zone_totals.keys()):
        raise ValueError("Divergência entre votos por seção e por zona")
    section_keys = {(m, z, s) for m, z, s, _ in sections}
    if len(section_keys) != len(sections) or any((m, z, s) not in section_keys for _, m, z, s, _ in votes):
        raise ValueError("Cadastro de seções duplicado ou seção de resultado sem local")
    data = {
        "year": 2026, "turn": 1, "municipalities": municipalities, "places": places,
        "sections": sections, "votes": votes, "zones": zones, "candidates": candidates,
        "sources": {
            "section": "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2026_SP.zip",
            "zone": "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2026.zip",
            "places": "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip",
        },
    }
    path = ROOT / "dashboard/dist/data/detailed-results.json"
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Explorador: {len(municipalities)} municípios, {len(places)} locais, {len(sections)} seções, {len(votes)} registros de votos.")
    print(f"Reconciliação exata: {sum(v[-1] for v in votes)} votos; JSON: {path.stat().st_size:,} bytes.")
    print(f"Locais com coordenadas válidas: {sum(p['latitude'] is not None and p['longitude'] is not None for p in places.values())} de {len(places)}.")


if __name__ == "__main__":
    build()
