import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";
import { dereference } from "@apidevtools/json-schema-ref-parser";
import Ajv from "ajv";
import { schema } from "./schema.js";

const ajv = new Ajv({ useDefaults: true });

export async function loadAndValidateTemplates(templatesFilePath) {
  let templateDescriptions;

  try {
    templateDescriptions = parse(readFileSync(templatesFilePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Template file not found: ${templatesFilePath}`);
      process.exit(1);
    } else if (error.name === "YAMLException") {
      console.error(`Invalid YAML in template file: ${error.message}`);
      process.exit(1);
    } else if (error.name === "SyntaxError") {
      console.error(`Invalid JSON in template file: ${error.message}`);
      process.exit(1);
    }
    console.error(`Error reading template file: ${error.message}`);
    process.exit(1);
  }

  try {
    templateDescriptions = await dereference(templateDescriptions);
  } catch (error) {
    console.error(`Failed to dereference template schemas: ${error.message}`);
    process.exit(1);
  }

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

  return templateDescriptions.templates;
}
