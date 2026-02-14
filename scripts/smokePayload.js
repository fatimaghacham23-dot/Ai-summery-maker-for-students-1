const SMOKE_TEST_NOTES = `
MATHEMATICS
Solving a mixed word problem, a chef combines 3 liters of syrup with 6 liters of water to describe the ratio.
A student applies the quadratic formula to solve x^2 - 5x + 6 = 0 and interprets the result.
Geometry problems reference area = πr^2 and perimeter formulas to compare shapes.
Word problems describe how rates accumulate interest and how payments apply to equations.
Math scenarios use term names like system and process to describe how each idea applies while pointing out errors to correct.
Word problems warn students to check for errors while comparing idea names and explaining why one strategy beats another.

SCIENCE
Photosynthesis is the process by which plants convert light energy into chemical energy. Chlorophyll absorbs light, and carbon dioxide combines with water to produce glucose and oxygen. This process supports life by generating oxygen and storing energy in sugars. A lab scenario describes how a scientist tracks energy moving through a system. Photosynthesis converts light energy into chemical energy in plants. Chlorophyll absorbs light, and glucose stores energy.

ENGLISH
The sentence "Running quickly, the finish line appeared" misplaces the modifier and needs revision.
A paragraph discusses tone, voice, and strong verbs to improve clarity and flow.
Students edit sentences to maintain consistent tense and correct punctuation.
A scenario about tone compares different systems of expression to show which option keeps the idea clear.
Students use scenario language to explain how voice, structure, and process work together in a paragraph.
Metaphor compares two unlike things without using like or as. A strong thesis improves clarity in writing.

GEOGRAPHY
A coastal map uses latitude and longitude to describe erosion patterns and travel routes.
Climate data contrasts rainfall and temperature shifts across tropical and temperate zones.
Transportation planners compare resource access and elevation changes along a corridor.
A scenario about a transportation system contrasts resources, weather, and strategy to show which path best connects people across places.
Climate describes long-term patterns, while weather describes day-to-day conditions. Erosion moves sediment.

HISTORY
The American Revolution began in 1775 and ended in 1783.
A diary written during the revolution describes shortages in Boston.
A textbook written in 2005 analyzes the causes of the revolution.
The French Revolution in 1789 led to the rise of Napoleon.
A monarchy places power in a king or queen, while a republic elects leaders.
An empire expands by conquering neighboring lands.
The Industrial Revolution started in the late 1700s and accelerated in the 1800s.
Primary sources include letters, speeches, and photographs created at the time.
Secondary sources include textbooks and documentaries made later.
A law passed in 1865 abolished slavery in the United States.
Civics discussions compare rights and responsibilities to show how scenario planning in government decides which option better protects a right rather than a responsibility.
Scenario questions often describe a government system and ask how rights stay secure when responsibilities are balanced.
Primary sources include letters and diaries written at the time. Secondary sources interpret events later.

COMPUTER SCIENCE
An algorithm processes inputs through an IPO diagram to calculate averages of sensor data.
Debugging reveals a race condition when two threads access shared memory simultaneously.
The lesson compares hardware, software, data, and information used to store knowledge.
A coding scenario explains how a system uses a process to move data and why errors happen when steps are skipped.
An algorithm is a step-by-step procedure for solving a problem. Input, process, output describe data flow.

CIVICS
Human rights: basic freedoms for all people, like speech, religion, and equal protection under the law.
Responsibilities such as obeying laws, respecting neighbors, and paying taxes keep communities fair.
Laws explain how freedoms to vote, petition, and assemble peacefully are balanced by civic duties.
Government accountability, transparency, and equality help maintain justice for every citizen.
Community service and informed voting show respect for both rights and responsibilities.
Civics scenarios examine how rights and responsibilities balance in civic systems, showing which option best protects rights rather than responsibilities.
`.trim();

const DEFAULT_SMOKE_SEED = "smoke-test";

const SMOKE_TYPES = { mcq: 4, trueFalse: 2, shortAnswer: 1, fillBlank: 1 };

const BASE_PAYLOAD = {
  text: SMOKE_TEST_NOTES,
  questionCount: 8,
  difficulty: "medium",
  strictTypes: true,
  types: SMOKE_TYPES,
};

const buildSmokePayload = ({ seed, ...overrides } = {}) => {
  const resolvedSeed = seed ?? process.env.SMOKE_EXAM_SEED ?? DEFAULT_SMOKE_SEED;
  return {
    ...BASE_PAYLOAD,
    ...overrides,
    seed: resolvedSeed,
  };
};

module.exports = {
  DEFAULT_SMOKE_SEED,
  SMOKE_TEST_NOTES,
  buildSmokePayload,
};
