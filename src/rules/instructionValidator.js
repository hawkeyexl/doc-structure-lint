import os from "os";
import fs from "fs";
import path from "path";
import { getLlama, LlamaChatSession, resolveModelFile } from "node-llama-cpp";
import { ValidationError } from "./ValidationError.js";

async function prepareModel(llama) {
  // Create a temporary directory for the model
  const dir = path.join(os.tmpdir(), "doc-structure-lint", "models");
  // Recursively create the directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Clean up any files in the directory that aren't expected
  const expectedFiles = ["Llama-3.2-3B-Instruct-Q4_K_M.gguf"];
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

  const model = await llama.loadModel({
    modelPath: path.join(dir, "Llama-3.2-3B-Instruct-Q4_K_M.gguf"),
  });

  return model;
}

async function prepareGrammar(llama) {
  return await llama.createGrammarForJsonSchema({
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
}

async function validateInstruction(model, grammar, instruction, content) {
  const context = await model.createContext();
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt:
      "You are a technical editor who evaluates instructions against sections of a document. Strictly evaluate if the supplied content follows the specified instruction. Output your results as JSON.",
  });
  const input = { instruction, content };
  const response = await session.prompt(JSON.stringify(input), { grammar });
  const parsedResponse = grammar.parse(response);
  await context.dispose();
  await session.dispose();
  if (parsedResponse.assessment === "fail") return parsedResponse;
  return null;
}

export async function validateInstructions(section, template) {
  const errors = [];
  if (!template.instructions) return errors;

  const llama = await getLlama(); // TODO: Figure out how to silence the terminal output, then move to top of file
  const model = await prepareModel(llama);
  const grammar = await prepareGrammar(llama);

  for (const index in template.instructions) {
    const instruction = template.instructions[index];
    const error = await validateInstruction(
      model,
      grammar,
      instruction,
      section.rawContent
    );
    if (error) {
      errors.push(
        new ValidationError(
          "instruction_error",
          section.heading.content,
          `Instruction: ${instruction}${!instruction.endsWith(".") ? "." : ""} Explanation: ${error.explanation}`,
          section.position
        )
      );
    }
  }
  return errors;
}

// (async () => {
//   const section = {
//     rawContent: "My favorite colors are red, yellow, and blue.",
//     heading: {
//       content: "Colors",
//     },
//     position: {
//       start: { offset: 0 },
//       end: { offset: 10 },
//     },
//   };
//   const template = {
//     instructions: [
//       "Mention all three primary colors.",
//       "Descibe secondary colors.",
//       "Explain the difference between primary and secondary colors.",
//     ],
//   };
//   const errors = await validateInstructions(section, template);
//   console.log(errors);
// })();
