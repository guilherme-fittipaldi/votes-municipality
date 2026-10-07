"""Importação municipal a partir dos JSONs oficiais do Portal Resultados."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from src.config.regions import Region
from src.download.results_portal import ELECTIONS, cache_payload, fetch_json, municipality_result_url


def _number(value: object) -> int:
    return int(str(value or "0").replace(".", ""))


def _candidate_rows(payload: dict, municipality: dict, office: str) -> list[dict]:
    valid_votes = _number(payload.get("v", {}).get("vv"))
    rows: list[dict] = []
    for coalition in payload.get("carg", [{}])[0].get("agr", []):
        for party in coalition.get("par", []):
            for candidate in party.get("cand", []):
                rows.append(
                    {
                        "municipality_id": str(municipality["municipality_id"]),
                        "municipality": municipality["municipality"],
                        "state": municipality["state"],
                        "office": office,
                        "candidate_id": str(candidate["sqcand"]),
                        "candidate_number": str(candidate["n"]),
                        "candidate_name_result": candidate["nm"],
                        "ballot_name_result": candidate["nmu"],
                        "party": party["sg"],
                        "candidate_votes": _number(candidate.get("vap")),
                        "valid_votes": valid_votes,
                        "total_votes": _number(payload.get("v", {}).get("tv")),
                        "blank_votes": _number(payload.get("v", {}).get("vb")),
                        "null_votes": _number(payload.get("v", {}).get("vn")),
                        "source_generated_at": f"{payload.get('dg', '')} {payload.get('hg', '')}".strip(),
                        "totalized_at": f"{payload.get('dt', '')} {payload.get('ht', '')}".strip(),
                    }
                )
    return rows


def ingest_municipality_results(
    candidates: pd.DataFrame, places: pd.DataFrame, region: Region, party: str, raw_dir: Path
) -> pd.DataFrame:
    municipalities = (
        places[["municipality_id", "municipality", "state"]]
        .drop_duplicates()
        .sort_values("municipality_id")
        .to_dict("records")
    )
    wanted_ids = set(candidates["candidate_id"].astype(str))
    collected: list[dict] = []
    for office in sorted(candidates["office"].unique()):
        election, office_code = ELECTIONS[office]
        for municipality in municipalities:
            municipality_id = str(municipality["municipality_id"])
            url = municipality_result_url(election, office_code, region.state, municipality_id)
            payload, raw = fetch_json(url)
            cache_payload(raw_dir, f"result_{election}_{office_code}_{municipality_id}.json", url, raw)
            collected.extend(_candidate_rows(payload, municipality, office))
    all_candidates = pd.DataFrame(collected)
    up = all_candidates[
        all_candidates["candidate_id"].isin(wanted_ids) & all_candidates["party"].eq(party.upper())
    ].copy()
    if up.empty:
        raise ValueError("Os JSONs oficiais não retornaram candidaturas UP esperadas")
    metadata = candidates.rename(
        columns={"candidate_name": "candidate_name_registered", "ballot_name": "ballot_name_registered"}
    )[["candidate_id", "office", "candidate_name_registered", "ballot_name_registered", "party_name"]]
    up = up.merge(metadata, on=["candidate_id", "office"], how="left", validate="many_to_one")
    up["percent_valid_votes"] = up["candidate_votes"] / up["valid_votes"] * 100
    candidate_total = up.groupby("candidate_id")["candidate_votes"].transform("sum")
    up["municipality_share_of_baixada_candidate_votes"] = up["candidate_votes"] / candidate_total * 100
    up["municipality_rank_absolute"] = up.groupby("candidate_id")["candidate_votes"].rank(
        method="dense", ascending=False
    ).astype(int)
    up["municipality_rank_proportional"] = up.groupby("candidate_id")["percent_valid_votes"].rank(
        method="dense", ascending=False
    ).astype(int)
    return up.sort_values(["office", "candidate_name_registered", "municipality"]).reset_index(drop=True)


def result_quality(
    results: pd.DataFrame, expected_municipalities: int, registered_candidates: pd.DataFrame
) -> dict:
    group = results.groupby("candidate_id")["municipality_id"].nunique()
    expected_ids = set(registered_candidates["candidate_id"].astype(str))
    returned_ids = set(results["candidate_id"].astype(str))
    missing = registered_candidates[
        registered_candidates["candidate_id"].astype(str).isin(expected_ids - returned_ids)
    ][["candidate_id", "candidate_name", "ballot_name", "office", "candidacy_status", "totalization_status"]]
    return {
        "level": "municipality",
        "candidates": int(results["candidate_id"].nunique()),
        "municipalities_per_candidate": group.to_dict(),
        "all_candidates_cover_region": bool((group == expected_municipalities).all()),
        "negative_votes": int((results["candidate_votes"] < 0).sum()),
        "invalid_percentages": int(
            ((results["percent_valid_votes"] < 0) | (results["percent_valid_votes"] > 100)).sum()
        ),
        "registered_candidates_absent_from_results": missing.to_dict("records"),
        "limitation": "Os JSONs públicos usados nesta etapa são municipais; não permitem ranking por zona, seção, local ou bairro.",
    }
