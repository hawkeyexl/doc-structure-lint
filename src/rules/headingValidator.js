export function validateHeading(section, template) {
  const errors = [];

  // Const
  if (template.heading.const && section.heading !== template.heading.const) {
    errors.push({
      head: section.title,
      startIndex: section.startIndex,
      endIndex: section.endIndex,
      message: `Expected title "${template.heading.const}", but found "${section.heading}"`,
    });
  }
  
  // Pattern
  if (template.heading.pattern && !template.heading.pattern.test(section.heading)) {
    errors.push({
      head: section.title,
      startIndex: section.startIndex,
      endIndex: section.endIndex,
      message: `Title "${section.heading}" doesn't match pattern "${template.heading.pattern}"`,
    });
  }

  return errors;
}
