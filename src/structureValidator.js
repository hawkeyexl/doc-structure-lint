import { validateHeading } from "./rules/headingValidator.js";
import { validateParagraphs } from "./rules/paragraphsValidator.js";
import { validateCodeBlocks } from "./rules/codeBlocksValidator.js";
import { validateLists } from "./rules/listValidator.js";
import { validateSequence } from "./rules/sequenceValidator.js";

export { validateStructure, validateSection };

// Evaluate a template against a document
function validateStructure(structure, template) {
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

function validateSection(structureSection, templateSection) {
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
    const templateKey = Object.keys(templateSection.sections)[0];
    if (!structureSection.sections) {
      // Check for missing sections
      errors.push({
        type: "missing_section",
        section: templateKey,
        message: `Missing section ${templateKey}`,
      });
    } else if (
      // Check for section count mismatch
      structureSection.sections.length <
        Object.keys(templateSection.sections).length ||
      (structureSection.sections.length >
        Object.keys(templateSection.sections).length &&
        !templateSection.additionalSections)
    ) {
      errors.push({
        type: "section_count_mismatch",
        section: templateKey,
        message: `Expected ${
          Object.keys(templateSection.sections).length
        } sections, but found ${structureSection.sections.length}`,
      });
    } else if (
      // Check for additional sections
      structureSection.sections.length >
        Object.keys(templateSection.sections).length &&
      templateSection.additionalSections
    ) {
      // For each section in the template, identify if it exists in the structure and which structure section it corresponds to
      const sectionMap = {};
      for (let j = 0; j < Object.keys(templateSection.sections).length; j++) {
        const templateKey = Object.keys(templateSection.sections)[j];
        const templateSubsection = templateSection.sections[templateKey];
        for (let k = 0; k < structureSection.sections.length; k++) {
          const structureSubsection = structureSection.sections[k];
          if (
            validateSection(structureSubsection, templateSubsection).length ===
            0
          ) {
            if (!sectionMap[j]) sectionMap[j] = [];
            sectionMap[j].push(k);
          }
        }
        // If the section doesn't exist in the structure, add an error
        if (!sectionMap[j] && templateSubsection.required) {
          errors.push({
            type: "missing_section",
            section: templateKey,
            message: `Missing section ${templateKey}`,
          });
        }
      }
    } else {
      // Check subsections
      for (let l = 0; l < structureSection.sections.length; l++) {
        const structureSubsection = structureSection.sections[l];
        const templateSubsection =
          templateSection.sections[Object.keys(templateSection.sections)[l]];
        errors = errors.concat(
          validateSection(structureSubsection, templateSubsection)
        );
      }
    }
  }

  return errors;
}
