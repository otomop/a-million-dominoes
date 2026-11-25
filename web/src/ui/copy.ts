/** Every user-facing string on the page, in one place so the copy can be edited without touching code. */

export const copy = {
  title: 'A Million Dominoes',
  tagline: 'Draw a digit. A million falling dominoes work out which number you wrote.',

  loading: {
    download: 'Fetching the machine…',
    build: 'Setting up the dominoes…',
    failed: 'The machine could not be loaded.',
    retry: 'Reload the page to try again.',
  },
  noWebGL: {
    heading: 'This page needs WebGL2',
    body: 'Your browser or device does not offer WebGL2, which this page uses to draw the dominoes. A recent Chrome, Edge, Firefox or Safari on a device with a graphics chip will work.',
  },

  pad: {
    label: 'Draw a digit',
    hint: 'Draw a digit here',
    canvasLabel:
      'Drawing pad. Draw a single digit with a mouse, pen or finger, or pick an example below.',
    example: (digit: number) => `Example ${digit}`,
    seenCaption: 'what the machine sees',
    seenLabel: 'The 8 by 8 grid of ink levels the machine reads from your drawing',
    examples: 'or try one',
    examplesLabel: 'Example digits',
    useExample: (digit: number) => `Use an example ${digit}`,
    clear: 'Clear',
    topple: 'Topple',
    toppling: 'Toppling…',
    count: (dominoes: string) => `${dominoes} dominoes in this machine`,
    drawAnother: 'Draw',
    drawAnotherLabel: 'Draw another digit',
    closeSheet: 'Hide the drawing pad',
  },

  timeline: {
    label: 'Playback',
    play: 'Play',
    pause: 'Pause',
    replay: 'Play again',
    scrub: 'Position in the run',
    speed: 'Playback speed',
    auto: 'Auto',
    times: (multiple: number) => `${multiple}×`,
    /** Shown next to the time while playing, e.g. "9× real speed". */
    currentSpeed: (multiple: string) => `${multiple}× real speed`,
    follow: 'Follow',
    following: 'Following',
    followLabel: 'Let the camera follow the action',
    position: (now: string, total: string) => `${now} of ${total}`,
  },

  race: {
    label: 'The race between the ten digits',
    heading: 'The race',
    waiting: 'First lane home wins',
    leading: 'in front',
    winner: 'first home',
    behind: (seconds: string) => `+${seconds} s`,
    laneLabel: (digit: number, percent: number) => `Digit ${digit}: ${percent}% of the way`,
  },

  result: {
    says: 'The dominoes say',
    /** Two or more winners, e.g. "4 or 9". */
    either: (digits: number[]) => digits.join(' or '),
    tie: 'A dead heat: these lanes got home together.',
    undecided: 'The dominoes could not decide',
    undecidedDetail: 'No lane got through the finish.',
    margin: (seconds: string, runnerUp: number) =>
      `${seconds} s ahead of ${runnerUp}, the runner-up`,
    fell: (count: string, total: string) => `${count} of ${total} dominoes fell`,
    realTime: (duration: string) => `${duration} at real speed`,
    minutes: (m: number, s: number) => (m > 0 ? `${m} min ${s} s` : `${s} s`),
  },

  sound: {
    on: 'Sound on',
    off: 'Sound off',
    turnOn: 'Turn sound on',
    turnOff: 'Turn sound off',
  },

  info: {
    button: 'How it works',
    close: 'Close',
    /** Labels for the totals at the top of the panel, keyed like the header's counts. */
    facts: {
      dominoes: 'dominoes',
      starters: 'starter dominoes',
      rinh: 'blocking gates',
      merge: 'merges',
      split: 'splits',
      swap: 'bridges',
    },
    showMe: 'Show me',
    intro:
      'Nothing here is steered by a computer while it runs. One push at the start, and after that every domino falls only because another domino hit it.',
    /** The walkthrough. `stop` names a place on the machine's tour; `figure` a diagram in figures.ts. */
    steps: [
      {
        heading: 'Your drawing becomes 192 yes-or-no answers',
        body: [
          'The pad is shrunk to a grid of 8 by 8 squares; the small picture beside the pad shows it. For every square the page asks three questions: is there more than a trace of ink in it, is it more than a third inked, more than two thirds?',
          'That makes 64 × 3 = 192 answers, each a plain yes or no. They are everything the machine will ever know about what you drew.',
        ],
      },
      {
        heading: 'Each answer tips a set of starter dominoes',
        body: [
          'Dotted through the field are starter dominoes. Each one belongs to one question and one answer: “tip me if square 3-4 is more than a third inked”, or “tip me if it is not”.',
          'Pressing Topple tips every starter whose answer is true, all at the same instant, about half of them. They are the bright dots at the start of a run. This is the only push the machine ever gets, and the only thing your drawing does.',
          'On this page the push is a calculation: the browser works out which domino hits which and when, then plays it back. Nothing is sent anywhere.',
        ],
        stop: 'Starter dominoes',
      },
      {
        heading: 'A line of dominoes is a wire, and every fact gets two',
        body: [
          'A falling line carries news across the floor at walking pace, about 0.8 metres a second. But a line can only ever say “yes”: a line still standing might mean “no” or might mean “not yet”.',
          'So every fact travels on two lines, one that falls if it is true and one that falls if it is false. Exactly one of the pair falls. To turn a fact into its opposite, swap the two lines.',
        ],
        figure: 'pair',
      },
      {
        heading: 'Two lines joining make OR',
        body: [
          'Where two lines run into one, the line beyond falls if either of them arrives. That is the logic gate OR, and it costs eleven dominoes.',
        ],
        figure: 'merge',
        stop: 'An OR merge',
      },
      {
        heading: 'One line can block another',
        body: [
          'Two lines share a short stretch, entering it from opposite ends. If the blocker gets there first, it knocks the stretch down backwards, and the signal arrives to find nothing left standing to push. If the blocker never comes, the signal passes.',
          'OR, blocking and the two-line trick are enough to build any yes-or-no rule. The rules themselves were not written by a person: a small neural network learned them from thousands of handwritten digits, under the condition that every unit in it end up as one simple gate. A compiler then laid each gate out as dominoes and checked every blocker arrives in time.',
        ],
        figure: 'block',
        stop: 'A blocking gate',
      },
      {
        heading: 'Lines cross on bridges',
        body: [
          'Lines on a floor get in each other’s way. Where two must cross, one climbs four small steps and runs over a deck while the other passes underneath.',
        ],
        stop: 'A bridge',
      },
      {
        heading: 'Fifty votes for each digit, counted by a race',
        body: [
          'Each of the ten arms ends in 50 answers to one question: does this look like my digit? The digit with the most “yes” answers should win, but dominoes cannot count.',
          'So each arm has a race lane that passes its 50 votes in turn. A “yes” lets the lane run straight on. A “no” blocks the short way and sends it round a detour about six seconds long. The lane with the most yes votes reaches the centre first.',
        ],
        figure: 'race',
        stop: 'A vote on the race lane',
      },
      {
        heading: 'First home wins, and only one',
        body: [
          'At the centre every lane splits in two. One half joins a line shared by all ten, which falls the moment the first lane arrives and fans back out to block each lane at a gate. The other half is the lane’s own claim, timed to slip through its gate a quarter of a second before that block reaches it.',
          'Only the first lane is early enough. The other nine find their gates already shut.',
        ],
        stop: 'The finish',
      },
      {
        heading: 'The answer is a picture',
        body: [
          'The winning claim runs on to a field of dominoes whose faces are painted. Standing, you see only their thin tops. Lying down, they show the digit. All ten pictures are there; nine stay standing.',
        ],
        stop: 'The answer panels',
      },
    ],
    real: {
      heading: 'If you built it for real',
      intro:
        'Nobody has. Every kind of piece was tested in a physics simulation with each domino set down about a millimetre and two degrees off; the whole field was not. These figures follow from the layout on this page.',
      floor: (width: string, depth: string, pitches: string) =>
        `A floor ${width} by ${depth} metres, about ${pitches} football pitches, smooth and level like a sports hall. Most of it is the empty ground between the arms.`,
      dominoes: (count: string, tonnes: string) =>
        `${count} dominoes of the usual toppling size, 48 mm tall. At about 8 grams each that is roughly ${tonnes} tonnes of plastic.`,
      bridges: (bridges: string, steps: string) =>
        `${bridges} bridges, each with eight little stair blocks and a deck: ${steps} parts that are not dominoes but only hold some up.`,
      setup: (hours: string, days: string) =>
        `Standing them up: at one domino every three seconds, ${hours} hours of work. A crew of twenty would need about ${days} full days if nobody ever knocked one over, and they would. Real builders leave gaps and fill them last.`,
      precision: (gates: string, misfires: string) =>
        `Care: with millimetre errors a blocking gate works about 399 times in 400. There are ${gates} of them, so expect about ${misfires} to misfire in a run, and one wrong gate can change the answer. A real build would need placing jigs and wider safety margins than a first attempt gets.`,
      starters: (starters: string) =>
        `The push: ${starters} starter dominoes, each with its own small pusher (a solenoid, or a pin on a string), wired to 192 switches set from the drawing and all fired together. This is the one part that is not dominoes.`,
      run: (minutes: string) =>
        `One run takes about ${minutes} minutes from the push to the picture. Then roughly half the field is lying down and has to be stood up again by hand before the next drawing.`,
    },
  },

  camera: {
    hint: 'Drag to look around, scroll to zoom',
  },
} as const;
