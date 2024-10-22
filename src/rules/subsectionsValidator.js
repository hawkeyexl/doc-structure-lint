export function validateSubsections(section, template, validateStructure) {
  const errors = [];

  if (template.sections) {
    for (const subsection of section.sections) {
      const subsectionTemplate = template.sections[subsection.title];
      if (subsectionTemplate) {
        errors.push(
          ...validateStructure(
            subsection,
            subsectionTemplate,
            [subsection.title]
          )
        );
      }
    }
  }

  return errors;
}
