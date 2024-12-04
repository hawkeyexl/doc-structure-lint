import { validateHeading } from "./headingValidator.js";
import { validateParagraphs } from "./paragraphsValidator.js";
import { validateCodeBlocks } from "./codeBlocksValidator.js";
import { validateLists } from "./listValidator.js";
import { validateSequence } from "./sequenceValidator.js";
import { validateSubsections } from "./subsectionValidator.js";

export function validateStructure(structure, template) {
  let errors = [];

  // TODO: Check frontmatter

  // Check sections
  if (template.sections && structure.sections) {
    for (let i = 0; i < Object.keys(template.sections).length; i++) {
      const templateKey = Object.keys(template.sections)[i];
      const templateSection = template.sections[templateKey];
      const structureSection = structure.sections[i];

      errors = errors.concat(
        validateSection(structureSection, templateSection)
      );
    }
  }

  return errors;
}

export function validateSection(structureSection, templateSection) {
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

  // Check subsections
  if (templateSection.sections) {
    errors = errors.concat(
      validateSubsections(structureSection, templateSection)
    );
  }

  return errors;
}
