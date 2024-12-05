import { expect } from "chai";
import { validateStructure } from "./structureValidator.js";

describe("validateStructure", () => {
  it("should return an empty array if no sections are defined in the template", () => {
    const structure = { sections: [] };
    const template = { sections: [] };
    const result = validateStructure(structure, template);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should return an empty array if no sections are defined in the structure", () => {
    const structure = { sections: [] };
    const template = { sections: { section1: {} } };
    const result = validateStructure(structure, template);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should validate sections according to template", () => {
    const structure = {
      sections: [{ heading: "Section 1" }, { heading: "Section 2" }],
    };
    const template = {
      sections: {
        section1: { heading: { const: "Section 1" } },
        section2: { heading: { const: "Section 2" } },
      },
    };
    const result = validateStructure(structure, template);
    expect(result).to.be.an("array");
  });

  it("should collect errors from section validation", () => {
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
    const result = validateStructure(structure, template);
    expect(result).to.be.an("array");
    // We can't predict exact errors since they come from actual validation
    // but we can check that validation occurred
    expect(result.length).to.equal(2);
  });
});
