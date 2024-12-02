export function validateCodeBlocks(section, template) {
  const errors = [];

  if (template.code_blocks) {
    // Max
    if (
      template.code_blocks.min &&
      section.codeBlocks.length < template.code_blocks.min
    ) {
      errors.push({
        head: section.heading.content,
        position: section.position,
        message: `Expected at least ${template.code_blocks.min} code blocks, but found ${section.codeBlocks.length}`,
      });
    }

    // Min
    if (
      template.code_blocks.max &&
      section.codeBlocks.length > template.code_blocks.max
    ) {
      errors.push({
        head: section.heading.content,
        position: section.position,
        message: `Expected at most ${template.code_blocks.max} code blocks, but found ${section.codeBlocks.length}`,
      });
    }
  }

  return errors;
}
