<h1 align="center">A Million Dominoes</h1>

<p align="center">
  An interactive visualizer of how a neural network computes, built from a million simulated dominoes.
</p>

<p align="center">
  <a href="https://github.com/otomop/a-million-dominoes/actions/workflows/ci.yml"><img src="https://github.com/otomop/a-million-dominoes/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT licence"></a>
  <img src="https://img.shields.io/badge/built%20with-Claude%20Code-d97757.svg" alt="Built with Claude Code">
</p>

<p align="center">
  <a href="https://otomop.github.io/a-million-dominoes/"><strong>Live demo</strong></a> ·
  <a href="docs/how-it-works.md">How it works</a> ·
  <a href="docs/evidence.md">Evidence</a> ·
  <a href="docs/design-notes.md">Design notes</a> ·
  <a href="docs/format.md">File format</a>
</p>

<p align="center">
  <a href="https://otomop.github.io/a-million-dominoes/"><img src="docs/overview.jpg" alt="The whole machine early in a run: ten arms of dominoes around a central finish, with the drawing pad, race display and timeline" width="100%"></a>
</p>

<p align="center">
  <img src="docs/finale.jpg" alt="The end of a run: a field of fallen dominoes shows the digit 3, and the race display lists each digit's votes" width="49%">
  <img src="docs/guide.jpg" alt="The guide open on the walkthrough, with an animated diagram of one line blocking another" width="49%">
</p>

> [!NOTE]
> **This project is AI-generated.** The code, tests and documentation were written by Claude (Anthropic) using [Claude Code](https://claude.com/claude-code), under human direction. The automated tests and the checks in [docs/evidence.md](docs/evidence.md) pass, but the code has not been independently reviewed.

## About

A Million Dominoes makes one run of a neural network visible from start to finish. A small network that reads handwritten digits is laid out as 1,026,525 dominoes, so every signal, every unit and the final decision can be watched as it happens. You draw a digit, the drawing tips a set of starter dominoes, and the chain reaction ends with a domino picture of the answer.

The network is a logic gate network: each of its units is a single logic gate. That is what makes the layout possible, because a gate can be built from a few dominoes and a multiplication cannot.

## What it visualizes

| In a neural network | In the visualizer | Where to look |
|---|---|---|
| Input features | 192 yes-or-no facts about the drawing, each tipping its starter dominoes | The bright dots at the start of a run |
| A signal (activation) | A falling line of dominoes. Each bit has a "1" line and a "0" line | Any line in an arm |
| A unit (neuron) | A logic gate: two lines merging (OR), or one line blocking another | The "Show me" stops in the How it works panel |
| Layers | Gates feeding gates, up to five in a row between a starter and a vote | The branching logic beside each race lane |
| Connections | Lines, with small bridges where two must cross | Bridges throughout the arms |
| Output scores | 50 votes per digit. Each "no" vote delays that digit's race lane | The race display, which lists each digit's yes votes once the race is decided |
| Choosing the answer (argmax) | The first lane to reach the centre closes the other nine | The finish at the centre |
| Confidence | The winner's lead over the runner-up, in seconds | The result card |
| Prediction | A field of dominoes that topples to show the digit | The picture panels |
| Training | Not shown. It happened beforehand, in software | `compiler/dominoes/train_final.py` |

## Quick start

The page is live at <https://otomop.github.io/a-million-dominoes/>. To run it locally you need Node.js (tested with versions 22 and 24) and a browser with WebGL2.

```bash
git clone https://github.com/otomop/a-million-dominoes.git
cd a-million-dominoes/web
npm install
npm run dev
```

Open the printed address, draw a digit or pick an example, and press **Topple**.

| Control | Action |
|---|---|
| Drag | Orbit the camera |
| Scroll | Zoom |
| <kbd>Space</kbd> | Play or pause |
| <kbd>←</kbd> <kbd>→</kbd> | Step through the run |
| **How it works** | The guide: a nine-step walkthrough with animated diagrams and a note on what each part is in a neural network. Its phase bar follows the run, and pressing a phase jumps the run there |

## Reading a run

A run takes about six minutes at real domino speed. The page plays it as a time-lapse of about 40 seconds; the speed control includes true speed.

1. **Input.** The drawing is reduced to an 8×8 grid of ink levels, giving 192 bits. The starter dominoes whose condition holds are all tipped at the same moment, together with the first domino of each race lane. Nothing is pushed after that.
2. **Logic.** Waves spread through each arm. Where two lines merge, the result is an OR; where one line knocks a segment down ahead of another, it blocks it. Each arm's gates settle into 50 yes-or-no votes for its digit.
3. **Race.** A lane runs along each arm past its 50 votes and takes a detour of about six seconds for every "no". The digit with the most "yes" votes reaches the centre first.
4. **Decision.** The first lane home triggers a common line that closes the other nine lanes' gates.
5. **Output.** The winning line topples a field of dominoes painted with its digit.

![Mid-run: one arm's logic has fallen and its lane is racing toward the centre](docs/race.jpg)

See [docs/how-it-works.md](docs/how-it-works.md) for the full description.

## The technology

- **Logic gate networks.** In most networks a unit multiplies its inputs by learned weights and adds them up. Here each unit is one two-input logic gate. During training a unit is a weighted blend of all 16 possible gates, which keeps it adjustable by gradient descent; afterwards it is fixed to its most likely gate. The method is from Petersen et al. (2022).
- **Training and inference.** Training adjusts the network on labelled examples and happens once, offline. Inference is a single pass from input to output in which nothing changes. The visualizer shows inference.
- **Two lines per bit.** A fallen line can say "yes", but a standing line could mean "no" or "not yet". Each bit is therefore carried on two lines, exactly one of which falls. Hardware designers call this dual-rail logic.
- **Timing.** A blocking gate works only if the blocker arrives first. The compiler computes the earliest and latest arrival of every signal and adjusts the layout until every gate has margin. Chip design uses the same analysis under the name static timing analysis.
- **Compilation.** The layout is generated, not drawn by hand: a trained network goes in and the positions of a million dominoes come out, checked against the network on every test digit.

## What this example leaves out

This is about the simplest neural network that still does something useful. Networks in use today work on the same principle but differ in ways worth knowing.

| | This visualizer | Networks in use today |
|---|---|---|
| **Units** | One logic gate each; a signal is yes or no | A weighted sum of numbers passed through a simple non-linear function; a signal can be a little or a lot |
| **Learning** | Not shown: you watch a finished network being used | Training is the other half. Backpropagation works out how each weight should change to reduce the error, gradient descent applies the change, and the loop repeats over millions of examples |
| **Wiring** | Fixed: each gate always reads the same two inputs | Attention (transformers): each part of the input works out which other parts matter to it, differently for every input. Convolution: one small detector is reused across a whole image |
| **Input** | Features designed by a person: an 8×8 grid and three thresholds | Raw pixels or pieces of text. The network learns its own internal representation (embeddings) |
| **Training data** | Labelled digits (supervised learning) | Mostly unlabelled data. The model learns by predicting hidden parts of it, such as the next word (self-supervised learning), and is then adapted to tasks |
| **Output** | One of ten labels; the top score wins | Probabilities over many options. Generative models pick one, append it and run again, building text or images piece by piece |
| **Size and scope** | 7,500 gates, one task | Millions to hundreds of billions of weights; one model adapted to many tasks |
| **Hardware** | Dominoes | GPUs and similar chips that perform many multiplications in parallel |

What carries over unchanged: a network in use is a fixed calculation, its rules came from examples and not from a programmer, and it answers by weighing evidence, so it can be wrong.

## Verification

| Check | Result |
|---|---|
| Accuracy on writers not seen in training | 97.05% of 1,797 digits |
| Field output equals network output | 1,797 of 1,797 |
| Same, with ±10% random timing variation | 1,797 and 1,795 of 1,797 in two runs |
| Gadgets in rigid-body physics with placement noise | 99.75% or better per gadget type at design timing |
| Browser simulation against the Python reference | Identical on all reference runs |

Methods, full figures and limitations are in [docs/evidence.md](docs/evidence.md) and [docs/design-notes.md](docs/design-notes.md).

## Project structure

```
a-million-dominoes/
├── compiler/              Python: training, layout compiler, validation
│   ├── dominoes/          the compiler package
│   ├── physics/           rigid-body gadget tests (Rapier)
│   ├── tests/             end-to-end tests
│   └── models/            the trained network
├── web/                   TypeScript and WebGL2 page
│   ├── src/
│   └── public/            the compiled machine and example digits
└── docs/                  design, evidence, prior art, file format
```

## Development

**Page**

```bash
cd web
npm test          # unit tests and comparison with the Python reference
npm run build     # type-check and production build
npm run shots -- http://localhost:5173   # retake the README screenshots (dev server running)
```

The page is deployed to GitHub Pages from `main` by `.github/workflows/pages.yml`.

**Compiler** (Python 3.11 or later)

```bash
cd compiler
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install numpy scipy numba pytest
pytest -q
```

To rebuild the machine file from the trained network (about five minutes):

```bash
python -m dominoes.build --net models/final.npz --out ../web/public --report ../docs/validation.json
```

Retraining the network requires the public datasets, which `dominoes/prepare_data.py` downloads.

## Documentation

- [How it works](docs/how-it-works.md): the network, the gadgets, the layout and the timing
- [Evidence](docs/evidence.md): what was tested, how, and the results
- [Design notes](docs/design-notes.md): design decisions, relation to neural networks, physical scale, limitations
- [Prior art](docs/prior-art.md): related projects and what differs here
- [File format](docs/format.md): the compiled machine file

## Acknowledgements

- Differentiable logic gate networks: Petersen, Borgelt, Kuehne and Deussen (2022). The implementation here is independent.
- Datasets: UCI Optical Recognition of Handwritten Digits and UCI Pen-Based Recognition of Handwritten Digits (CC BY 4.0); MNIST (CC BY-SA 3.0).
- Physics tests: [Rapier](https://rapier.rs) (Apache-2.0).

## License

[MIT](LICENSE)
