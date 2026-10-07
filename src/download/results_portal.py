"""Leitor dos JSONs públicos usados pelo Portal Resultados do TSE."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen


BASE_URL = "https://resultados.tse.jus.br/oficial"
ELECTIONS = {
    "PRESIDENTE": (6257, 1),
    "GOVERNADOR": (6259, 3),
    "SENADOR": (6259, 5),
    "DEPUTADO FEDERAL": (6259, 6),
    "DEPUTADO ESTADUAL": (6259, 7),
}


def election_code(election: int) -> str:
    return f"e{election:06d}"


def municipality_result_url(election: int, office_code: int, state: str, municipality_id: str) -> str:
    state = state.lower()
    return (
        f"{BASE_URL}/ele2026/{election}/dados/{state}/"
        f"{state}{municipality_id}-c{office_code:04d}-{election_code(election)}-u.json"
    )


def fetch_json(url: str, timeout_seconds: int = 60) -> tuple[dict, bytes]:
    request = Request(url, headers={"User-Agent": "up-eleitoral-pipeline/0.1"})
    with urlopen(request, timeout=timeout_seconds) as response:
        content = response.read()
    return json.loads(content.decode("utf-8")), content


def cache_payload(raw_dir: Path, filename: str, url: str, payload: bytes) -> Path:
    raw_dir.mkdir(parents=True, exist_ok=True)
    path = raw_dir / filename
    path.write_bytes(payload)
    provenance = {
        "url": url,
        "downloaded_at_utc": datetime.now(UTC).isoformat(),
        "filename": filename,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "source": "Portal Resultados do TSE (JSON oficial)",
    }
    path.with_suffix(".provenance.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path
