import path from "path";
import { getLlama, LlamaChatSession, resolveModelFile } from "node-llama-cpp";
import { ValidationError } from "./ValidationError.js";
import { getTempDir, cleanTempDir } from "../util/tempDir.js";

/**
 * Prepares and loads a Llama model.
 *
 * This function creates a temporary directory for the model, cleans up any
 * unexpected files in the directory, resolves the model file by downloading
 * it if necessary, and then loads the model.
 *
 * @param {Object} llama - The Llama instance used to load the model.
 * @returns {Promise<Object>} - A promise that resolves to the loaded model.
 */
export async function prepareModel(llama) {
  try {
    // Create a temporary directory for the model
    const dir = getTempDir();

    // Clean up any files in the directory that aren't expected
    const expectedFiles = ["Llama-3.2-3B-Instruct-Q4_K_M.gguf"];
    cleanTempDir(expectedFiles);

    // Resolve the model path, downloading if necessary
    await resolveModelFile(
      "hf:bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
      { directory: dir, fileName: "Llama-3.2-3B-Instruct-Q4_K_M.gguf" }
    );

    const model = await llama.loadModel({
      modelPath: path.join(dir, "Llama-3.2-3B-Instruct-Q4_K_M.gguf"),
    });

    return model;
  } catch (error) {
    console.error("Error preparing the model:", error);
    throw error;
  }
}

/**
 * Prepares a grammar for JSON schema validation.
 *
 * @param {Object} llama - The object that provides the createGrammarForJsonSchema method.
 * @returns {Promise<Object>} A promise that resolves to the created grammar object.
 */
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

/**
 * Validates the given instruction against the provided content using the specified model and grammar.
 *
 * @param {Object} model - The model used to create a context for validation.
 * @param {Object} grammar - The grammar rules used for parsing the response.
 * @param {string} instruction - The instruction to be validated.
 * @param {string} content - The content to be evaluated against the instruction.
 * @returns {Promise<Object|null>} - Returns the parsed response if the assessment fails, otherwise returns null.
 */
async function validateInstruction(model, grammar, instruction, content) {
  const context = await model.createContext();
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt:
      "You are a technical editor who evaluates instructions against sections of a document. Evaluate if the supplied content follows the specified instruction. Output your results as JSON.",
  });
  const input = { instruction, content };
  const response = await session.prompt(JSON.stringify(input), { grammar });
  const parsedResponse = grammar.parse(response);
  await context.dispose();
  await session.dispose();
  if (parsedResponse.assessment === "fail") return parsedResponse;
  return null;
}

/**
 * Validates the instructions in a given section against a template.
 *
 * @param {Object} section - The section containing the raw content and heading.
 * @param {Object} template - The template containing the instructions to validate against.
 * @returns {Promise<Array>} A promise that resolves to an array of validation errors.
 */
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
          `Instruction: ${instruction}${
            !instruction.endsWith(".") ? "." : ""
          } Explanation: ${error.explanation}`,
          section.position
        )
      );
    }
  }
  llama.dispose(); // Free up resources
  return errors;
}
