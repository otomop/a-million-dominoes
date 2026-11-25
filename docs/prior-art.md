# What already existed

This project stands on other people's ideas. None of the pieces is new by itself.

| Existing work | What it has | What it does not have |
|---|---|---|
| [The Domino Computer](https://www.andrewt.net/maths/domputer/), a web page | Visitors draw domino wires and run small logic and sums | No learned model; nothing reads a drawing |
| [The 10,000 Domino Computer](https://www.youtube.com/watch?v=OpLU__bhu2w), 2014 | A real, hand-built domino adder that adds two four-bit numbers | Designed and placed by hand |
| A handwritten-digit recogniser built in Minecraft ([2019 post](https://www.reddit.com/r/Minecraft/comments/ak22ur/neural_network_for_handwritten_digit_recognition/)) | Draw a number and a computer in an unlikely world reads it | Runs on game commands, not on a material with one behaviour |
| [A mechanical metamaterial that classifies digits](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933649/), 2023 | A physical classifier with no electronics | Tested on two classes; a laboratory object |
| Differentiable logic gate networks (Petersen et al., 2022) | The training method used here: networks whose units become single logic gates | Nothing about dominoes |
| Domino logic gates in general (many videos and posts since the 2000s) | AND, OR and XOR from falling dominoes | Single gates or small adders |

## What is different here

- **The material.** No classifier made of falling dominoes was found, in searches by two independent researchers.
- **A compiler.** No domino machine laid out by a program, as opposed to by hand, was found. Here a trained network goes in and a placed field comes out, with timing checked for every gate.
- **Scale and a finger.** About a million dominoes, and the visitor's own drawing is the input.

## What was not checked

Chinese-language video sites, and physical builds that exist only as short videos without a write-up. If you know of earlier work that belongs in this table, please open an issue.

## Findings that were not in the original idea

Building it turned up things the first sketch had wrong:

1. **Waves run backwards.** A wave entering a junction also travels back up the other inputs unless every entry has a one-way valve.
2. **The obvious blocking gate is late by construction.** The blocker has to make a U-turn to enter the segment from the far end, so it loses the race it needs to win. The gate has to be built mirrored, with the main signal making the U-turn.
3. **Routing the network like a chip does not fit.** It needs about two million line crossings. Copying gates into private trees needs none between trees.
4. **Padding wires are unnecessary.** Starter dominoes can stand anywhere, so a short branch starts late instead of waiting. This removed more than a quarter of the dominoes.
5. **A finish line needs equal paths.** For the first lane home to block all the others and not itself, the "someone has finished" signal must reach every lane's gate at a known moment. That forces a single common line, and it forces the lanes' claims and the blockers to cross each other.
