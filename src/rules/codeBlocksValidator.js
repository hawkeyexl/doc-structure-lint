export function validateCodeBlocks(section, template) {
  const errors = [];

  if (template.code_blocks) {
    // Max
    if (
      template.code_blocks.min &&
      section.code_blocks.length < template.code_blocks.min
    ) {
      errors.push({
        head: section.title,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        message: `Expected at least ${template.code_blocks.min} code blocks, but found ${section.code_blocks}`,
      });
    }

    // Min
    if (
      template.code_blocks.max &&
      section.code_blocks.length > template.code_blocks.max
    ) {
      errors.push({
        head: section.title,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        message: `Expected at most ${template.code_blocks.max} code blocks, but found ${section.code_blocks}`,
      });
    }
  }

  return errors;
}
