import { readFileSync } from "fs";
import path from "path";
import { parse } from "yaml";
import { dereference } from "@apidevtools/json-schema-ref-parser";
import Ajv from "ajv";
import { schema } from "./schema.js";

const ajv = new Ajv({ useDefaults: true });

/**
 * Parses a template file from the given file path.
 *
 * @param {string} filePath - The path to the template file.
 * @returns {Object} The parsed content of the template file.
 * @throws Will throw an error if the file cannot be read or if the content is invalid.
 */
function parseTemplateFile(filePath) {
  try {
    return parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Template file not found: ${filePath}`, {message: error});
    } else if (error.name === "YAMLException") {
      throw new Error("Invalid YAML in template file", {message: error});
    } else if (error.name === "SyntaxError") {
      throw new Error("Invalid JSON in template file", {message: error});
    }
    throw new Error("Error reading template file", {message: error});
  }
}

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
  const rawTemplates = parseTemplateFile(templatesFilePath);
  const dereferencedTemplates = await dereferenceTemplates(rawTemplates);
  return validateTemplates(dereferencedTemplates);
}
