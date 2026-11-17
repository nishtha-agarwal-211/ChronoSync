# test_seed.py
import pytest
from interceptor.models.seed import LockedSeed

def test_derive_is_deterministic_and_label_specific():
    s = LockedSeed(42)
    assert s.derive("random") == s.derive("random")
    assert s.derive("random") != s.derive("numpy")

def test_rejects_seed_above_2_53():
    with pytest.raises(ValueError):
        LockedSeed(1 << 53)
