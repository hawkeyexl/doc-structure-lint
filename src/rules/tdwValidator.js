import os from "os";
import fs from "fs";
import path from "path";
import { getLlama, LlamaChatSession, resolveModelFile } from "node-llama-cpp";

// Create a temporary directory for the model
const dir = path.join(os.tmpdir(), "doc-structure-lint", "models");
// Recursively create the directory if it doesn't exist
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Clean up any files in the directory that aren't expected
const expectedFiles = [
    "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
]
fs.readdirSync(dir).forEach((file) => {
  if (!expectedFiles.includes(file)) {
    fs.unlinkSync(path.join(dir, file));
    }
});

// Resolve the model path, downloading if necessary
await resolveModelFile(
  "hf:bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  { directory: dir, fileName: "Llama-3.2-3B-Instruct-Q4_K_M.gguf" }
);

const llama = await getLlama();
const model = await llama.loadModel({
  modelPath: path.join(dir, "Llama-3.2-3B-Instruct-Q4_K_M.gguf"),
});
const context = await model.createContext();
const session = new LlamaChatSession({
  contextSequence: context.getSequence(),
  systemPrompt:
    "You are a technical editor who evaluates rules against sections of a document. Evaluate the supplied rule against the given section. Output your results as JSON.",
});
const grammar = await llama.createGrammarForJsonSchema({
  type: "object",
  required: ["assessment"],
  properties: {
    assessment: {
      description: "The result of the evaluation",
      type: "string",
      enum: ["pass", "fail"],
    },
    explanation: {
      description: "Suggestions for improvement, if any.",
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
const parsedResponse = grammar.parse(response);
console.log(parsedResponse);
