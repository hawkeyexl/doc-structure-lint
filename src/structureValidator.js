import { validateHeading } from './rules/headingValidator.js';
import { validateParagraphs } from './rules/paragraphsValidator.js';
import { validateCodeBlocks } from './rules/codeBlocksValidator.js';
import { validateSubsections } from './rules/subsectionsValidator.js';

// Evaluate a document object (or sub-object) against a template
export function validateStructure(structure, template, path = []) {
  let errors = [];

  // Check heading
  const headingError = validateHeading(structure, template);
  if (headingError) errors.push(headingError);

  // Check paragraphs
  errors = errors.concat(validateParagraphs(structure, template));

  // Check code blocks
  errors = errors.concat(validateCodeBlocks(structure, template));

  // Check subsections
  errors = errors.concat(validateSubsections(structure, template, validateStructure));

  return errors;
}
