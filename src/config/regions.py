"""Configurações territoriais versionadas no código."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Region:
    slug: str
    state: str
    municipalities: tuple[str, ...]


BAIXADA_SANTISTA = Region(
    slug="baixada_santista",
    state="SP",
    municipalities=(
        "SANTOS",
        "SÃO VICENTE",
        "GUARUJÁ",
        "CUBATÃO",
        "PRAIA GRANDE",
        "BERTIOGA",
        "MONGAGUÁ",
        "ITANHAÉM",
        "PERUÍBE",
    ),
)

REGIONS = {BAIXADA_SANTISTA.slug: BAIXADA_SANTISTA}


def get_region(slug: str) -> Region:
    try:
        return REGIONS[slug]
    except KeyError as exc:
        choices = ", ".join(sorted(REGIONS))
        raise ValueError(f"Região desconhecida: {slug!r}. Opções: {choices}") from exc

