export function validateHeading(section, template) {
  if (template.heading && template.heading.const && section.heading !== template.heading.const) {
    return {
      head: section.title,
      startIndex: section.startIndex,
      endIndex: section.endIndex,
      message: `Expected title "${template.heading.const}", but found "${section.heading}"`,
    };
  }
  return null;
}
