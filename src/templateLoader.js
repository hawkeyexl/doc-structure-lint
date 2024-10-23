import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "yaml";
import { dereference } from "@apidevtools/json-schema-ref-parser";
import Ajv from "ajv";
import { schema } from "./schema.js";

const ajv = new Ajv({useDefaults: true});

export async function loadAndValidateTemplates() {
  let templateDescriptions = parse(
    readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates.yaml"),
      "utf8"
    )
  );

  templateDescriptions = await dereference(templateDescriptions);

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
