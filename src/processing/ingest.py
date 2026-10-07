"""Leitura de ZIPs CSV do TSE com filtro precoce e normalização mínima."""

from __future__ import annotations

import logging
import unicodedata
import zipfile
from pathlib import Path

import pandas as pd

from src.config.regions import Region

LOGGER = logging.getLogger(__name__)


def normalize_name(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    return " ".join(text.upper().split())


def _zip_csv(zip_path: Path, expected_basename: str) -> zipfile.ZipExtFile:
    archive = zipfile.ZipFile(zip_path)
    matches = [name for name in archive.namelist() if name.rsplit("/", 1)[-1] == expected_basename]
    if len(matches) != 1:
        archive.close()
        raise ValueError(f"CSV {expected_basename!r} não encontrado de forma única em {zip_path}")
    # O objeto ZipExtFile mantém o arquivo ZIP aberto; pandas o consome nesta chamada.
    return archive.open(matches[0])


def read_tse_csv(zip_path: Path, expected_basename: str, **kwargs: object) -> pd.DataFrame:
    """CSV TSE confirmado em CP1252 e delimitador ;. Fallback explícito a latin-1."""
    read_options = {"sep": ";", "encoding": "cp1252", "low_memory": False, **kwargs}
    try:
        with zipfile.ZipFile(zip_path) as archive:
            matches = [n for n in archive.namelist() if n.rsplit("/", 1)[-1] == expected_basename]
            if len(matches) != 1:
                raise ValueError(f"CSV {expected_basename!r} não encontrado de forma única em {zip_path}")
            with archive.open(matches[0]) as stream:
                return pd.read_csv(stream, **read_options)
    except UnicodeDecodeError:
        LOGGER.warning("CP1252 falhou em %s; tentando latin-1", expected_basename)
        read_options["encoding"] = "latin-1"
        with zipfile.ZipFile(zip_path) as archive:
            with archive.open(expected_basename) as stream:
                return pd.read_csv(stream, **read_options)


def ingest_candidates(zip_path: Path, year: int, party: str) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for unit in ("SP", "BR"):
        source = read_tse_csv(zip_path, f"consulta_cand_{year}_{unit}.csv", dtype=str)
        frames.append(source)
    candidates = pd.concat(frames, ignore_index=True)
    candidates = candidates[candidates["SG_PARTIDO"].eq(party.upper())].copy()
    target_cargos = {
        "PRESIDENTE",
        "GOVERNADOR",
        "SENADOR",
        "DEPUTADO FEDERAL",
        "DEPUTADO ESTADUAL",
    }
    candidates = candidates[candidates["DS_CARGO"].isin(target_cargos)].copy()
    candidates = candidates.rename(
        columns={
            "SQ_CANDIDATO": "candidate_id",
            "NR_CANDIDATO": "candidate_number",
            "NM_CANDIDATO": "candidate_name",
            "NM_URNA_CANDIDATO": "ballot_name",
            "DS_CARGO": "office",
            "SG_PARTIDO": "party",
            "NM_PARTIDO": "party_name",
            "DS_SITUACAO_CANDIDATURA": "candidacy_status",
            "DS_SIT_TOT_TURNO": "totalization_status",
            "SG_UF": "state",
            "SG_UE": "electoral_unit",
        }
    )
    columns = [
        "candidate_id", "candidate_number", "candidate_name", "ballot_name", "office",
        "party", "party_name", "candidacy_status", "totalization_status", "state", "electoral_unit",
    ]
    result = candidates[columns].drop_duplicates(subset=["candidate_id"]).sort_values(
        ["office", "candidate_number", "candidate_id"]
    )
    if result.empty:
        raise ValueError(f"Nenhuma candidatura do partido {party!r} encontrada em {year}")
    return result.reset_index(drop=True)


def ingest_polling_places(zip_path: Path, year: int, region: Region) -> pd.DataFrame:
    source_name = f"eleitorado_local_votacao_{year}_{region.state}.csv"
    fields = [
        "AA_ELEICAO", "SG_UF", "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO",
        "NR_SECAO_PRINCIPAL", "NR_LOCAL_VOTACAO", "NM_LOCAL_VOTACAO", "DS_ENDERECO", "NM_BAIRRO",
        "NR_CEP", "NR_LATITUDE", "NR_LONGITUDE", "QT_ELEITOR_SECAO",
        "QT_ELEITOR_ELEICAO_FEDERAL", "QT_ELEITOR_ELEICAO_ESTADUAL", "CD_SITU_SECAO",
        "DS_SITU_SECAO", "CD_SITU_LOCAL_VOTACAO", "DS_SITU_LOCAL_VOTACAO",
    ]
    wanted = {normalize_name(name) for name in region.municipalities}
    pieces: list[pd.DataFrame] = []
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open(source_name) as stream:
            for chunk in pd.read_csv(
                stream, sep=";", encoding="cp1252", usecols=fields, dtype=str, chunksize=100_000
            ):
                keep = chunk["NM_MUNICIPIO"].map(normalize_name).isin(wanted)
                if keep.any():
                    pieces.append(chunk.loc[keep].copy())
    if not pieces:
        raise ValueError("Nenhuma seção da região encontrada no arquivo de locais do TSE")
    places = pd.concat(pieces, ignore_index=True)
    places = places.rename(
        columns={
            "AA_ELEICAO": "year", "SG_UF": "state", "CD_MUNICIPIO": "municipality_id",
            "NM_MUNICIPIO": "municipality", "NR_ZONA": "electoral_zone", "NR_SECAO": "electoral_section",
            "NR_SECAO_PRINCIPAL": "primary_section", "NR_LOCAL_VOTACAO": "polling_place_id",
            "NM_LOCAL_VOTACAO": "polling_place", "DS_ENDERECO": "address", "NM_BAIRRO": "neighborhood",
            "NR_CEP": "postal_code", "NR_LATITUDE": "latitude", "NR_LONGITUDE": "longitude",
            "QT_ELEITOR_SECAO": "registered_voters_section",
            "QT_ELEITOR_ELEICAO_FEDERAL": "registered_voters_federal",
            "QT_ELEITOR_ELEICAO_ESTADUAL": "registered_voters_state",
            "CD_SITU_SECAO": "section_status_code", "DS_SITU_SECAO": "section_status",
            "CD_SITU_LOCAL_VOTACAO": "polling_place_status_code",
            "DS_SITU_LOCAL_VOTACAO": "polling_place_status",
        }
    )
    places["neighborhood_source"] = places["neighborhood"].notna().map(
        {True: "TSE_eleitorado_local_votacao", False: "missing"}
    )
    places["neighborhood_confidence"] = places["neighborhood"].notna().map(
        {True: "high", False: "none"}
    )
    section_key = ["year", "state", "municipality_id", "electoral_zone", "electoral_section"]
    if places.duplicated(section_key).any():
        raise ValueError("Chave de seção duplicada no cadastro de locais do TSE")
    found = {normalize_name(value) for value in places["municipality"].unique()}
    missing = sorted(wanted - found)
    if missing:
        raise ValueError(f"Municípios esperados ausentes no TSE: {', '.join(missing)}")
    return places

