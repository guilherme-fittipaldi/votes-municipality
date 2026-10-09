"""Cliente pequeno e rastreável para o Portal de Dados Abertos do TSE (CKAN)."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

LOGGER = logging.getLogger(__name__)
CKAN_API = "https://dadosabertos.tse.jus.br/api/3/action/package_show"


class SourceUnavailableError(RuntimeError):
    """A fonte esperada não foi publicada pelo TSE."""


@dataclass(frozen=True)
class ResourceSpec:
    key: str
    package: str
    resource_name: str
    description: str
    required: bool


def source_specs(year: int) -> tuple[ResourceSpec, ...]:
    """Fontes por finalidade; recursos são resolvidos no CKAN, não por URL presumida."""
    return (
        ResourceSpec(
            "candidates",
            f"candidatos-{year}",
            "Candidatos",
            "Cadastro oficial de candidaturas.",
            True,
        ),
        ResourceSpec(
            "polling_places",
            f"eleitorado-{year}",
            f"Eleitorado por local de votação - {year}",
            "Seções, locais, endereços, bairros, coordenadas e eleitorado.",
            True,
        ),
        ResourceSpec(
            "section_votes",
            f"resultados-{year}",
            f"SP - Votação por seção eleitoral - {year}",
            "Votos por candidatura e seção; ainda não publicado para 2026 na discovery.",
            True,
        ),
        ResourceSpec(
            "president_section_votes",
            f"resultados-{year}",
            f"Presidente - Votação por seção eleitoral - {year}",
            "Votação presidencial por seção, publicada pelo TSE em arquivo nacional separado.",
            True,
        ),
        ResourceSpec(
            "candidate_municipality_zone_votes",
            f"resultados-{year}",
            "Votação nominal por município e zona",
            "Controle de totalização para reconciliar agregações de seção.",
            True,
        ),
        ResourceSpec(
            "ballot_box_bulletins",
            f"resultados-{year}-boletim-de-urna",
            "SP - Boletim de Urna",
            "Auditoria opcional por urna; pode receber nome diferente no CKAN.",
            False,
        ),
    )


class TSEClient:
    def __init__(self, raw_dir: Path, timeout_seconds: int = 90) -> None:
        self.raw_dir = raw_dir
        self.timeout_seconds = timeout_seconds

    def _request(self, url: str) -> Request:
        return Request(url, headers={"User-Agent": "up-eleitoral-pipeline/0.1"})

    def package(self, package_id: str) -> dict[str, Any] | None:
        # O CDN do portal pode servir uma resposta CKAN antiga por alguns minutos.
        # Um parâmetro semântico neutro evita reutilizar esse cache na discovery.
        url = f"{CKAN_API}?{urlencode({'id': package_id, 'cache_bust': datetime.now(UTC).timestamp()})}"
        try:
            with urlopen(self._request(url), timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code == 404:
                return None
            raise
        if not payload.get("success"):
            raise RuntimeError(f"CKAN respondeu sem sucesso para {package_id}")
        return payload["result"]

    def resolve(self, spec: ResourceSpec) -> dict[str, Any] | None:
        package = self.package(spec.package)
        if package is None:
            return None
        for resource in package.get("resources", []):
            if resource.get("name", "").strip().casefold() == spec.resource_name.casefold():
                return resource
        return None

    def _cached_source(self, spec: ResourceSpec) -> dict[str, Any] | None:
        """Recupera metadados de uma fonte já baixada se o CKAN estiver indisponível."""
        provenance_path = self.raw_dir / f"{spec.key}.provenance.json"
        if not provenance_path.exists():
            return None
        try:
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        filename = provenance.get("filename")
        url = provenance.get("url")
        if not filename or not url or not (self.raw_dir / filename).exists():
            return None
        return {
            "state": "available",
            "required": spec.required,
            "package": spec.package,
            "resource_name": spec.resource_name,
            "description": spec.description,
            "url": url,
            "resource": provenance.get("ckan_resource"),
            "discovery": "cached_provenance_after_ckan_error",
        }

    def discover(self, year: int) -> dict[str, Any]:
        """Persiste um manifesto mesmo quando resultados ainda não existem."""
        discovered: dict[str, Any] = {
            "generated_at_utc": datetime.now(UTC).isoformat(),
            "year": year,
            "ckan_api": CKAN_API,
            "sources": {},
        }
        for spec in source_specs(year):
            try:
                resource = self.resolve(spec)
                state = "available" if resource else "unavailable"
                discovered["sources"][spec.key] = {
                    "state": state,
                    "required": spec.required,
                    "package": spec.package,
                    "resource_name": spec.resource_name,
                    "description": spec.description,
                    "url": resource.get("url") if resource else None,
                    "resource": resource,
                }
            except (HTTPError, URLError, OSError, json.JSONDecodeError) as exc:
                fallback = self._cached_source(spec)
                if fallback:
                    fallback["ckan_error"] = str(exc)
                    discovered["sources"][spec.key] = fallback
                    continue
                discovered["sources"][spec.key] = {
                    "state": "error",
                    "required": spec.required,
                    "package": spec.package,
                    "resource_name": spec.resource_name,
                    "description": spec.description,
                    "url": None,
                    "error": str(exc),
                }
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        (self.raw_dir / f"sources_{year}.json").write_text(
            json.dumps(discovered, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return discovered

    def download(self, key: str, metadata: dict[str, Any]) -> Path:
        """Baixa uma fonte descoberta e grava metadados e SHA-256 locais."""
        if metadata.get("state") != "available" or not metadata.get("url"):
            raise SourceUnavailableError(
                f"Fonte {key!r} indisponível no Portal de Dados Abertos do TSE. "
                "Não há dados oficiais suficientes para esta etapa."
            )
        url = str(metadata["url"])
        suffix = Path(url.split("?", 1)[0]).suffix or ".bin"
        destination = self.raw_dir / f"{key}{suffix}"
        if destination.exists() and destination.stat().st_size > 0:
            LOGGER.info("Cache encontrado: %s", destination)
            return destination

        tmp = destination.with_suffix(destination.suffix + ".part")
        digest = hashlib.sha256()
        with urlopen(self._request(url), timeout=self.timeout_seconds) as response:
            with tmp.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    if chunk:
                        digest.update(chunk)
                        output.write(chunk)
        tmp.replace(destination)
        provenance = {
            "key": key,
            "url": url,
            "downloaded_at_utc": datetime.now(UTC).isoformat(),
            "filename": destination.name,
            "bytes": destination.stat().st_size,
            "sha256": digest.hexdigest(),
            "ckan_resource": metadata.get("resource"),
        }
        (self.raw_dir / f"{key}.provenance.json").write_text(
            json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return destination
