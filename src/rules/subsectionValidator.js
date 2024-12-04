import { ValidationError } from "./ValidationError.js";
import { validateSection } from "./structureValidator.js";

/**
 * Checks for missing subsections in a given structure section based on a template section.
 *
 * @param {Object} structureSection - The structure section to validate.
 * @param {Object} templateSection - The template section to validate against.
 * @param {Object} [structureSection.sections] - The subsections of the structure section.
 * @param {Object} templateSection.sections - The subsections of the template section.
 * @param {boolean} templateSection.sections[].required - Indicates if the subsection is required.
 * @param {string} [structureSection.heading.content] - The heading content of the structure section.
 * @param {Object} structureSection.position - The position of the structure section in the document.
 * @returns {ValidationError|null} Returns a ValidationError if a required subsection is missing, otherwise null.
 */
function checkMissingSubsections(structureSection, templateSection) {
  if (!structureSection.sections) {
    const allOptional = Object.values(templateSection.sections).every(
      (subsection) => !subsection.required
    );
    if (!allOptional) {
      return new ValidationError(
        "missing_section",
        structureSection.heading?.content,
        `Missing section ${Object.keys(templateSection.sections)[0]}`,
        structureSection.position
      );
    }
  }
  return null;
}

/**
 * Validates the number of subsections in a given structure section against a template section.
 *
 * @param {Object} structureSection - The section of the structure to validate.
 * @param {Object} templateSection - The template section to validate against.
 * @param {Object} templateSection.sections - The subsections defined in the template.
 * @param {boolean} [templateSection.additionalSections] - Whether additional sections are allowed.
 * @returns {ValidationError|null} - Returns a ValidationError if the subsection count does not match the template requirements, otherwise null.
 */
function checkSubsectionCount(structureSection, templateSection) {
  const requiredCount = Object.values(templateSection.sections).filter(
    (subsection) => subsection.required
  ).length;
  const optionalCount =
    Object.keys(templateSection.sections).length - requiredCount;
  const actualCount = structureSection.sections.length;

  if (
    actualCount < requiredCount ||
    (actualCount > requiredCount + optionalCount &&
      !templateSection.additionalSections)
  ) {
    return new ValidationError(
      "section_count_mismatch",
      structureSection.heading?.content,
      `Expected between ${requiredCount} and ${
        requiredCount + optionalCount
      } sections, but found ${actualCount}`,
      structureSection.position
    );
  }
  return null;
}

/**
 * Validates additional sections in a structure against a template.
 *
 * @param {Object} structureSection - The structure section to validate.
 * @param {Object} templateSection - The template section to validate against.
 * @param {Object} templateSection.sections - The subsections of the template.
 * @param {boolean} templateSection.sections[].required - Indicates if the subsection is required.
 * @param {string} [structureSection.heading.content] - The heading content of the structure section.
 * @param {Array} structureSection.sections - The subsections of the structure section.
 * @param {Object} structureSection.position - The position of the structure section.
 * @returns {Array} An array of ValidationError objects if there are validation errors, otherwise an empty array.
 */
function validateAdditionalSections(structureSection, templateSection) {
  const errors = [];
  const sectionMap = {};

  for (let j = 0; j < Object.keys(templateSection.sections).length; j++) {
    const templateKey = Object.keys(templateSection.sections)[j];
    const templateSubsection = templateSection.sections[templateKey];

    let sectionFound = false;
    // Iterate through each subsection in the structure section
    for (let k = 0; k < structureSection.sections.length; k++) {
      // Validate the current subsection against the template subsection
      if (
        validateSection(structureSection.sections[k], templateSubsection)
          .length === 0
      ) {
        // If the subsection is valid, add it to the section map
        if (!sectionMap[j]) sectionMap[j] = [];
        sectionMap[j].push(k);
        sectionFound = true;
      }
    }

    if (!sectionFound && templateSubsection.required) {
      errors.push(
        new ValidationError(
          "missing_section",
          structureSection.heading?.content,
          `Missing section ${templateKey}`,
          structureSection.position
        )
      );
    }
  }

  return errors;
}

/**
 * Validates that the required subsections in the structure match the template.
 *
 * @param {Object} structureSection - The section of the structure to validate.
 * @param {Object} templateSection - The section of the template to validate against.
 * @returns {Array} An array of error messages, if any.
 */
function validateRequiredSubsections(structureSection, templateSection) {
  const errors = [];

  for (let i = 0; i < structureSection.sections.length; i++) {
    const structureSubsection = structureSection.sections[i];
    const templateSubsection =
      templateSection.sections[Object.keys(templateSection.sections)[i]];
    errors.push(...validateSection(structureSubsection, templateSubsection));
  }

  return errors;
}

/**
 * Validates the subsections of a given structure section against a template section.
 *
 * @param {Object} structureSection - The structure section to validate.
 * @param {Object} templateSection - The template section to validate against.
 * @returns {Array} An array of error messages, if any.
 */
export function validateSubsections(structureSection, templateSection) {
  const errors = [];
  if (!templateSection.sections) return errors;

  const missingError = checkMissingSubsections(
    structureSection,
    templateSection
  );
  if (missingError) {
    errors.push(missingError);
    return errors;
  }

  const countError = checkSubsectionCount(structureSection, templateSection);
  if (countError) {
    errors.push(countError);
    return errors;
  }

  if (
    structureSection.sections.length >
      Object.keys(templateSection.sections).length &&
    templateSection.additionalSections
  ) {
    errors.push(
      ...validateAdditionalSections(structureSection, templateSection)
    );
  } else {
    errors.push(
      ...validateRequiredSubsections(structureSection, templateSection)
    );
  }

  return errors;
}
