const { AppError } = require("../middleware/errorHandler");
const { debugFetch } = require("../debug/debugFetch");

const TOOL_OPENAI_METADATA = {
  summary: {
    instructions: "Return a useful summary tailored to the requested detail level.",
    outputType: "text",
  },
  extract: {
    instructions: "Return structured extractions as JSON based on the tool.",
    outputType: "json",
  },
};

const getToolLabel = (tool) => {
  switch (tool) {
    case "summary.short":
      return "Short summary (2-3 sentences)";
    case "summary.detailed":
      return "Detailed summary (multiple paragraphs)";
    case "summary.bullets":
      return "Bullet-point summary";
    case "summary.one_sentence":
      return "One-sentence summary";
    case "summary.tldr":
      return "TL;DR summary";
    case "summary.key_takeaways":
      return "Key takeaways";
    case "summary.executive":
      return "Executive playbook";
    case "summary.sectioned":
      return "Section-by-section breakdown";
    case "rewrite":
      return "Rewrite";
    default:
      if (tool.startsWith("extract.")) {
        return `${tool.split(".")[1]} extraction`;
      }
      if (tool.startsWith("wow.")) {
        return `${tool.split(".")[1]} tool`;
      }
      return "General summarization tool";
  }
};

const buildToolPrompt = ({ tool, text, controls = {}, options = {} }) => {
  const { length = 0.5, tone = "professional", language = "en", focus = "student" } = controls;
  const metadata = TOOL_OPENAI_METADATA[tool.split(".")[0]] || TOOL_OPENAI_METADATA.summary;
  const instructions = [
    "You are StudySummarize, an AI companion for students, managers, developers, and lawyers.",
    `Tool: ${tool}`,
    `Focus: ${focus}`,
    `Tone: ${tone}`,
    `Language: ${language}`,
    metadata.instructions,
    "Produce only valid JSON with the following shape:",
    JSON.stringify(
      {
        output: { type: metadata.outputType, data: "..." },
        highlights: [
          { start: 0, end: 0, reason: "..." },
        ],
      },
      null,
      2
    ),
    `Summary length slider: ${Math.round(length * 100)}% (0 = short, 100 = long).`,
    options.sectioned ? `Section limit: ${options.sectioned.maxSectionChars} chars.` : null,
    options.rewrite ? `Rewrite mode: ${options.rewrite.mode}.` : null,
    "Respond using clean JSON only (no markdown, no surrounding text).",
    "Text:",
    text,
  ]
    .filter(Boolean)
    .join("\n");
  return instructions;
};

const ensureApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "OPENAI_API_KEY is missing. Set it in your environment to use the openai provider.",
      400,
      "CONFIG_ERROR"
    );
  }
  return apiKey;
};

const summarize = async ({ text, length, format }) => {
  const apiKey = ensureApiKey();

  const getPrompt = ({ text: promptText, length: promptLength, format: promptFormat }) => {
    const lengthInstructions = {
      short: "2-3 sentences",
      medium: "4-6 sentences",
      detailed: "7-10 sentences",
      unlimited: "As long as needed, with no length limit",
    };

    const formatInstruction =
      promptFormat === "bullets"
        ? "Return bullet points starting with '- '."
        : "Return a single paragraph.";

    return [
      "You are a helpful assistant that summarizes study notes for students.",
      `Summary length: ${lengthInstructions[promptLength]}.`,
      formatInstruction,
      "Keep the summary concise and clear.",
      "Text:",
      promptText,
    ].join("\n");
  };

  const response = await debugFetch("summary_generate", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: getPrompt({ text, length, format }),
        },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new AppError(
      `OpenAI request failed: ${response.status} ${errorBody}`,
      502,
      "PROVIDER_ERROR"
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new AppError("OpenAI returned an empty summary.", 502, "PROVIDER_ERROR");
  }

  return content;
};

const runTool = async ({ tool, text, controls = {}, options = {} }) => {
  const apiKey = ensureApiKey();
  const prompt = buildToolPrompt({ tool, text, controls, options });
  const response = await debugFetch("tool_run", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new AppError(`OpenAI tool run failed: ${errorBody}`, 502, "PROVIDER_ERROR");
  }

  const bodyText = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    throw new AppError("OpenAI tool response could not be parsed.", 502, "PROVIDER_ERROR");
  }

  if (!parsed?.output) {
    throw new AppError("OpenAI tool response missing output.", 502, "PROVIDER_ERROR");
  }

  return {
    output: parsed.output,
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
    meta: {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    },
  };
};

module.exports = {
  summarize,
  generateExam: async ({ text, title, config }) => {
    const apiKey = ensureApiKey();

    const prompt = [
      "You are an assistant that builds practice exams from study notes.",
      "Return ONLY valid JSON with keys: title, blueprint, questions.",
      "Blueprint should be an array of 4-8 topic labels extracted from the entire notes.",
      "Generate questions topic-by-topic for balanced coverage of the blueprint.",
      "Detect subject headings in the notes (e.g., MATHEMATICS, SCIENCE, ENGLISH, GEOGRAPHY, HISTORY / SOCIAL STUDIES, COMPUTER SCIENCE / ICT).",
      "If more than one subject is present, balance questions across subjects and set exam.meta.subjectCategory = \"mixed\".",
      "Question quality requirements:",
      "- Prompts must be natural, student-friendly, and specific with clear context (avoid robotic phrasing).",
      "- Ban robotic stems: \"Which term matches this description\", \"Describe the role or function of\", \"Compare X with a related idea\".",
      "- Questions must be conceptual, analytical, and applied (not just definitions).",
      "- Use Bloom-style depth: mostly Explain/Compare (L2), Apply (L3), Analyze/Reason (L4).",
      "- Limit pure definition/term questions to at most 15-20% of total.",
      "- Cover ALL subjects/topics mentioned in the notes, not just the first paragraphs.",
      "- Avoid repetition: do not ask the same fact in different wording.",
      "- Do NOT reuse the same prompt stem more than once per exam.",
      "- Avoid duplicate topic labels unless there are not enough unique concepts.",
      "- Do not include multiple True/False questions about the same concept.",
      "Subject-specific MCQ styles (required):",
      "- Math: solve step, apply formula, error spotting, property classification.",
      "- Science: cause/effect, function, classification, scenario reasoning.",
      "- English: grammar correction, identify literary device using NEW examples, active/passive, sentence improvement.",
      "- Geography: scenario (lat/long), climate vs weather, erosion/deposition, renewable vs non-renewable classification.",
      "- History: primary vs secondary scenario, cause/effect, rights vs responsibilities examples.",
      "- CS/ICT: IPO scenarios, hardware vs software classification, algorithm reasoning, data vs information.",
      "Distractor rules:",
      "- Distractors must be sibling concepts from the same subject or common misconceptions.",
      "- Avoid single-word distractors copied directly from the prompt.",
      "- Ensure exactly one correct answer.",
      "- At least 50% of MCQs should be scenario-based or applied.",
      "Schema requirements:",
      "- Every question must include: type, topic, bloomLevel (L1-L4), prompt, explanation, points.",
      "- Non-true/false questions must include a rationale in explanation.",
      "- MCQ must include choices (4 options) and answerKey (A-D).",
      "- Short answer must include answerKeyText array.",
      "- Fill blank must include answerKeyBlank string.",
      "True/False requirements (mandatory schema):",
      "- type must be trueFalse.",
      '- Include "classification": one of Definition | Concept | Fact | Application.',
      "- Include answerKeyBool (boolean).",
      "- Include explanation with at least 2 sentences explaining why true/false.",
      "Few-shot examples (format only, not from the notes):",
      JSON.stringify(
        {
          title: "Example Exam",
          blueprint: ["Topic A", "Topic B"],
          questions: [
            {
              type: "mcq",
              topic: "Topic A",
              bloomLevel: "L3",
              prompt:
                "A student applies principle X to scenario Y. Which step best prevents the failure mode?",
              choices: ["Option A", "Option B", "Option C", "Option D"],
              answerKey: "B",
              explanation:
                "The scenario requires applying principle X to avoid the failure mode. Option B aligns with the correct mitigation.",
              points: 1,
            },
            {
              type: "shortAnswer",
              topic: "Topic B",
              bloomLevel: "L2",
              prompt: "Compare approach A vs B for balancing trade-offs in this system.",
              answerKeyText: ["trade-off", "efficiency", "risk"],
              explanation:
                "A strong response contrasts the approaches and references efficiency/risk trade-offs.",
              points: 2,
            },
            {
              type: "trueFalse",
              topic: "Topic A",
              bloomLevel: "L2",
              prompt: "True or False: In scenario Z, applying X always increases output.",
              classification: "Application",
              answerKeyBool: false,
              explanation:
                "The claim ignores the constraints in scenario Z that limit output. It would only be true if those constraints were removed.",
              points: 1,
            },
          ],
        },
        null,
        2
      ),
      `Difficulty: ${config.difficulty}`,
      `Question counts: ${JSON.stringify(config.types)}`,
      "Language: en",
      `Title (optional): ${title || "Auto-generate a concise title"}`,
      "Study text:",
      text,
    ].join("\n");

    const response = await debugFetch("exam_generate", "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new AppError(
        `OpenAI request failed: ${response.status} ${errorBody}`,
        502,
        "PROVIDER_ERROR"
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new AppError("OpenAI returned empty exam content.", 502, "PROVIDER_ERROR");
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new AppError("OpenAI returned invalid JSON for exam.", 502, "PROVIDER_ERROR");
    }

    if (!parsed?.questions || !Array.isArray(parsed.questions)) {
      throw new AppError("OpenAI exam response missing questions.", 502, "PROVIDER_ERROR");
    }

    return {
      title: parsed.title || title || "Generated Exam",
      questions: parsed.questions,
      blueprint: parsed.blueprint,
    };
  },
  runTool,
};
