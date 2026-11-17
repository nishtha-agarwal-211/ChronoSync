from __future__ import annotations

import hashlib
from dataclasses import dataclass

MAX_SEED = (1 << 53) - 1  # largest integer JSON/JS can carry exactly


@dataclass(frozen=True)
class LockedSeed:
    value: int

    def __post_init__(self) -> None:
        if not 0 <= self.value <= MAX_SEED:
            raise ValueError("seed must be between 0 and 2**53 - 1")

    def derive(self, label: str) -> int:
        """Deterministic sub-seed per consumer ('random', 'numpy', 'llm')."""
        digest = hashlib.sha256(f"{self.value}:{label}".encode()).digest()
        return int.from_bytes(digest[:8], "big")
