"""The canonical preprocessing reproduces its stored fixtures and has the invariances it promises.

Run from the ``compiler`` folder:  ..\\.venv\\Scripts\\python.exe -m pytest tests
"""

import json
import os

import numpy as np

from dominoes import preprocess as P
from dominoes.sample_strokes import SHAPES, place

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "fixtures", "preprocess_cases.json")


def load():
    with open(FIXTURES) as f:
        return json.load(f)


def test_fixture_file_shape():
    J = load()
    assert len(J["cases"]) == 40
    assert len(J["thresholds"]) == 3
    for c in J["cases"]:
        assert len(c["counts"]) == 64 and len(c["bits"]) == 48
        assert all(0 <= v <= 16 for v in c["counts"])


def test_stroke_cases_reproduce():
    J = load()
    for c in J["cases"]:
        counts = P.strokes_to_counts(c["strokes"])
        assert counts.shape == (8, 8)
        assert counts.reshape(-1).tolist() == c["counts"], c["name"]
        assert P.bits_to_hex(P.counts_to_bits(counts, J["thresholds"])) == c["bits"], c["name"]
        img = P.strokes_to_image(c["strokes"])
        assert ["".join("#" if v else "." for v in row) for row in img] == c["image"], c["name"]


def test_counts_cases_reproduce():
    J = load()
    for c in J["countsCases"]:
        bits = P.counts_to_bits(np.array(c["counts"]).reshape(8, 8), J["thresholds"])
        assert P.bits_to_hex(bits) == c["bits"], c["name"]


def test_repeatable():
    for label, name, strokes in SHAPES:
        s = place(strokes, 137.0, 12.0, 9.0)
        a = P.strokes_to_counts(s)
        b = P.strokes_to_counts(s)
        assert (a == b).all()


def test_bit_layout():
    counts = np.zeros((8, 8), dtype=int)
    counts[3, 3] = 16
    counts[3, 4] = 9
    counts[4, 3] = 5
    counts[4, 4] = 1
    bits = P.counts_to_bits(counts, (4, 8, 12))
    on = sorted(int(i) for i in np.nonzero(bits)[0])
    assert on == [
        0 * 64 + 3 * 8 + 3,
        0 * 64 + 3 * 8 + 4,
        0 * 64 + 4 * 8 + 3,
        1 * 64 + 3 * 8 + 3,
        1 * 64 + 3 * 8 + 4,
        2 * 64 + 3 * 8 + 3,
    ]
    assert P.bits_to_hex([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]) == "0102"


def test_image_path_matches_strokes_roughly():
    """A rendered drawing pushed back through image_to_counts stays close to its own grid."""
    worst = 0
    for label, name, strokes in SHAPES:
        img = P.strokes_to_image(place(strokes, 150.0, 0.0, 0.0))
        a = P.block_counts(img)
        b = P.image_to_counts(img)
        worst = max(worst, int(np.abs(a - b).max()))
    assert worst <= 8
