# How it works

The project is a visualizer: it lays out one complete run of a small neural network as falling dominoes. This page describes each stage of that calculation and how it is realised in dominoes. The short version is in the [README](../README.md).

## 1. A network made only of logic gates

The digit recogniser is a small neural network of the "differentiable logic gate" kind. Every unit reads two inputs and, during training, holds a weighted mixture of the 16 possible two-input Boolean functions. When training ends, each unit is fixed to its single most likely function. What is left has no numbers in it: it is a circuit of AND, OR, XOR and their negations.

- **Input.** A drawing is reduced to an 8×8 grid of ink counts from 0 to 16. Each cell is compared with three thresholds, giving 192 input bits.
- **Size.** Five layers: 2,000, 2,000, 2,000, 1,000 and 500 gates.
- **Output.** The last layer has 500 gates, 50 for each digit. A digit's score is the number of its 50 gates that output 1. The answer is the digit with the highest score; on a tie, the lower digit.
- **Training data.** Three public sets of handwritten digits, all pushed through the same normalisation as a drawing on the page: scanned pen digits, pen-tablet strokes and MNIST.
- **Code.** `compiler/dominoes/train.py` (the network), `train_final.py` (data and training), `preprocess.py` (drawing to grid).

## 2. Dominoes as wires

Dominoes are 48 × 24 × 7.5 mm, standing 24 mm apart in rows 48 mm apart. A wave travels along a line at about 0.8 m/s, so one domino step is 30 ms.

A fallen domino cannot stand up again, and a domino cannot signal "no" by staying upright, because nobody can tell that from "not yet". So every bit travels on **two lines**, one meaning "this bit is 1" and one meaning "this bit is 0". Exactly one of the two falls. NOT is then free: swap the two lines.

## 3. The gadgets

| Gadget | Dominoes | What it does |
|---|---|---|
| Wire | 41.7 per metre | Carries a signal |
| Split | 12 | One line knocks two dominoes standing side by side; each starts its own line |
| Merge | 11 | Two lines converge on one domino. This is OR: either line knocks it |
| One-way valve | none extra | The next domino stands 17 mm to the side and is turned 40°. A wave passes forwards and misses it backwards |
| Blocking gate | 28 and up | A short segment of line that the main signal enters from one end and the blocker from the other. If the blocker gets there first, its wave runs back along the segment and the main signal meets fallen dominoes |
| Bridge | 30, plus 8 stair blocks and a deck | One line climbs four steps to a deck 62 mm up and crosses over the other, which passes underneath |
| Vote section | about 390 | A piece of race lane with a short path through a blocking gate and a long detour around it |

Every Boolean function the network uses is built from merges and blocking gates on the two-line encoding. With `INH(m | b)` meaning "m passes unless b blocks it":

- AND-type gates: `out1 = INH(x1 | y0)` and `out0 = x0 OR y0`.
- XOR-type gates: `out1 = INH(x1 | y1) OR INH(x0 | y0)` and `out0 = INH(x1 | y0) OR INH(x0 | y1)`.

The gadgets were each tested in rigid-body physics (Rapier) with every domino misplaced by about 1 mm and 2°. The numbers are in [evidence.md](evidence.md).

## 4. From circuit to field

`compiler/dominoes/layout.py` places every gate.

- **No shared gates.** Routing one gate's output to several places would need millions of line crossings. Instead every output gate gets its own private tree of gates, copied as often as needed. The network is five layers deep, so a tree could have up to 31 gates, but most branches simplify away: the 500 trees hold 2,303 gates in all.
- **Inputs wherever they are needed.** A tree's leaves are starter dominoes. The drawing decides which starters are tipped at time zero: for each input bit, either its "is 1" starters or its "is 0" starters. Nothing else is ever touched.
- **No padding.** A shallow branch does not need a long wire to wait for a deep one: its starters simply stand further along. At each gate the branch that arrives later is made the main signal and the earlier one the blocker, because an early blocker costs nothing and an early main signal would have to be held back.
- **Timing closure.** For every blocking gate the compiler computes the earliest moment the main signal can arrive and the latest moment the blocker can, and lengthens the gate's segment until the blocker leads by at least 0.55 s. The physics tests put the safe lead at about 0.45 s.

## 5. Counting by racing

A count and a comparison are not logic gates, so the last step is built differently (`lane.py`).

Each digit has a **race lane** that passes its 50 output gates in turn. At each one the lane meets a vote section: if that gate says 1, the lane takes the short path; if it says 0, the gate's "is 0" line blocks the short path and the lane must take the detour, about 6.3 s longer. A lane's finish time is therefore a constant plus 6.3 s for every gate that voted against its digit. The digit with the most votes arrives first.

Lane for digit *d* starts 0.55 s × *d* later than lane 0, so equal vote counts go to the lower digit, exactly as the network's own tie rule does.

## 6. The finish

Arriving first has to turn into one toppled picture and nine untouched ones (`machine.py`, `build_core`).

1. In the core at the centre, each lane splits into a **claim** and a **vote on the common line**.
2. The ten votes merge into one line. It fires when the first lane arrives, and only then.
3. The common line splits into ten **blockers**, one beside each claim. Blockers and claims have to cross each other to get there: 45 bridges.
4. Just below the core, each claim meets its blocker at a blocking gate. A claim's path is timed so that it reaches its gate 0.275 s before the blocker that its *own* lane fired. So the winner's claim passes. Every other lane is at least 0.55 s behind, so its claim finds the blocker already there.
5. The one claim that passes runs to its digit's **picture panel**: a feeder line with 30 taps, each feeding a column of dominoes down and back up. All ten panels are identical fields; the digit is in the paint.

## 7. The layout

The ten digits' trees and lanes stand as arms around a hub, with a gap on the south side. Each arm's trees flow sideways into its lane; the lane runs inward. From the inner ends, feeders curl round to the north of the centre and enter the core together. The winning line leaves southward to the panels, which stand in the gap, upright for a viewer looking north.

## 8. Timed by measurement

Nothing between the trees and the panels is timed by estimate. The compiler builds the whole machine, runs each lane alone through the event model to measure when it fires the common line and when its claim and blocker reach its gate, then rebuilds with each lane's starting delay and each claim's delay box corrected. After the second build the ten lanes agree to within a few hundredths of a second and every claim leads its own blocker by 0.275 s.

## 9. The event model

The page does not simulate rigid bodies for a million dominoes. It runs an automaton (`eventsim.py`, ported in `web/src/machine/sim.ts`):

- A falling domino sweeps a strip 24 mm wide and 48 mm long in front of it. The nearest domino whose footprint lies in that strip, at a compatible height, is hit.
- The hit domino falls along its own axis, in whichever direction is closer to the push. If the push is more than about 53° off its axis it is knocked aside and passes nothing on.
- The delay from one fall to the next depends on the gap, calibrated on rigid-body chains: 30 ms at 24 mm.
- Each domino falls once. Two waves meeting head-on stop each other.

Which domino can hit which is worked out from the placed geometry alone, never from the circuit the compiler meant to build. That graph is stored in the machine file, so the browser runs exactly the automaton that the checks ran, and the page's test suite verifies it against reference results, domino for domino.

## 10. What is and is not claimed

- The whole field has **not** been run as rigid bodies. Each gadget has, and the event model matches physics on logic and timing for each of them.
- A physical copy with millimetre placement errors would almost certainly misfire somewhere: there are about two thousand blocking gates, each right about 99.75% of the time under that noise.
- A run takes several minutes at real domino speed. The page plays a time-lapse and says so.
- Reading handwriting with an unlikely machine is not new, and neither are domino logic gates. A classifier made of dominoes, and a domino machine laid out by a compiler, were not found anywhere. See [prior-art.md](prior-art.md).
