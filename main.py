"""Ponto de entrada da análise eleitoral da UP."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from src.analysis.quality import pre_results_quality, write_quality_report
from src.config.regions import get_region
from src.download.tse import SourceUnavailableError, TSEClient
from src.processing.ingest import ingest_candidates, ingest_polling_places
from src.processing.municipality_results import ingest_municipality_results, result_quality
from src.processing.detailed_results import ingest_detailed_results


ROOT = Path(__file__).resolve().parent


def setup_logging() -> None:
    log_path = ROOT / "outputs" / "pipeline.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(log_path, encoding="utf-8")],
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Geografia eleitoral da UP")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--party", default="UP")
    parser.add_argument("--region", default="baixada_santista")
    parser.add_argument(
        "--stage", choices=("discover", "pre-results", "municipality-results", "detailed-results", "all"), default="all",
        help="'pre-results' processa somente fontes já disponíveis; votos serão incluídos em etapa posterior.",
    )
    return parser.parse_args()


def _write_table(frame, parquet_path: Path, csv_path: Path) -> None:
    frame.to_csv(csv_path, index=False, encoding="utf-8-sig")
    try:
        frame.to_parquet(parquet_path, index=False)
    except ImportError:
        logging.getLogger(__name__).warning(
            "Parquet não gerado porque pyarrow não está instalado; CSV foi preservado: %s", csv_path
        )


def write_tables(candidates, places, year: int, region_slug: str) -> None:
    destination = ROOT / "data" / "processed"
    destination.mkdir(parents=True, exist_ok=True)
    _write_table(candidates, destination / f"candidates_up_{year}.parquet", destination / f"candidates_up_{year}.csv")
    _write_table(
        places,
        destination / f"polling_places_sections_{region_slug}_{year}.parquet",
        destination / f"polling_places_sections_{region_slug}_{year}.csv",
    )


def write_municipality_results(
    results, candidates, year: int, region_slug: str, expected_municipalities: int
) -> None:
    destination = ROOT / "outputs" / "tables"
    destination.mkdir(parents=True, exist_ok=True)
    _write_table(
        results,
        destination / f"up_votes_municipality_{region_slug}_{year}.parquet",
        destination / f"up_votes_municipality_{region_slug}_{year}.csv",
    )
    quality = result_quality(results, expected_municipalities, candidates)
    (ROOT / "outputs" / f"quality_municipality_results_{year}.json").write_text(
        json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def write_detailed_results(zones, sections, quality, year: int, region_slug: str) -> None:
    destination = ROOT / "outputs" / "tables"
    destination.mkdir(parents=True, exist_ok=True)
    _write_table(
        zones,
        destination / f"up_votes_municipality_zone_{region_slug}_{year}.parquet",
        destination / f"up_votes_municipality_zone_{region_slug}_{year}.csv",
    )
    _write_table(
        sections,
        destination / f"up_votes_section_{region_slug}_{year}.parquet",
        destination / f"up_votes_section_{region_slug}_{year}.csv",
    )
    (ROOT / "outputs" / f"quality_detailed_results_{year}.json").write_text(
        json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> int:
    args = parse_args()
    setup_logging()
    region = get_region(args.region)
    client = TSEClient(ROOT / "data" / "raw")
    manifest = client.discover(args.year)
    if args.stage == "discover":
        print(f"Manifesto criado: data/raw/sources_{args.year}.json")
        return 0

    sources = manifest["sources"]
    candidates_zip = client.download("candidates", sources["candidates"])
    places_zip = client.download("polling_places", sources["polling_places"])
    candidates = ingest_candidates(candidates_zip, args.year, args.party)
    places = ingest_polling_places(places_zip, args.year, region)
    write_tables(candidates, places, args.year, region.slug)
    report = pre_results_quality(candidates, places, region, args.year, args.party)
    write_quality_report(report, ROOT / "outputs", args.year)
    print("Ingestão pré-resultados concluída. Tabelas em data/processed e qualidade em outputs/.")

    if args.stage in {"municipality-results", "all"}:
        results = ingest_municipality_results(
            candidates, places, region, args.party, ROOT / "data" / "raw" / "results_portal"
        )
        write_municipality_results(results, candidates, args.year, region.slug, len(region.municipalities))
        print("Resultados municipais oficiais importados em outputs/tables/.")

    if args.stage in {"detailed-results", "all"}:
        unavailable = [
            key for key in ("section_votes", "candidate_municipality_zone_votes")
            if sources[key]["state"] != "available"
        ]
        if unavailable:
            print(
                "Resultados oficiais ainda indisponíveis no TSE: " + ", ".join(unavailable) + ". "
                "A análise de votos não foi executada."
            )
            return 2
        municipality_zone_zip = client.download(
            "candidate_municipality_zone_votes", sources["candidate_municipality_zone_votes"]
        )
        section_zip = client.download("section_votes", sources["section_votes"])
        zones, sections, detailed_quality = ingest_detailed_results(
            candidates, places, region, municipality_zone_zip, section_zip, args.year
        )
        write_detailed_results(zones, sections, detailed_quality, args.year, region.slug)
        print("Resultados oficiais por zona e seção importados em outputs/tables/.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SourceUnavailableError as exc:
        logging.error("%s", exc)
        raise SystemExit(2)
