"""Ingestão filtrada dos resultados oficiais por zona e seção eleitoral."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pandas as pd

from src.config.regions import Region


def _read_chunks(zip_path: Path, csv_name: str, usecols: list[str]):
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open(csv_name) as stream:
            yield from pd.read_csv(
                stream,
                sep=";",
                encoding="cp1252",
                usecols=usecols,
                dtype=str,
                # ZIPs de resultados são muito grandes; manter lotes menores evita picos de memória.
                chunksize=50_000,
                low_memory=False,
            )


def _clean_key(frame: pd.DataFrame, column: str, width: int = 0) -> None:
    value = frame[column].fillna("").astype(str).str.strip()
    frame[column] = value.str.zfill(width) if width else value


def ingest_detailed_results(
    candidates: pd.DataFrame,
    places: pd.DataFrame,
    region: Region,
    municipality_zone_zip: Path,
    section_zip: Path,
    president_section_zip: Path,
    year: int,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    """Filtra arquivos nacionais/estaduais antes de materializar dados da região."""
    candidate_ids = set(candidates["candidate_id"].astype(str))
    municipality_ids = set(places["municipality_id"].astype(str).str.zfill(5))
    candidate_columns = [
        "SQ_CANDIDATO", "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "CD_CARGO",
        "DS_CARGO", "QT_VOTOS_NOMINAIS", "QT_VOTOS_NOMINAIS_VALIDOS",
    ]
    zone_pieces: list[pd.DataFrame] = []
    zone_name = f"votacao_candidato_munzona_{year}_{region.state}.csv"
    for chunk in _read_chunks(municipality_zone_zip, zone_name, candidate_columns):
        _clean_key(chunk, "SQ_CANDIDATO")
        _clean_key(chunk, "CD_MUNICIPIO", 5)
        keep = chunk["SQ_CANDIDATO"].isin(candidate_ids) & chunk["CD_MUNICIPIO"].isin(municipality_ids)
        if keep.any():
            zone_pieces.append(chunk.loc[keep].copy())
    if not zone_pieces:
        raise ValueError("Nenhum voto por município/zona da UP foi encontrado no arquivo oficial")
    zones = pd.concat(zone_pieces, ignore_index=True).rename(
        columns={
            "SQ_CANDIDATO": "candidate_id", "CD_MUNICIPIO": "municipality_id",
            "NM_MUNICIPIO": "municipality", "NR_ZONA": "electoral_zone",
            "CD_CARGO": "office_code", "DS_CARGO": "office",
            "QT_VOTOS_NOMINAIS": "candidate_votes_zone",
            "QT_VOTOS_NOMINAIS_VALIDOS": "candidate_valid_votes_zone",
        }
    )
    _clean_key(zones, "electoral_zone")
    for column in ("candidate_votes_zone", "candidate_valid_votes_zone"):
        zones[column] = pd.to_numeric(zones[column], errors="coerce").fillna(0).astype("int64")
    zones["year"] = year
    zones["state"] = region.state
    zones = zones.merge(
        candidates[["candidate_id", "candidate_number", "candidate_name", "ballot_name", "party"]],
        on="candidate_id", how="left", validate="many_to_one",
    )
    zones = zones.sort_values(["office", "candidate_id", "municipality_id", "electoral_zone"]).reset_index(drop=True)

    section_columns = [
        "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_CARGO", "DS_CARGO",
        "NR_VOTAVEL", "NM_VOTAVEL", "QT_VOTOS", "NR_LOCAL_VOTACAO", "SQ_CANDIDATO",
    ]
    section_pieces: list[pd.DataFrame] = []
    # O TSE separa a disputa presidencial em um arquivo nacional. Filtramos pelos
    # municípios da região antes de materializar os registros em memória.
    for zip_path, csv_name in (
        (section_zip, f"votacao_secao_{year}_{region.state}.csv"),
        (president_section_zip, f"votacao_secao_{year}_BR.csv"),
    ):
        for chunk in _read_chunks(zip_path, csv_name, section_columns):
            _clean_key(chunk, "SQ_CANDIDATO")
            _clean_key(chunk, "CD_MUNICIPIO", 5)
            keep = chunk["SQ_CANDIDATO"].isin(candidate_ids) & chunk["CD_MUNICIPIO"].isin(municipality_ids)
            if keep.any():
                section_pieces.append(chunk.loc[keep].copy())
    if not section_pieces:
        raise ValueError("Nenhum voto por seção da UP foi encontrado no arquivo oficial")
    sections = pd.concat(section_pieces, ignore_index=True).rename(
        columns={
            "SQ_CANDIDATO": "candidate_id", "CD_MUNICIPIO": "municipality_id",
            "NM_MUNICIPIO": "municipality", "NR_ZONA": "electoral_zone",
            "NR_SECAO": "electoral_section", "CD_CARGO": "office_code", "DS_CARGO": "office",
            "NR_VOTAVEL": "candidate_number_reported", "NM_VOTAVEL": "candidate_name_reported",
            "QT_VOTOS": "candidate_votes_section", "NR_LOCAL_VOTACAO": "polling_place_id_reported",
        }
    )
    for column in ("electoral_zone", "electoral_section", "polling_place_id_reported"):
        _clean_key(sections, column)
    sections["candidate_votes_section"] = pd.to_numeric(
        sections["candidate_votes_section"], errors="coerce"
    ).fillna(0).astype("int64")
    sections["year"] = year
    sections["state"] = region.state
    sections = sections.merge(
        candidates[["candidate_id", "candidate_number", "candidate_name", "ballot_name", "party"]],
        on="candidate_id", how="left", validate="many_to_one",
    )
    place_columns = [
        "year", "state", "municipality_id", "electoral_zone", "electoral_section", "polling_place_id",
        "polling_place", "address", "neighborhood", "latitude", "longitude", "registered_voters_section",
    ]
    places_join = places[place_columns].copy()
    # A fonte de locais é lida como texto, enquanto o resultado recebe o ano
    # como inteiro; padronizar as chaves antes da junção evita uma falha falsa.
    places_join["year"] = pd.to_numeric(places_join["year"], errors="coerce").astype("Int64")
    places_join["state"] = places_join["state"].astype(str).str.strip()
    for column in ("municipality_id", "electoral_zone", "electoral_section", "polling_place_id"):
        _clean_key(places_join, column, 5 if column == "municipality_id" else 0)
    section_key = ["year", "state", "municipality_id", "electoral_zone", "electoral_section"]
    sections = sections.merge(places_join, on=section_key, how="left", validate="many_to_one")
    sections = sections.sort_values(["office", "candidate_id", "municipality_id", "electoral_zone", "electoral_section"]).reset_index(drop=True)

    # A fonte município/zona não contém Presidente. Para esse cargo, a zona é
    # agregada diretamente do arquivo oficial de seção, sem misturar controles
    # de fontes distintas para os demais cargos.
    zone_candidate_ids = set(zones["candidate_id"])
    missing_zone_candidates = set(sections["candidate_id"]) - zone_candidate_ids
    if missing_zone_candidates:
        president_zones = (
            sections.loc[sections["candidate_id"].isin(missing_zone_candidates)]
            .groupby(
                ["candidate_id", "municipality_id", "municipality", "electoral_zone", "office_code", "office",
                 "candidate_number", "candidate_name", "ballot_name", "party", "year", "state"],
                as_index=False,
                dropna=False,
            )["candidate_votes_section"]
            .sum()
            .rename(columns={"candidate_votes_section": "candidate_votes_zone"})
        )
        president_zones["candidate_valid_votes_zone"] = 0
        zones = pd.concat([zones, president_zones[zones.columns]], ignore_index=True)
        zones = zones.sort_values(["office", "candidate_id", "municipality_id", "electoral_zone"]).reset_index(drop=True)

    reconciliation_keys = ["candidate_id", "municipality_id", "electoral_zone"]
    section_totals = sections.groupby(reconciliation_keys, as_index=False)["candidate_votes_section"].sum()
    checks = zones[reconciliation_keys + ["candidate_votes_zone"]].merge(
        section_totals, on=reconciliation_keys, how="outer", indicator=True
    )
    checks[["candidate_votes_zone", "candidate_votes_section"]] = checks[
        ["candidate_votes_zone", "candidate_votes_section"]
    ].fillna(0).astype("int64")
    checks["difference"] = checks["candidate_votes_section"] - checks["candidate_votes_zone"]
    quality = {
        "scope": {"year": year, "region": region.slug, "state": region.state},
        "zone_rows": int(len(zones)),
        "section_rows": int(len(sections)),
        "section_rows_without_polling_place_match": int(sections["polling_place_id"].isna().sum()),
        "zone_candidate_keys": int(len(checks)),
        "reconciliation_mismatched_keys": int((checks["difference"] != 0).sum()),
        "reconciliation_difference_abs": int(checks["difference"].abs().sum()),
        "sections_total_votes": int(sections["candidate_votes_section"].sum()),
        "zones_total_votes": int(zones["candidate_votes_zone"].sum()),
        "zone_rows_derived_from_presidential_sections": int(
            zones["candidate_id"].isin(missing_zone_candidates).sum()
        ),
    }
    return zones, sections, quality
