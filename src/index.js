#!/usr/bin/env node

import { readFileSync, statSync, readdirSync } from "fs";
import path from "path";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { loadAndValidateTemplates } from "./templateLoader.js";
import { parseMarkdown } from "./parsers/markdown.js";
import { parseAsciiDoc } from "./parsers/asciidoc.js";
import { validateStructure } from "./rules/structureValidator.js";
import { getFile } from "./util/getFile.js";

const inferFileType = (filePath, content) => {
  const extension = path.extname(filePath).toLowerCase();
  if ([".md", ".markdown"].includes(extension)) {
    return "markdown";
    // } else if ([".adoc", ".asciidoc"].includes(extension)) {
    //   return "asciidoc";
  }

  // If extension is not conclusive, check content
  // if (content.trim().startsWith("= ")) {
  //   return "asciidoc";
  // }

  // Default to markdown if unable to determine
  return "markdown";
};

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    return false;
  }
};

const getSupportedFiles = (dirPath) => {
  const files = [];
  const items = readdirSync(dirPath);

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    if (isDirectory(fullPath)) {
      files.push(...getSupportedFiles(fullPath));
    } else {
      const extension = path.extname(fullPath).toLowerCase();
      if ([".md", ".markdown"].includes(extension)) {
        files.push(fullPath);
      }
    }
  }

  return files;
};

/**
 * Lints a document against a specified template.
 *
 * @param {Object} params - The parameters for the linting function.
 * @param {string} params.file - The path to the file to be linted.
 * @param {string} params.templatePath - The path to the directory containing templates.
 * @param {string} params.template - The name of the template to use for linting.
 * @returns {Promise<Object>} The result of the linting process.
 * @returns {boolean} returns.success - Indicates if the linting was successful.
 * @returns {Array} returns.errors - An array of errors found during linting.
 * @throws {Error} If the file type is unsupported or the template is not found.
 */
export async function lintDocument({ file, templatePath, template }) {
  let templates;
  try {
    templates = await loadAndValidateTemplates(templatePath);
  } catch (error) {
    throw new Error(`Failed to load and validate templates: ${error.message}`);
  }
  let fetchedFile;
  try {
    fetchedFile = await getFile(file);
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
  const fileType = inferFileType(file, fetchedFile.content);

  let structure;
  if (fileType === "markdown") {
    structure = parseMarkdown(fetchedFile.content);
    // } else if (fileType === "asciidoc") {
    //   structure = parseAsciiDoc(fetchedFile);
  } else {
    throw new Error(`Unsupported file type: ${fileType}`);
  }

  const templateConfig = templates[template];
  if (!templateConfig) {
    throw new Error(`Template "${template}" not found`);
  }

  const errors = await validateStructure(structure, templateConfig);
  return {
    success: errors.length === 0,
    errors: errors,
  };
}

async function main() {
  // Parse command-line arguments
  const argv = yargs(hideBin(process.argv))
    .option("file-path", {
      alias: "f",
      description: "Path to the file (or directory of files) to lint",
      type: "string",
      demandOption: true,
    })
    .option("template-path", {
      alias: "p",
      description: "Path to the file containing the templates",
      type: "string",
      default: "./templates.yaml",
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

  try {
    const filePath = argv.filePath;
    let results = [];

    let files = [];
    if (isDirectory(filePath)) {
      files.push(...getSupportedFiles(filePath));
    } else {
      files.push(filePath);
    }

    if (files.length === 0) {
      console.log("No supported files found.");
      process.exit(1);
    }

    for (const file of files) {
      const result = await lintDocument({
        file,
        templatePath: argv.templatePath,
        template: argv.template,
      });
      results.push({ file, ...result });
    }

    if (argv.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      let hasErrors = false;
      results.forEach(({ file, errors }) => {
        console.log(file);
        if (errors.length > 0) {
          hasErrors = true;
          errors.forEach((error) =>
            console.log(
              `- [${error.type}] ${error.heading} (start: ${error.position.start.offset}, end: ${error.position.end.offset}): ${error.message}`
            )
          );
          process.exitCode = 1;
        } else {
          console.log("  Validation successful! 🎉");
        }
      });

    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

// Only run main() if this file is being executed directly
if (
  process.argv[1].endsWith("doc-structure-lint") ||
  process.argv[1].endsWith("doc-structure-lint/src/index.js") ||
  process.argv[1].endsWith("doc-structure-lint\\src\\index.js")
) {
  main();
}
