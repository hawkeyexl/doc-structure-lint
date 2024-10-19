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
  type: "object",
  additionalProperties: false,
  patternProperties: {
    "^[A-Za-z-_]+$": {
      $ref: "#/definitions/section",
    }
  },
  definitions: {
    section: {
      description: "A section of a document demarkated by a heading",
      type: "object",
      additionalProperties: false,
      properties: {
        description: {
          description: "Description of the section",
          type: "string",
        },
        title: {
          description: "Exact title of the section",
          type: "string",
        },
        required: {
          description: "Whether the section is required",
          type: "boolean",
          default: true,
        },
        paragraphs: {
          type: "object",
          properties: {
            min: {
              description: "Minimum number of paragraphs",
              type: "integer",
              minimum: 0,
            },
            max: {
              description: "Maximum number of paragraphs",
              type: "integer",
            },
          },
        },
        code_blocks: {
          description: "Code block requirements",
          type: "object",
          properties: {
            min: {
              description: "Minimum number of code blocks",
              type: "integer",
              minimum: 0,
            },
            max: {
              description: "Maximum number of code blocks",
              type: "integer",
            },
          },
        },
        additionalSections: {
          description: "Allow undefined sections",
          type: "boolean",
          default: false,
        },
        sections: {
          description: "Array of subsections",
          type: "object",
          patternProperties: {
            "^[A-Za-z-_]+": {
              anyOf: [
                { $ref: "#/definitions/section" },
              ],
            },
          },
        },
      },
    },
  },
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

// for (const [key, value] of Object.entries(templateDescriptions.templates)) {
//   console.log(JSON.stringify(value, null, 2));
//   if (!validateTemplate(value)) {
//     console.error(`Template "${key}" is invalid:`, validateTemplate.errors);
//     process.exit(1);
//   }
// }

process.exit();
function parseMarkdown(content) {
  const tokens = md.parse(content, {});
  const sections = [];
  let currentSection = null;

  for (const token of tokens) {
    if (token.type === "heading_open") {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: "",
        level: parseInt(token.tag.slice(1)),
        paragraphs: 0,
        code_blocks: 0,
        subsections: [],
      };
    } else if (
      token.type === "inline" &&
      currentSection &&
      !currentSection.title
    ) {
      currentSection.title = token.content;
    } else if (token.type === "paragraph_open") {
      currentSection.paragraphs++;
    } else if (token.type === "fence") {
      currentSection.code_blocks++;
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return organizeHierarchy(sections);
}

function organizeHierarchy(sections) {
  const root = { subsections: [] };
  const stack = [root];

  for (const section of sections) {
    while (stack.length > 1 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    parent.subsections.push(section);
    stack.push(section);
  }

  return root.subsections[0];
}

function validateStructure(section, template, path = []) {
  const errors = [];

  // Check title
  if (template.title && section.title !== template.title) {
    errors.push(
      `${path.join(" > ")}: Expected title "${template.title}", but found "${
        section.title
      }"`
    );
  }

  // Check paragraphs
  if (template.paragraphs) {
    if (
      template.paragraphs.min &&
      section.paragraphs < template.paragraphs.min
    ) {
      errors.push(
        `${path.join(" > ")}: Expected at least ${
          template.paragraphs.min
        } paragraphs, but found ${section.paragraphs}`
      );
    }
    if (
      template.paragraphs.max &&
      section.paragraphs > template.paragraphs.max
    ) {
      errors.push(
        `${path.join(" > ")}: Expected at most ${
          template.paragraphs.max
        } paragraphs, but found ${section.paragraphs}`
      );
    }
  }

  // Check code blocks
  if (template.code_blocks) {
    if (
      template.code_blocks.min &&
      section.code_blocks < template.code_blocks.min
    ) {
      errors.push(
        `${path.join(" > ")}: Expected at least ${
          template.code_blocks.min
        } code blocks, but found ${section.code_blocks}`
      );
    }
    if (
      template.code_blocks.max &&
      section.code_blocks > template.code_blocks.max
    ) {
      errors.push(
        `${path.join(" > ")}: Expected at most ${
          template.code_blocks.max
        } code blocks, but found ${section.code_blocks}`
      );
    }
  }

  // Check subsections
  if (template.sections) {
    const expectedSections = new Set(
      template.sections.map((s) => Object.keys(s)[0])
    );
    const foundSections = new Set(section.subsections.map((s) => s.title));

    for (const expectedSection of expectedSections) {
      if (
        !foundSections.has(expectedSection) &&
        template.sections.find((s) => s[expectedSection].required !== false)
      ) {
        errors.push(
          `${path.join(" > ")}: Missing required section "${expectedSection}"`
        );
      }
    }

    if (!template.additional_sections) {
      for (const foundSection of foundSections) {
        if (!expectedSections.has(foundSection)) {
          errors.push(
            `${path.join(" > ")}: Unexpected section "${foundSection}"`
          );
        }
      }
    }

    for (const subsection of section.subsections) {
      const subsectionTemplate = template.sections.find(
        (s) => s[subsection.title]
      );
      if (subsectionTemplate) {
        errors.push(
          ...validateStructure(
            subsection,
            subsectionTemplate[subsection.title],
            [...path, subsection.title]
          )
        );
      }
    }
  }

  return errors;
}

function lintMarkdown(content, template) {
  const structure = parseMarkdown(content);
  return validateStructure(structure, template.templates[0]["How-to"]);
}

// Parse command-line arguments
const argv = yargs(hideBin(process.argv))
  .option("file", {
    alias: "f",
    description: "Path to the markdown file to lint",
    type: "string",
    demandOption: true,
  })
  .help()
  .alias("help", "h").argv;

// Read and lint the markdown file
const markdownContent = readFileSync(argv.file, "utf8");
const errors = lintMarkdown(markdownContent, template);

if (errors.length > 0) {
  console.log("Structure violations found:");
  errors.forEach((error) => console.log(`- ${error}`));
  process.exit(1);
} else {
  console.log("No structure violations found.");
}
