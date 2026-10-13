import pytest

from readability import corpus


def test_level_groups():
    assert corpus.level_group_of("ClementiM", "Clementi's Art", "Op. 42") == "teaching"
    assert corpus.level_group_of("MozartWA", "Sonata Facile - First movement", "K 545") == "teaching"
    assert corpus.level_group_of("MozartWA", "Fantasy in D minor", "KV 397") == "other"
    assert corpus.level_group_of("ChopinFF", "Etude", "Op. 10, No. 2") == "concert"
    assert corpus.level_group_of("VerdiG", "La Traviata", "") == "other"


@pytest.mark.skipif(not (corpus.MUTOPIA_DIR / "FingeringFiles").exists(), reason="Mutopia corpus not built")
def test_mutopia_totals_match_datasets_report():
    parts = list(corpus.iter_mutopia(with_beats=False))
    assert len(parts) == 286
    assert sum(len(p.notes) for p in parts) == 193059
    assert sum(p.n_printed for p in parts) == 36183
    assert all(1 <= n.finger <= 5 for p in parts for n in p.notes if n.printed)


@pytest.mark.skipif(not corpus.BEATS_DIR.exists(), reason="beat enrichment not run")
def test_beats_are_consistent_with_seconds():
    parts = [p for p in corpus.iter_mutopia(with_beats=True)][:40]
    for p in parts:
        bpm = p.meta["tempo_bpm_quarter"]
        assert bpm and p.beats_known
        for n in p.notes:
            if n.grace:
                continue
            assert abs(n.beat * 60.0 / bpm - n.onset) < 2e-3, (p.id, n)
            assert 0 <= n.bar_pos < n.bar_len + 1e-9
