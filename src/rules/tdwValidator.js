import { fileURLToPath } from "url";
import path from "path";
import { getLlama, LlamaChatSession } from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const llama = await getLlama();
const model = await llama.loadModel({
  modelPath: path.join(
    process.cwd(),
    "models",
    "Phi-3.5-mini-instruct.Q4_K_S.gguf"
  ),
});
const context = await model.createContext();
const session = new LlamaChatSession({
  contextSequence: context.getSequence(),
  systemPrompt:
    "You are a technical editor who evaluates rules against sections of a document. Evaluate the supplied rule against the given section. Output your results as JSON.",
});
const grammar = await llama.createGrammarForJsonSchema({
  type: "object",
  properties: {
    assessment: {
      description: "The result of the evaluation",
      type: "string",
      enum: ["pass", "fail"],
    },
    evaluation: {
      description: "Only populated if 'evaluation' is 'fail'. Suggestions for improvement, if any.",
      type: "string",
      maxLength: 500,
    },
  },
});

const rule = `This section should mention all three primary colors.`;
const content = `My favorite colors are red, yellow, and blue.`;
const input = { rule, content };
console.log(input);

const response = await session.prompt(JSON.stringify(input), { grammar });
console.log(JSON.parse(response));
