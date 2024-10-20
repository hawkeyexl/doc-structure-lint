import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";
import MarkdownIt from "markdown-it";
import Ajv from "ajv";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { parse } from "yaml";
import { dereference } from "@apidevtools/json-schema-ref-parser";

const md = new MarkdownIt();
const ajv = new Ajv();

const schema = {
  // ... (schema definition remains unchanged)
};

// Load and parse the template
let templateDescriptions = parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "templates.yaml"),
    "utf8"
  )
);

templateDescriptions = await dereference(templateDescriptions);

// Validate the template against the schema
const validateTemplate = ajv.compile(schema);

for (const templateName in templateDescriptions.templates) {
  const template = {};
  template[templateName] = templateDescriptions.templates[templateName];
  if (!validateTemplate(template)) {
    console.error(JSON.stringify(template));
    console.error(`Template is invalid:`, validateTemplate.errors);
    process.exit(1);
  }
}

function parseMarkdown(content) {
  // ... (parseMarkdown function remains unchanged)
}

function organizeHierarchy(sections) {
  // ... (organizeHierarchy function remains unchanged)
}

function validateStructure(section, template, path = []) {
  // ... (validateStructure function remains unchanged)
}

function lintMarkdown(content, templateName) {
  const structure = parseMarkdown(content);
  const template = templateDescriptions.templates[templateName];
  if (!template) {
    throw new Error(`Template "${templateName}" not found`);
  }
  return validateStructure(structure, template);
}

// Main function to be exported
export function markdownStructureLinter(markdownContent, templateName, outputFormat = 'text') {
  const errors = lintMarkdown(markdownContent, templateName);
  
  if (outputFormat === 'json') {
    return {
      success: errors.length === 0,
      errors: errors,
    };
  } else {
    if (errors.length > 0) {
      return errors.map(error => `[${error.head}] (start: ${error.startIndex}, end: ${error.endIndex}): ${error.message}`).join('\n');
    } else {
      return "No structure violations found.";
    }
  }
}

// CLI functionality
if (import.meta.url === `file://${process.argv[1]}`) {
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

  const markdownContent = readFileSync(argv.file, "utf8");
  const result = markdownStructureLinter(markdownContent, argv.template, argv.json ? 'json' : 'text');

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result);
    if (result !== "No structure violations found.") {
      process.exit(1);
    }
  }
}
