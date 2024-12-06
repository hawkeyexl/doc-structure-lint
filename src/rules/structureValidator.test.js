import { expect } from "chai";
import { validateSection, validateStructure } from "./structureValidator.js";

describe("validateStructure", () => {
  it("should return an empty array if no sections are defined in the template", async () => {
    const structure = { sections: [] };
    const template = { sections: [] };
    const result = await validateStructure(structure, template);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should return an empty array if no sections are defined in the structure", async () => {
    const structure = { sections: [] };
    const template = { sections: { section1: {} } };
    const result = await validateStructure(structure, template);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should validate sections according to template", async () => {
    const structure = {
      sections: [{ heading: "Section 1" }, { heading: "Section 2" }],
    };
    const template = {
      sections: {
        section1: { heading: { const: "Section 1" } },
        section2: { heading: { const: "Section 2" } },
      },
    };
    const result = await validateStructure(structure, template);
    expect(result).to.be.an("array");
  });

  it("should collect errors from section validation", async () => {
    const structure = {
      sections: [
        { heading: { content: "Wrong Heading" } },
        { heading: { content: "Another Wrong Heading" } },
      ],
    };
    const template = {
      sections: {
        section1: { heading: { const: "Expected Heading" } },
        section2: { heading: { const: "Another Expected Heading" } },
      },
    };
    const result = await validateStructure(structure, template);
    expect(result).to.be.an("array");
    // We can't predict exact errors since they come from actual validation
    // but we can check that validation occurred
    expect(result.length).to.equal(2);
  });
});

describe("validateSection", () => {
  it("should return no errors if no validation rules are defined", async () => {
    const structureSection = {};
    const templateSection = {};
    const result = await validateSection(structureSection, templateSection);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should validate heading against template constraints", async () => {
    const structureSection = { heading: { content: "Test Heading" } };
    const templateSection = { heading: { const: "Test Heading" } };
    const result = await validateSection(structureSection, templateSection);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should validate paragraphs against template constraints", async () => {
    const structureSection = {
      paragraphs: [
        { content: "First paragraph" },
        { content: "Second paragraph" },
      ],
    };
    const templateSection = {
      paragraphs: { min: 1, max: 3 },
    };
    const result = await validateSection(structureSection, templateSection);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should validate code blocks against template constraints", async () => {
    const structureSection = {
      code_blocks: [{ content: "```bash\nconsole.log('test');\n```" }],
    };
    const templateSection = {
      code_blocks: { min: 1 },
    };
    const result = await validateSection(structureSection, templateSection);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should validate lists against template constraints", async () => {
    const structureSection = {
      lists: [{ items: [{}] }, { items: [{}] }],
    };
    const templateSection = {
      lists: { min: 1 },
    };
    const result = await validateSection(structureSection, templateSection);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should validate sequence when specified", async () => {
    const structureSection = {
      heading: "Title",
      paragraphs: ["Text"],
      code_blocks: ["code"],
    };
    const templateSection = {
      sequence: ["heading", "paragraphs", "code_blocks"],
    };
    const result = await validateSection(structureSection, templateSection);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should validate nested sections", async () => {
    const structureSection = {
      sections: [
        { heading: { content: "Subsection 1" } },
        { heading: { content: "Subsection 2" } },
      ],
    };
    const templateSection = {
      sections: {
        subsection1: { heading: { const: "Subsection 1" } },
        subsection2: { heading: { const: "Subsection 2" } },
      },
    };
    const result = await validateSection(structureSection, templateSection);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should accumulate all validation errors", async () => {
    const structureSection = {
      heading: { content: "Wrong Heading" },
      paragraphs: [], // Should have at least one
      lists: [{ items: [{}] }], // Should have at least two
    };
    const templateSection = {
      heading: { const: "Expected Heading" },
      paragraphs: { min: 1 },
      lists: { min: 2 },
    };
    const result = await validateSection(structureSection, templateSection);
    expect(result).to.be.an("array");
    expect(result.length).to.equal(3);
  });
});
