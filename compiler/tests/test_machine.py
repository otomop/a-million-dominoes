"""End-to-end checks on a small random network: it compiles without collisions,
the timing converges, and the field's winner is the network's own answer."""

import json

import numpy as np
import pytest

from dominoes.build import compile_machine, meta
from dominoes.export import golden_case, read_machine, simulate_ticks, write_machine
from dominoes.train import eval_ops, group_scores
from dominoes.validate import overlaps


def random_net(path, seed=3, widths=(60, 40, 20), n_in=192, samples=40):
    rng = np.random.default_rng(seed)
    z = dict(widths=np.array(widths), thr=np.array([4.0, 8.0, 12.0]), K=-1)
    prev = n_in
    X = rng.random((samples, n_in)) < 0.4
    h = X
    for i, w in enumerate(widths):
        ia, ib = rng.integers(0, prev, w), rng.integers(0, prev, w)
        ib = np.where(ib == ia, (ib + 1) % prev, ib)
        op = rng.choice([1, 2, 4, 6, 7, 8, 9, 11, 13, 14], w)  # two-input functions only
        z[f"ia{i}"], z[f"ib{i}"], z[f"op{i}"] = ia, ib, op
        h = eval_ops(op, h[:, ia], h[:, ib])
        prev = w
    pred = group_scores(h).argmax(1)
    np.savez(path, Xte=X.astype(np.float32), yte=pred, pred=pred, acc=1.0, **z)
    return path


@pytest.fixture(scope="module")
def machine(tmp_path_factory):
    return compile_machine(random_net(tmp_path_factory.mktemp("net") / "net.npz"), verbose=False)


def test_no_dominoes_overlap(machine):
    assert overlaps(machine.x, machine.y, machine.yaw, machine.z0)[0] == 0


def test_timing_converged(machine):
    assert machine.cal["lane_spread_s"] < 0.06
    assert all(abs(v + machine.P.eps / 2) < 0.03 for v in machine.cal["self_lead_s"])


def test_field_gives_the_networks_answer(machine):
    z = machine.z
    r = machine.validate(z["Xte"], z["pred"])
    assert r["agree"] == r["n"] and r["none"] == 0 and r["multi"] == 0


def test_survives_timing_noise(machine):
    z = machine.z
    r = machine.validate(z["Xte"], z["pred"], jitter=0.1, seed=5)
    assert r["agree"] >= r["n"] - 1


def test_file_round_trip(machine, tmp_path):
    M = machine
    counts = dict(dominoes=len(M.x))
    hdr = meta(M, counts)
    always = [(i, 0) for i in M.always]
    statics = np.array(
        [[s["cx"], s["cy"], s["cz"], s["hx"], s["hy"], s["hz"], s.get("yaw", 0.0)] for s in M.cv.statics]
    ).reshape(-1, 7)
    path = tmp_path / "machine.bin.gz"
    write_machine(path, M.x, M.y, M.yaw, M.z0, M.Gq, M.arm_of, M.kind, M.B.pushers, always, statics, hdr)
    h2, a = read_machine(path)
    assert h2["count"] == len(M.x) and json.dumps(h2["lanes"]) == json.dumps(hdr["lanes"])
    assert np.abs(a["x"] - M.x).max() < 1 / 32 and np.abs(a["y"] - M.y).max() < 1 / 32
    assert np.array_equal(a["G"]["indptr"], M.Gq["indptr"]) and np.array_equal(a["G"]["dst"], M.Gq["dst"])
    bits = M.z["Xte"][0]
    case, ft, fd = golden_case(M.Gq, M.B.pushers, always, bits, hdr["lanes"])
    pushes = [(i, 1, 0.0) for (i, b, v) in a["pushers"] if bool(bits[b]) == bool(v)] + [
        (i, 1, float(t)) for i, t in a["always"]
    ]
    ft2, fd2 = simulate_ticks(a["G"], pushes)
    assert np.array_equal(ft, ft2) and np.array_equal(fd, fd2)
