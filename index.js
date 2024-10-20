import { readFileSync } from "fs";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { loadAndValidateTemplates } from "./src/templateLoader.js";
import { parseMarkdown } from "./src/markdownParser.js";
import { validateStructure } from "./src/structureValidator.js";

async function main() {
  const templates = await loadAndValidateTemplates();

  // Parse command-line arguments
  const argv = yargs(hideBin(process.argv))
    .option("file", {
      alias: "f",
      description: "Path to the markdown file to lint",
      type: "string",
      demandOption: true,
    })
    .option("template", {
      alias: "t",
      description: "Name of the template to use",
      type: "string",
      demandOption: true,
    })
    .option("json", {
      description: "Output results in JSON format",
      type: "boolean",
      default: false,
    })
    .help()
    .alias("help", "h").argv;

  // Read and lint the markdown file
  const markdownContent = readFileSync(argv.file, "utf8");
  const structure = parseMarkdown(markdownContent);
  const template = templates[argv.template];
  
  if (!template) {
    throw new Error(`Template "${argv.template}" not found`);
  }
  
  const errors = validateStructure(structure, template);

  if (argv.json) {
    // Output results in JSON format
    const result = {
      success: errors.length === 0,
      errors: errors,
    };
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Output results in text format
    if (errors.length > 0) {
      console.log("Structure violations found:");
      errors.forEach((error) => console.log(`- [${error.head}] (start: ${error.startIndex}, end: ${error.endIndex}): ${error.message}`));
      process.exit(1);
    } else {
      console.log("No structure violations found.");
    }
  }
}

main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
