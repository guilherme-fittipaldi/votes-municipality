"""Relatórios de qualidade para impedir uso silencioso de dados incompletos."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from src.config.regions import Region
from src.processing.ingest import normalize_name


def pre_results_quality(
    candidates: pd.DataFrame, places: pd.DataFrame, region: Region, year: int, party: str
) -> dict[str, object]:
    expected = {normalize_name(name) for name in region.municipalities}
    found = {normalize_name(name) for name in places["municipality"].unique()}
    section_key = ["year", "state", "municipality_id", "electoral_zone", "electoral_section"]
    return {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "scope": {"year": year, "party": party, "region": region.slug, "state": region.state},
        "checks": {
            "all_nine_municipalities_found": expected == found,
            "expected_municipalities": sorted(expected),
            "found_municipalities": sorted(found),
            "candidates_found": int(len(candidates)),
            "candidates_by_office": candidates.groupby("office").size().sort_index().to_dict(),
            "sections": int(len(places)),
            "duplicate_section_keys": int(places.duplicated(section_key).sum()),
            "sections_without_polling_place": int(places["polling_place_id"].isna().sum()),
            "sections_without_neighborhood": int(places["neighborhood"].isna().sum()),
            "sections_without_coordinates": int(
                (places["latitude"].isna() | places["longitude"].isna()).sum()
            ),
        },
        "limitations": [
            "Este relatório não contém votos: resultados oficiais por seção ainda são necessários.",
            "Bairro é o informado pelo TSE para o endereço do local de votação.",
        ],
    }


def write_quality_report(report: dict[str, object], output_dir: Path, year: int) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"quality_pre_results_{year}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    checks = report["checks"]
    markdown = f"""# Qualidade dos dados pré-resultados — {year}

## Escopo

- Região: {report['scope']['region']}
- Partido: {report['scope']['party']}

## Verificações

- Nove municípios encontrados: {checks['all_nine_municipalities_found']}
- Candidaturas encontradas: {checks['candidates_found']}
- Seções encontradas: {checks['sections']}
- Chaves de seção duplicadas: {checks['duplicate_section_keys']}
- Seções sem local: {checks['sections_without_polling_place']}
- Seções sem bairro: {checks['sections_without_neighborhood']}
- Seções sem coordenadas: {checks['sections_without_coordinates']}

## Limitações

""" + "\n".join(f"- {item}" for item in report["limitations"]) + "\n"
    (output_dir / f"quality_pre_results_{year}.md").write_text(markdown, encoding="utf-8")

