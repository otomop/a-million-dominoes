# The machine file

The compiler writes one file, `web/public/machine.bin.gz`. The page loads it, and nothing else, to draw and run the machine. `web/public/golden.json` holds reference results that the page's tests must reproduce exactly.

## Container

The file is gzip-compressed. Decompressed, it is:

| Bytes | Content |
|---|---|
| 0–3 | ASCII `AMD1` |
| 4–7 | uint32, little-endian: length `H` of the header in bytes |
| 8 … 8+H | header: UTF-8 JSON, padded with spaces so that `8 + H` is a multiple of 8 |
| 8+H … | blob: typed-array sections |

Each section starts at `8 + H + offset` and is 8-byte aligned, so a typed-array view can be made directly on the decompressed buffer. All multi-byte values are little-endian.

## Header fields

| Field | Meaning |
|---|---|
| `version` | `1` |
| `count` | number of dominoes, `N` |
| `edges` | number of hit-graph edges, `E` |
| `units.xy_mm` | millimetres per position unit (1/32) |
| `units.z_mm` | millimetres per height unit (15.5, one stair step) |
| `units.tick_s` | seconds per tick (0.0001). Every time in the file is a whole number of ticks |
| `domino` | `{h, w, t}` in mm: height 48, width 24, thickness 7.5 |
| `kinds` | names for the values in the `kind` section |
| `sections` | `{name: {dtype, offset, count}}` |
| `model` | how a drawing becomes input bits (see below) |
| `lanes` | ten entries, one per digit (see below) |
| `bounds` | `{minX, maxX, minY, maxY}` in mm |
| `timing` | `{delta_s, eps_s}`: detour per lost vote, and the head start between neighbouring digits |
| `layout` | `rectangle-prototype` or `pinwheel` |
| `arms`, `arena`, `stage`, `tour` | present in the final layout only (see below) |

## Sections

Per domino (`count` = N):

| Name | Type | Meaning |
|---|---|---|
| `dx`, `dy` | int32 | position, delta-coded: `x[i] = (dx[0] + … + dx[i]) * units.xy_mm` mm. x is east, y is north |
| `yaw` | int16 | heading in the x–y plane: `yaw = value * π / 32768` radians, anticlockwise from +x |
| `z` | uint8 | base height: `z0 = value * units.z_mm` mm (dominoes on stairs and bridge decks) |
| `arm` | uint8 | which digit's arm the domino belongs to (0–9), or 255 for shared parts |
| `kind` | uint8 | index into `kinds` |

Hit graph (compressed sparse rows over `2N` slots: slot `2i` is "domino i falls along its yaw", slot `2i+1` is "domino i falls against its yaw"):

| Name | Type | Meaning |
|---|---|---|
| `deg` | uint8, 2N | number of edges leaving each slot |
| `edst` | int32, E | target domino, stored as `target − source` |
| `edly` | uint16, E | delay in ticks from the source's fall to the target's fall |
| `edir` | int8, E | how the target falls: `+1` along its yaw, `−1` against it, `0` knocked aside (it falls but passes nothing on) |

Inputs:

| Name | Type | Meaning |
|---|---|---|
| `pushIdx`, `pushBit`, `pushVal` | uint32, uint8, uint8 | starter dominoes. Starter `k` is tipped (direction +1, tick 0) when input bit `pushBit[k]` equals `pushVal[k]` |
| `alwaysIdx`, `alwaysTick` | uint32, int32 | dominoes tipped on every run (direction +1) at the given tick. In the final layout every tick is 0 |

Scenery:

| Name | Type | Meaning |
|---|---|---|
| `statics` | float32, 7 per box | fixed boxes (stairs and bridge decks): centre x, y, z, half-sizes along x, y, z, yaw. Millimetres and radians |

## The automaton

A run is fully determined by the list of pushes. The rules, which the page must implement exactly:

1. Keep a min-heap of events `(tick, domino, dir)`. Start with one event per push, inserted in this order: the input starters in `pushIdx` order (only those whose bit matches), then the `always` entries in order.
2. Pop the earliest event. If that domino has already fallen, drop the event. Otherwise it falls now, in direction `dir`.
3. If `dir` is 0, nothing more happens. Otherwise, for each edge leaving slot `2·domino + (dir < 0 ? 1 : 0)`, in stored order, whose target has not yet fallen: push `(tick + edly, target, edir)`.

Ties in the heap are broken by the heap's own layout, so the heap must be the same one the reference uses: a binary heap in an array, sift-up while the parent is strictly greater, sift-down choosing the left child if it is strictly smaller than the current smallest and then the right child if it is strictly smaller than that. `compiler/dominoes/eventsim.py` (`_sim`) is the reference.

Each domino falls at most once. That is the whole machine.

## `model`

```json
{"grid": 8, "thresholds": [1, 6, 11], "bits": 192, "layers": [2000, 2000, 2000, 1000, 500],
 "bitOrder": "bit = t*64 + row*8 + col; 1 if count > thresholds[t]", "centre": "bbox-floor"}
```

A drawing is reduced to an 8×8 grid of ink counts from 0 to 16 (row 0 at the top). Input bit `t*64 + row*8 + col` is 1 when the count in that cell is greater than `thresholds[t]`. `compiler/dominoes/preprocess.py` is the reference for turning strokes into the grid.

## `lanes`

One entry per digit:

| Field | Meaning |
|---|---|
| `digit` | 0–9 |
| `start` | the lane's starter domino |
| `finish` | the domino whose fall tick, plus `finishBias`, is the lane's race time. In the final layout this is the lane's entry to the finish core |
| `finishBias` | ticks to add to `finish`'s fall tick so that the ten lanes' times are comparable (each lane's fixed run from its entry to the common line). Absent means 0 |
| `marks` | domino indices in order along the lane (one per vote section, then feeder checkpoints). The number fallen at a given time is the lane's progress |
| `win` | a domino that falls only if this lane wins (the exit of its finish gate), or `null` in the prototype layout, where the winner is simply the earliest `finish`. Normally exactly one lane's `win` falls. In an exact tie of vote counts under timing noise two can fall, which is a tie |
| `panel` | final layout only: `{first, count, cx, cy, w, h, yaw}`, the lane's picture panel: a contiguous range of dominoes and its rectangle in mm |

## Final-layout extras

| Field | Meaning |
|---|---|
| `arms` | per digit: `{digit, angle, inner: [x, y], outer: [x, y], label: [x, y], width, length}`. The lane runs from `outer` to `inner`; the arm's logic lies to one side of it, `width` wide and `length` long. `label` is a good place for the digit's name, beyond the arm's outer end |
| `hub` | `{radius}`: distance from the centre to the inner ends of the arms |
| `counts` | `{dominoes, edges, starters, byKind, gates: {rinh, merge, split, swap, …}, tree}`: totals for display |
| `arena` | `{cx, cy, w, h, yaw}`: the finish core and its ten gates, where the first lane home blocks the other nine |
| `stage` | `{cx, cy, w, h, yaw}`: the rectangle holding the ten picture panels |
| `tour` | list of `{name, x, y, r}`: places worth flying to (a blocking gate, a merge, a bridge, a split, a vote on a race lane, the finish, the answer panels). `r` is the radius to frame, in mm |

## `golden.json`

```json
{"tick_s": 0.0001, "cases": [{"bits": "…48 hex chars…", "label": 7, "network": 7, "winner": 7,
  "fallen": 512345, "sumTicks": 123456789012, "sumDir": 498765,
  "finish": [10 ticks], "probe": [[domino, tick, dir], …]}]}
```

`bits` is the 192 input bits packed little-endian (bit `i` is bit `i & 7` of byte `i >> 3`). `fallen` is how many dominoes fell, `sumTicks` the sum of their fall ticks, `sumDir` the sum of fall directions, `finish` each lane's `finish` tick (−1 if it never fell), and `probe` a random sample of dominoes with their fall tick (−1 if standing) and direction.
