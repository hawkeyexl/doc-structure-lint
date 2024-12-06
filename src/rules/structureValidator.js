import { validateHeading } from "./headingValidator.js";
import { validateParagraphs } from "./paragraphsValidator.js";
import { validateCodeBlocks } from "./codeBlocksValidator.js";
import { validateLists } from "./listValidator.js";
import { validateSequence } from "./sequenceValidator.js";
import { validateInstructions } from "./instructionValidator.js";
import { validateSubsections } from "./subsectionValidator.js";

/**
 * Validates the structure of a given document against a template.
 *
 * @param {Object} structure - The structure of the document to be validated.
 * @param {Object} template - The template to validate the document against.
 * @param {Object} template.sections - The sections defined in the template.
 * @param {Object} structure.sections - The sections defined in the document structure.
 * @returns {Array} An array of error messages, if any.
 */
export async function validateStructure(structure, template) {
  let errors = [];

  // TODO: Check frontmatter

  // Check sections
  if (template.sections && structure.sections) {
    for (let i = 0; i < Object.keys(template.sections).length; i++) {
      const templateKey = Object.keys(template.sections)[i];
      const templateSection = template.sections[templateKey];
      const structureSection = structure.sections[i];

      errors = errors.concat(
        await validateSection(structureSection, templateSection)
      );
    }
  }

  return errors;
}

/**
 * Validates a structure section against a template section.
 *
 * @param {Object} structureSection - The structure section to validate.
 * @param {Object} templateSection - The template section to validate against.
 * @returns {Array} An array of error messages, if any.
 */
export async function validateSection(structureSection, templateSection) {
  let errors = [];

  // Check sequence if defined
  if (templateSection.sequence) {
    errors = errors.concat(validateSequence(structureSection, templateSection));
  }

  // Check heading
  if (templateSection.heading && structureSection.heading) {
    errors = errors.concat(validateHeading(structureSection, templateSection));
  }

  // Check paragraphs
  if (templateSection.paragraphs && structureSection.paragraphs) {
    errors = errors.concat(
      validateParagraphs(structureSection, templateSection)
    );
  }

  // Check code blocks
  if (templateSection.code_blocks && structureSection.codeBlocks) {
    errors = errors.concat(
      validateCodeBlocks(structureSection, templateSection)
    );
  }

  // Check lists
  if (templateSection.lists && structureSection.lists) {
    errors = errors.concat(validateLists(structureSection, templateSection));
  }

  // Check instructions
  if (templateSection.instructions) {
    errors = errors.concat(
      await validateInstructions(structureSection, templateSection)
    );
  }

  // Check subsections
  if (templateSection.sections) {
    errors = errors.concat(
      await validateSubsections(structureSection, templateSection)
    );
  }

  return errors;
}
