import { ValidationError } from "./ValidationError.js";

export function validateCodeBlocks(section, template) {
  const errors = [];

  if (!template.code_blocks || !section.codeBlocks) return errors;

  // Min
  if (template.code_blocks.min && section.codeBlocks.length < template.code_blocks.min) {
    errors.push(new ValidationError(
      "code_blocks_count_error",
      section.heading?.content,
      `Expected at least ${template.code_blocks.min} code blocks, but found ${section.codeBlocks.length}`,
      section.position
    ));
  }

  // Max
  if (template.code_blocks.max && section.codeBlocks.length > template.code_blocks.max) {
    errors.push(new ValidationError(
      "code_blocks_count_error",
      section.heading?.content,
      `Expected at most ${template.code_blocks.max} code blocks, but found ${section.codeBlocks.length}`,
      section.position
    ));
  }

  return errors;
}
