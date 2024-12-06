#!/usr/bin/env node

import { prepareModel } from "../rules/instructionValidator.js";
import { getLlama } from "node-llama-cpp";

// Preload the Llama model unless the environment variable is set to 0
if (process.env.DOC_STRUCTURE_LINT_PRELOAD != 0) {
  (async () => {
    const llama = await getLlama();
    await prepareModel(llama);
  })();
}
