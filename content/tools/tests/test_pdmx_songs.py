"""The songs lane (pdmx_songs.py, pdmx_fragments.py): lane routing, the collection of a song, and the
reinstatement rule that lifted the genre and copyright-date exclusions (2026-10-16)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

import pdmx_fragments as fr  # noqa: E402
import pdmx_songs  # noqa: E402


def test_a_pop_or_soundtrack_candidate_leaves_the_classical_lane():
    assert fr.in_songs_lane({"genres": "pop"}, False)
    assert fr.in_songs_lane({"genres": "classical-soundtrack"}, False)
    assert fr.in_songs_lane({"genres": "rock-folk"}, False)


def test_classical_folk_religious_and_unlabelled_candidates_stay_in_the_classical_lane():
    for genres in ("classical", "folk", "religiousmusic", "folk-religiousmusic", "NA", ""):
        assert not fr.in_songs_lane({"genres": genres}, False), genres


def test_a_song_from_the_songs_file_is_in_the_songs_lane_whatever_its_tags():
    assert fr.in_songs_lane({"genres": "NA"}, True)
    assert fr.in_songs_lane({"genres": "classical"}, True)


def test_jazz_and_blues_go_to_modern_and_the_rest_to_songs():
    assert fr.song_collection("jazz") == "pdmx-modern"
    assert fr.song_collection("jazz-classical") == "pdmx-modern"
    assert fr.song_collection("blues") == "pdmx-modern"
    assert fr.song_collection("pop-rbfunksoul") == "pdmx-songs"
    assert fr.song_collection("") == "pdmx-songs"


def test_the_songs_lane_places_its_advanced_pieces_at_level_6_on_their_own_shelf():
    # 2026-10-19: the songs lane takes the level-6 rule (pdmx_advanced.py) and keeps the song on its Songs or
    # Modern shelf, where the Challenging level shows it
    doc = json.loads((TOOLS / "catalog.d" / "pdmx-songs-advanced.json").read_text(encoding="utf-8"))
    assert doc["pieces"]
    for piece in doc["pieces"]:
        assert piece["level"] == 6 and piece["collection"] in ("pdmx-songs", "pdmx-modern"), piece["slug"]
        assert piece["levelNote"].startswith("Advanced by the archive rule"), piece["slug"]


def test_the_reinstatement_keeps_content_exclusions_and_lifts_genre_and_copyright_ones():
    keep = pdmx_songs.CONTENT_REASON
    assert keep.search("content-safety: Nazi party song")
    assert keep.search("scope-judge: Pinochet propaganda march")
    assert keep.search("scope-judge: Meme piece")
    assert keep.search("scope-judge: Joke novelty arrangement")
    assert keep.search("review junk: test file")
    assert keep.search("review safety: Nazi-era march")
    assert not keep.search("modern-music: Ed Sheeran pop song; content-safety: Ed Sheeran modern pop song")
    assert not keep.search("modern-music: Video game music; content-safety: Video game theme")
    assert not keep.search("content-safety: Modern copyrighted hymn")
