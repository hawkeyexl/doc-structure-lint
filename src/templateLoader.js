import { readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { parse } from "yaml";
import { dereference } from "@apidevtools/json-schema-ref-parser";
import Ajv from "ajv";
import { schema } from "./schema.js";
import {getFile} from "./util/getFile.js";

const ajv = new Ajv({ useDefaults: true });

/**
 * Dereferences the provided template descriptions.
 *
 * This function attempts to dereference the given template descriptions using the `dereference` function.
 * If an error occurs during the dereferencing process, it handles the error by calling `handleFatalError`.
 *
 * @param {Object} templateDescriptions - The template descriptions to be dereferenced.
 * @returns {Promise<Object>} A promise that resolves to the dereferenced template descriptions.
 * @throws Will throw an error if the dereferencing process fails.
 */
async function dereferenceTemplates(templateDescriptions) {
  try {
    return await dereference(templateDescriptions);
  } catch (error) {
    throw new Error("Failed to dereference template schemas", {message: error});
  }
}

/**
 * Validates the provided template descriptions against a predefined schema.
 *
 * @param {Object} templateDescriptions - An object containing the templates to be validated.
 * @param {Object} templateDescriptions.templates - The templates to be validated.
 * @throws Will throw an error if a template is invalid.
 * @returns {Object} The validated templates.
 */
function validateTemplates(templateDescriptions) {
  const validateTemplate = ajv.compile(schema);

  for (const templateName in templateDescriptions.templates) {
    const template = { [templateName]: templateDescriptions.templates[templateName] };
    if (!validateTemplate(template)) {
      throw new Error("Template is invalid", { message: JSON.stringify(validateTemplate.errors) });
    }
  }
  
  return templateDescriptions.templates;
}

/**
 * Loads and validates templates from the specified file path.
 *
 * @param {string} templatesFilePath - The path to the templates file.
 * @returns {Promise<Object>} A promise that resolves to the validated templates.
 */
export async function loadAndValidateTemplates(templatesFilePath) {
  const fetchedFile = await getFile(templatesFilePath);
  if (fetchedFile.result === "error") {
    throw new Error("Error reading template file");
  }
  const dereferencedTemplates = await dereferenceTemplates(fetchedFile.content);
  return validateTemplates(dereferencedTemplates);
}
