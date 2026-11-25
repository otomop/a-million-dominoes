# Evidence

What was run, what it showed, and what was not run. Every figure here comes from a command in this repository; `docs/validation.json` holds the machine-level numbers as the build wrote them.

## 1. The network

Five layers of two-input logic gates (2,000, 2,000, 2,000, 1,000, 500). Trained by `compiler/dominoes/train_final.py`; scored by `eval_final.py`.

| Test set | What it is | Used in training? | Accuracy |
|---|---|---|---|
| UCI optdigits, test part | 1,797 scanned pen digits from 13 writers | No. The 30 training writers are different people | **97.05%**; weakest digit, 9: 93.3% |
| UCI pendigits, test part | Pen-tablet strokes, drawn as the page draws them | Its training part was | 96.11% (91.5% when pendigits is left out of training) |
| MNIST, first 5,000 test digits | Scanned digits from a different source | Its training part was | 93.78% (85.6% when MNIST is left out of training) |

Every set goes through the same normalisation as a drawing on the page (`preprocess.py`): slant removed, ink scaled to a fixed box, drawn with a fixed pen into 32×32 pixels, counted in 4×4 blocks.

- **Position and size do not matter.** 22 hand-specified digit shapes, each at three sizes and two positions: all read correctly, and no prediction changed with size or position.
- **Not tested:** drawings by members of the public on phones. The three datasets are the stand-in.

## 2. The machine in the event model

`python -m dominoes.build --net models/final.npz` compiles the field, measures its timing, rebuilds it, and then runs all 1,797 optdigits test digits through the placed dominoes.

| Check | Result |
|---|---|
| Dominoes placed | 1,026,525 on a field 283 m × 244 m |
| Overlapping dominoes | 0 |
| Lanes' fair-start error after timing correction | 0.023 s across the ten lanes |
| Each claim's lead over its own blocker (target 0.275 s) | 0.273 to 0.278 s |
| Field's answer equals the network's answer, nominal timing | **1,797 of 1,797**, exactly one picture falling each time |
| Same, with every domino-to-domino delay varied at random by up to ±10% | 1,797 of 1,797 in the first run; 1,795 of 1,797 in the second |

The two misses under noise were the same kind: digits 7 and 8 were tied on votes, the noise brought the two lanes home within the gate's window, and both pictures fell. The network's answer was among the two each time.

The hit graph the event model runs on is derived from the placed geometry alone (positions, headings, heights), not from the circuit the compiler intended.

## 3. Gadgets in rigid-body physics

Rapier 0.14, time step 0.5 ms, friction 0.35 between dominoes and 0.5 on the floor. Every domino is displaced by about 1 mm (standard deviation) and turned by 2°. Scripts are in `compiler/physics/`.

| Gadget | Trials | Correct |
|---|---|---|
| Straight line, spacing 16 to 40 mm | 42 | 42 |
| A parallel line 30 to 48 mm away is not disturbed | 48 | 48 |
| Quarter turns, radius 36 to 96 mm | 48 | 48 |
| Changing row (S-bend) | 48 | 48 |
| Split | 100 | 100 |
| Merge: only A, only B, both | 300 | 300 |
| Bridge: only A, only B, both | 300 | 300 |
| One-way valve: forwards passes, backwards blocked | 60 | 60 |
| Vote section of the race lane: short path, and detour | 100 + 100 | 100 + 100 |
| Blocking gate, signal only (must pass) | 200 | 198 |
| Blocking gate, blocker only (must not pass or leak back) | 200 | 200 |
| Blocking gate, both, blocker at design timing or earlier | 400 | 400 |

The split, merge, bridge and vote-section rows were re-run on the final geometry. The other rows were run on the prototype of this design, whose gadget geometry is unchanged.

**Timing agreement.** In physics the vote section takes 3.18 s by the short path; the event model says 2.89 s. The built-in lead of a blocking gate is 0.450 s in physics and 0.446 s in the event model. The compiler demands a lead of at least 0.55 s at every gate.

### The finish gate's window

At the finish, a claim meets a blocker fired by whichever lane got home first. `physics/p9_claim_gate.py`, 100 noisy trials at each timing:

| Blocker reaches the collision point | Meaning | Claim passed | Claim blocked |
|---|---|---|---|
| 0.44 s before the claim | lost by a clear margin | 0 | 100 |
| 0.25 s before | lost only on the tie-break head start | 8 | 92 |
| 0.10 s before | | 12 | 88 |
| 0.10 s after | | 94 | 6 |
| 0.25 s after | the winner's own blocker | 100 | 0 |
| 0.40 s after | | 100 | 0 |

In the final machine the winner's own blocker arrives 0.275 s after its claim, a lane that lost by one vote is at least 1.0 s late, and a lane that lost only on the tie-break is 0.275 s late. So in physics the winner always passed and clear losers were always stopped; a tie-break loser was stopped about nine times in ten.

## 4. The browser against the reference

`npm test` in `web/`, 89 tests.

- **Simulation.** For 16 test digits the TypeScript automaton reproduces the Python one exactly: the number of dominoes fallen, the sum of all fall times, every lane's finish time, 24 sampled dominoes per case, and the winner.
- **Drawing to grid.** 40 stroke drawings, including a single dot, very wide and very tall shapes, and strokes on the pad's edge, give the same 8×8 grid and the same 192 bits as the Python reference.
- **File round trip.** The compiler's own tests write a machine file, read it back, and re-run a digit on the decoded graph with identical results.

## 5. Rendering

Measured on one machine only (NVIDIA RTX 5090 laptop GPU, at 1280×720 and 2560×1440): about 1 ms of GPU time per frame for the overview and for close-ups. The measurement was taken on an earlier layout of 750,000 dominoes. Far tiles are drawn as points and thinned. Not measured: live frame rate on an integrated GPU or a phone.

## 6. What was not done

- The whole field as rigid bodies. A million bodies at a 0.5 ms step is out of reach here; the claim rests on per-gadget physics plus the event model.
- A physical build of any part.
- Trials with people: whether strangers' drawings are read as well as the datasets, and whether anyone finds it worth watching.
