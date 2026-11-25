# Design notes

Background for readers who want more than the README: the decisions that shaped the layout, how the project relates to neural networks in general, what a physical build would involve, and the known limitations.

## Design decisions

- **One-way junctions.** A wave entering a junction also travels back up the other inputs. Every gadget entry therefore uses an offset, angled domino that passes a wave forwards and misses it backwards.
- **Blocking gates.** The blocker has to reach the shared segment before the signal does. The gate is laid out so that the signal, not the blocker, makes the U-turn, and the compiler lengthens each segment until the blocker's worst-case arrival leads by at least 0.55 s.
- **No global routing.** Sharing a gate's output between consumers needs global routing. An earlier 1,500-gate version of the network would have required about two million line crossings, and the final network is five times larger. Each output gate instead gets a private tree of gates, duplicated as needed: 2,303 gate instances for a 7,500-gate network.
- **No padding wire.** Tree leaves are starter dominoes and can stand anywhere, so a shallow branch starts further along instead of waiting behind a long wire. At each gate the later-arriving operand is used as the signal and the earlier one as the blocker.
- **Timing by measurement.** The race lanes and the finish are calibrated from simulation. The compiler builds the field, runs each lane alone, measures its delays, and rebuilds with the lane starts and finish delays corrected.
- **Geometry-derived simulation.** The page does not simulate rigid bodies. It runs an event model whose hit graph is derived from the placed geometry alone and whose delays were calibrated against rigid-body tests of each gadget. The graph is stored in the machine file, so the browser runs the same automaton the validation ran.
- **Rendering.** Each domino's fall time is uploaded once per run and the animation is computed in the vertex shader from a single time value, which makes scrubbing free. Distant tiles are drawn at reduced detail.

## Relation to neural networks

- **Inference is a fixed computation.** Nothing in the field learns. Training happened beforehand; what remains is a fixed structure that maps an input to an output, as in any deployed network.
- **The rules were learned.** The gates were chosen by gradient descent on labelled examples. During training each unit is a weighted mixture of the 16 two-input Boolean functions; afterwards each is fixed to its most likely one.
- **The substrate is interchangeable.** The same gates give the same answers as code, as a chip, or as dominoes. Only the speed differs.
- **Gates are cheap.** Conventional networks rely on large numbers of multiplications. Logic-gate networks are an active research direction for much cheaper inference, and the same property makes this layout possible.
- **Decisions are counts of evidence.** Each class accumulates votes and the largest count wins, so the margin between first and second place is visible in every run.

## Physical scale

A physical build of this layout would need:

| Item | Quantity |
|---|---|
| Level floor | about 283 m × 244 m |
| Dominoes | 1,026,525 (roughly eight tonnes at 8 g each) |
| Bridges | 1,678, each with seven stair blocks and a deck |
| Actuators fired together | 3,516: one per starter domino (3,506) and one per lane start (10) |
| Placement time at three seconds per domino | about 860 person-hours |
| One run | about six minutes, after which roughly half the field has to be reset |

The domino weight and placement rate are assumptions.

## Limitations

- The complete field has been run only in the event model. Rigid-body physics was applied to each gadget type, not to the whole layout.
- Under placement noise a blocking gate succeeds about 99.75% of the time, so a physical build of this size would be expected to contain a few faulty gates per run.
- Accuracy was measured on public datasets passed through the page's normalisation, not on drawings collected from users.
- Rendering performance was measured on one high-end GPU only.
