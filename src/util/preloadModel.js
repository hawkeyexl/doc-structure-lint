#!/usr/bin/env node

import { prepareModel } from "../rules/instructionValidator.js";
import { getLlama } from "node-llama-cpp";

// Preload the Llama model if the environment variable is set to something other than 0
if (
  typeof process.env.DOC_STRUCTURE_LINT_PRELOAD !== "undefined" &&
  process.env.DOC_STRUCTURE_LINT_PRELOAD != 0
) {
  (async () => {
    const llama = await getLlama();
    await prepareModel(llama);
  })();
}
