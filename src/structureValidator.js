import { validateHeading } from "./rules/headingValidator.js";
import { validateParagraphs } from "./rules/paragraphsValidator.js";
import { validateCodeBlocks } from "./rules/codeBlocksValidator.js";
import { validateSubsections } from "./rules/subsectionsValidator.js";

// Evaluate a template against a document
export function validateStructure(structure, template) {
  let errors = [];

  // TODO: Check frontmatter

  // Check sections
  if (template.sections && structure.sections) {
    for (let i = 0; i < Object.keys(template.sections).length; i++) {
      const templateKey = Object.keys(template.sections)[i];
      const templateSection = template.sections[templateKey];
      const structureSection = structure.sections[i];

      // Check heading
      if (templateSection.heading && structureSection.heading) {
        errors = errors.concat(
          validateHeading(structureSection, templateSection)
        );
      }

      // Check paragraphs
      if (templateSection.paragraphs && structureSection.paragraphs) {
        errors = errors.concat(validateParagraphs(structure, template));
      }

      // Check code blocks
      if (templateSection.code_blocks && structureSection.codeBlocks) {
        errors = errors.concat(validateCodeBlocks(structure, template));
      }

      // Check subsections
      if (templateSection.sections) {
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
            !structureSection.additionalSections)
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
          structureSection.additionalSections
        ) {
          // For each section in the template, identify if it exists in the structure and which structure section it corresponds to
          const sectionMap = {};
          for (let j = 0; j < Object.keys(templateSection.sections).length; j++) {
            const templateSubsection = templateSection.sections[
              Object.keys(templateSection.sections)[j]
            ];
            for (let k = 0; k < structureSection.sections.length; k++) {
              const structureSubsection = structureSection.sections[k];
              if (
                validateHeading(structureSubsection, templateSubsection).length ===
                0
              ) {
                sectionMap[j] = k;
                break;
              }
            }
            // If the section doesn't exist in the structure, add an error
            if (!sectionMap[j]) {
              errors.push({
                type: "missing_section",
                section: templateKey,
                message: `Missing section ${Object.keys(
                  templateSection.sections
                )[j]}`,
              });
            }
          }
        } else {
          errors = errors.concat(
            validateStructure(structureSection, templateSection)
          );
        }
      }
    }
  }
  return errors;
}
