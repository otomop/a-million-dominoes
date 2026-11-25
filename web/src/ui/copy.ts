/** Every user-facing string on the page, in one place so the copy can be edited without touching code. */

/** Numbers from the machine file that the 'why' section quotes. */
export interface WhyFacts {
  gates: string;
  dominoes: string;
  pitches: string;
}

export const copy = {
  title: 'A Million Dominoes',
  tagline:
    'Watch a neural network compute. Draw a digit, and a million dominoes work out which number you wrote.',

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
      'This page is a visualizer for a small neural network. A network normally does its work inside a chip in a fraction of a second. Here the same calculation is laid out on a floor as falling dominoes, so every signal, every unit and the final decision can be followed by eye. Nothing is steered while it runs: one push at the start, and after that every domino falls only because another one hit it.',
    why: {
      heading: 'Why this is worth knowing',
      intro:
        'The dominoes are slow and enormous on purpose. They put a few things about today’s AI out on a floor where you can see them, instead of inside a chip.',
      points: [
        {
          lead: 'A trained network is a fixed machine.',
          text: () =>
            'Nothing on this floor learns. The learning happened earlier, in software, and what is left is a fixed layout that turns an input into an answer. The systems behind chatbots and image generators work the same way: a long training, then a frozen calculation that is run again for every word or picture. Here you can watch one run of such a calculation from start to finish.',
        },
        {
          lead: 'The rules were learned, not written.',
          text: () =>
            'Nobody told this machine what a 7 looks like. A program showed it tens of thousands of handwritten digits with the right answers and, after each one, nudged the network slightly towards getting it right. That nudging, called gradient descent, is how every modern neural network is trained. A gate cannot be nudged, because it either is an AND or it is not, so during training each unit was a blend of all sixteen possible gates, and at the end each settled on its strongest. It was then tested on writers it had never seen, and read 97 in 100 of their digits.',
        },
        {
          lead: 'It does not matter what it is made of.',
          text: (f: WhyFacts) =>
            `The same ${f.gates} learned gates give the same answers as code in this browser, as a chip, or as dominoes. A chip’s switches flip in less than a billionth of a second; a domino takes about a thirtieth of a second to knock over the next. Speed is the reason AI runs on silicon. There is no other ingredient.`,
        },
        {
          lead: 'Gates are the cheapest thing a computer can do.',
          text: () =>
            'Ordinary networks are built from multiplications of decimal numbers, and a large chatbot does billions of them for every word. That is why AI needs so much hardware and electricity. Networks made only of logic gates are a real line of research into doing the same job far more cheaply, because gates are what chips are made of already: the researchers who introduced them reported one classifying over a million digit images a second on a single processor core. It is also the only kind of network simple enough to lay out as dominoes.',
        },
        {
          lead: 'It decides by weighing evidence, and it can be wrong.',
          text: () =>
            'The machine never knows the answer. Each digit collects votes, and the most votes wins. The race display shows how close it was: a wide margin means the drawing was clear, a narrow one means it could easily have gone the other way. Every modern network works like this underneath, including the ones that sound certain.',
        },
        {
          lead: 'You can see what a small skill costs.',
          text: (f: WhyFacts) =>
            `Reading one handwritten digit takes ${f.dominoes} dominoes and a floor the size of ${f.pitches} football pitches. The networks in the news are many millions of times larger than this one. Much of what separates this machine from them is scale.`,
        },
      ],
    },
    stepsHeading: 'What you are watching, step by step',
    /** The walkthrough. `stop` names a place on the machine's tour; `figure` a diagram in figures.ts. */
    conceptLabel: 'In a neural network',
    /** One note per step of the walkthrough, in the same order: what the step is called in a network. */
    concepts: [
      'This is feature extraction. A network cannot take in a picture directly; the picture is first turned into a fixed list of numbers. Here the list is 192 bits. For an image model it is the brightness of every pixel.',
      'This is the input layer, where the features enter the network. Each input is copied to every place that uses it, which is why there are many more starters than answers.',
      'A falling line is a signal passing from one unit to the next, which engineers call an activation. In a chip the same signal is a voltage on a wire.',
      'This is one unit of the network, sometimes called a neuron. In most networks a unit multiplies its inputs by learned weights and adds them up. In this network a unit is one logic gate, and what was learned is which gate.',
      'Blocking supplies AND and NOT, which together with OR make every other gate. The trained network is a few thousand such units arranged in layers, each reading two units of the layer before it.',
      'This is the wiring between layers. A chip solves the same problem by stacking its wires on several levels of metal.',
      'This is the output layer. Each digit’s score is its number of yes votes, and choosing the highest score is called taking the argmax. Language models end the same way: a score for every possible next word, then a choice.',
      'This is winner-take-all: turning ten scores into one decision. The gap between first and second place is the nearest thing this network has to confidence.',
      'This is the prediction, the network’s output. One pass from input to output is called inference, and it is all a trained network does when you use it.',
    ],
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
    missing: {
      heading: 'What this example leaves out',
      intro:
        'This is about the simplest neural network that still does something useful. The systems in use today work on the same principle, but they differ in ways worth knowing.',
      points: [
        {
          lead: 'Their signals are numbers, not yes or no.',
          text: 'A unit in an ordinary network multiplies each of its inputs by a learned number called a weight, adds the results, and passes the total through a simple bend. Its output can be a little or a lot, which lets the network express shades of evidence. Graphics chips are built to do exactly this arithmetic quickly. Gate networks like this one are a small research field; almost everything in use today runs on arithmetic.',
        },
        {
          lead: 'The learning is not on this floor.',
          text: 'You are watching a finished network being used. Training is the other half: show an example, measure how wrong the answer was, work out for every weight which direction would have made it less wrong (backpropagation), move each weight slightly that way (gradient descent), and repeat millions of times. Training a large model can take weeks on thousands of specialised chips.',
        },
        {
          lead: 'Modern networks choose what to look at.',
          text: 'Here every gate reads the same two inputs every time. The networks behind chatbots, called transformers, use attention: for each word, the network works out which other words matter to it, and that changes from sentence to sentence. Image networks reuse one small detector across the whole picture instead of learning every position separately.',
        },
        {
          lead: 'They find their own features.',
          text: 'This machine was handed an 8 by 8 grid that a person designed. Modern networks start from raw pixels or pieces of words and learn their own internal descriptions: lists of numbers in which similar things end up close together.',
        },
        {
          lead: 'Most of their training data has no labels.',
          text: 'Every digit this network learned from came with its answer. Large models learn mainly by hiding part of the data and predicting it, for instance the next word of a sentence. That needs no labelling, so they can learn from enormous amounts of ordinary text, and are then adjusted for particular jobs.',
        },
        {
          lead: 'They generate, one piece at a time.',
          text: 'This network picks one of ten labels and stops. A language model scores every possible next piece of a word, turns the scores into probabilities, picks one, adds it to the text and runs again. A paragraph is hundreds of such runs.',
        },
        {
          lead: 'They are vastly larger.',
          text: 'This network has a few thousand gates. Large language models have billions to hundreds of billions of weights, and one model handles many tasks instead of one.',
        },
      ],
      outro:
        'What carries over unchanged: a network in use is a fixed calculation, its rules came from examples and not from a programmer, and it answers by weighing evidence, so it can be wrong.',
    },
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
