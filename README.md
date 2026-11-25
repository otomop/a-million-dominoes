# A Million Dominoes

A handwritten-digit classifier compiled into a field of 1,026,525 dominoes and simulated in the browser. You draw a digit, the drawing tips a set of starter dominoes, and the chain reaction ends with one of ten domino pictures toppling to show the answer.

![The winning picture: a field of fallen dominoes showing the digit 3](docs/finale.jpg)

## Overview

The classifier is a neural network in which every unit is a single two-input logic gate. A compiler lays that circuit out as dominoes: lines for wires, joins for OR, head-on collisions for blocking, and small bridges where lines cross. The page loads the compiled layout, computes which domino falls when for the visitor's drawing, and renders the run as an animation that can be played, scrubbed and explored.

The project has two parts:

- **`compiler/`** (Python) trains the network, places the dominoes, verifies the result and writes the machine file.
- **`web/`** (TypeScript, WebGL2) loads that file, runs the simulation and draws it.

## Quick start

```bash
cd web
npm install
npm run dev
```

Open the printed address, draw a digit or pick an example, and press **Topple**. Drag to orbit, scroll to zoom, and use the timeline to move through the run. The **How it works** panel walks through each part of the machine.

## How it works

1. **Input.** The drawing is normalised and reduced to an 8×8 grid of ink levels. Comparing each cell with three thresholds gives 192 bits.
2. **Starters.** Each bit controls a group of starter dominoes (3,506 in total). The starters whose condition holds are tipped at the same moment. This is the machine's only input.
3. **Logic.** Signals travel as falling lines. Every bit uses two lines, one for 1 and one for 0, so that "no" is distinguishable from "not yet". Two lines merging form an OR; a line knocked down from its far end blocks a later signal. All of the network's gates are built from those two gadgets.
4. **Counting.** Each digit has 50 output gates. A race lane passes them in turn and takes a detour of about six seconds for each gate that voted against the digit, so the lane with the most votes finishes first.
5. **Finish.** The first lane to arrive triggers a common line that closes the other nine lanes' gates, then topples a field of dominoes painted with its digit.

A longer description is in [docs/how-it-works.md](docs/how-it-works.md).

![Mid-run: one arm's logic has fallen and its lane is racing toward the centre](docs/race.jpg)

## Design notes

A few points that shaped the design:

- **One-way junctions.** A wave entering a junction also travels back up the other inputs. Every gadget entry therefore uses an offset, angled domino that passes a wave forwards and misses it backwards.
- **Blocking gates.** The blocker has to reach the shared segment before the signal does. The gate is laid out so that the signal, not the blocker, makes the U-turn, and the compiler lengthens each segment until the blocker's worst-case arrival leads by at least 0.55 s.
- **No global routing.** Sharing a gate's output between consumers would require around two million line crossings. Each output gate instead gets a private tree of gates, duplicated as needed: 2,303 gate instances for a 7,500-gate network.
- **No padding wire.** Tree leaves are starter dominoes and can stand anywhere, so a shallow branch starts further along instead of waiting behind a long wire. At each gate the later-arriving operand is used as the signal and the earlier one as the blocker.
- **Timing by measurement.** The race lanes and the finish are calibrated from simulation. The compiler builds the field, runs each lane alone, measures its delays, and rebuilds with the lane starts and finish delays corrected.
- **Geometry-derived simulation.** The page does not simulate rigid bodies. It runs an event model whose hit graph is derived from the placed geometry alone and whose delays were calibrated against rigid-body tests of each gadget. The graph is stored in the machine file, so the browser runs the same automaton the validation ran.
- **Rendering.** Each domino's fall time is uploaded once per run and the animation is computed in the vertex shader from a single time value, which makes scrubbing free. Distant tiles are drawn at reduced detail.

## Results

| Check | Result |
|---|---|
| Network accuracy, writers not seen in training | 97.05% of 1,797 digits (UCI optdigits test set); lowest class 93.3% |
| Network accuracy, other datasets | 96.1% on UCI pendigits test; 93.8% on 5,000 MNIST test digits (their training splits were used in training) |
| Field output equals network output | 1,797 of 1,797 test digits, with exactly one picture toppling |
| Same, with ±10% random variation on every domino-to-domino delay | 1,797 of 1,797 and 1,795 of 1,797 in two runs; the misses were vote ties in which two pictures toppled |
| Overlapping dominoes | None |
| Gadgets in rigid-body physics with ±1 mm, ±2° placement noise | Split, merge, bridge and vote section: no failures in 100 or more trials each. Blocking gate: 798 of 800 at design timing |
| Browser simulation against the Python reference | Identical fall times on 16 reference runs; identical input bits on 40 reference drawings |

Methods and full figures are in [docs/evidence.md](docs/evidence.md).

| Quantity | Value |
|---|---|
| Dominoes | 1,026,525 |
| Field size | 283 m × 244 m |
| Blocking gates / merges / bridges | 2,024 / 1,628 / 1,678 |
| Network | 7,500 gates in five layers (2,000, 2,000, 2,000, 1,000, 500) |
| Run time at physical domino speed | about six minutes |
| Machine file | 1.0 MB compressed |

## Limitations

- The complete field has been run only in the event model. Rigid-body physics was applied to each gadget type, not to the whole layout.
- Under placement noise a blocking gate succeeds about 99.75% of the time, so a physical build of this size would be expected to contain a few faulty gates per run.
- Accuracy was measured on public datasets passed through the page's normalisation, not on drawings collected from users.
- Rendering performance was measured on one high-end GPU only.

## Relation to neural networks

- **Inference is a fixed computation.** Nothing in the field learns. Training happened beforehand; what remains is a fixed structure that maps an input to an output, as in any deployed network.
- **The rules were learned.** The gates were chosen by gradient descent on labelled examples. During training each unit is a weighted mixture of the 16 two-input Boolean functions; afterwards each is fixed to its most likely one.
- **The substrate is interchangeable.** The same gates give the same answers as code, as a chip, or as dominoes. Only the speed differs.
- **Gates are cheap.** Conventional networks rely on large numbers of multiplications. Logic-gate networks are an active research direction for much cheaper inference, and the same property makes this layout possible.
- **Decisions are counts of evidence.** Each class accumulates votes and the largest count wins, so the margin between first and second place is visible in every run.

## Physical scale

For reference, a physical build of this layout would need a level floor of about 283 m × 244 m, roughly eight tonnes of dominoes at 8 g each, 1,678 bridges, and 3,506 actuators to tip the starters simultaneously. At three seconds per domino, placement alone is about 860 person-hours. The weight and placement rate are assumptions.

## Repository layout

| Path | Contents |
|---|---|
| `compiler/dominoes/` | Training, layout compiler, event simulation, validation and export |
| `compiler/physics/` | Rigid-body gadget tests (Rapier, driven from Python) |
| `compiler/tests/` | End-to-end tests on a small random network |
| `compiler/models/final.npz` | The trained network |
| `web/` | The page |
| `web/public/machine.bin.gz` | The compiled machine ([format](docs/format.md)) |
| `docs/` | Design description, evidence, prior art, file format |

## Reproducing the build

Compiler (Python 3.11 or later):

```bash
cd compiler
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install numpy scipy numba pytest
pytest -q
python -m dominoes.build --net models/final.npz --out ../web/public --report ../docs/validation.json
```

The build takes about five minutes, most of it spent checking all 1,797 test digits three times. Retraining the network requires the public datasets, which `dominoes/prepare_data.py` downloads; sources and licences are listed in that file.

Page:

```bash
cd web
npm test
npm run build
```

## Prior work and credits

- Differentiable logic gate networks: Petersen, Borgelt, Kuehne and Deussen (2022). The implementation here is independent.
- Datasets: UCI Optical Recognition of Handwritten Digits and UCI Pen-Based Recognition of Handwritten Digits (CC BY 4.0); MNIST (CC BY-SA 3.0).
- Physics tests: [Rapier](https://rapier.rs) (Apache-2.0).
- Related projects and what differs here: [docs/prior-art.md](docs/prior-art.md).

## Licence

MIT. See [LICENSE](LICENSE).
