import { expect } from "chai";
import { validateSubsections } from "./subsectionValidator.js";
import { ValidationError } from "./ValidationError.js";

describe("validateSubsections", () => {
    it("should return an empty array if templateSection has no sections", () => {
        const structureSection = { sections: [] };
        const templateSection = {};

        const result = validateSubsections(structureSection, templateSection);
        expect(result).to.be.an("array").that.is.empty;
    });

    it("should return a missing section error if structureSection has no sections and templateSection has required sections", () => {
        const structureSection = { sections: [], heading: { content: "Heading" }, position: { line: 1, column: 1 } };
        const templateSection = { sections: { subsection1: { required: true } } };

        const result = validateSubsections(structureSection, templateSection);
        expect(result).to.be.an("array").that.is.not.empty;
        expect(result[0]).to.be.instanceOf(ValidationError);
        expect(result[0].message).to.include("Expected between 1 and 1 sections, but found 0");
    });

    it("should return a section count mismatch error if the number of sections does not match the template requirements", () => {
        const structureSection = { sections: [{}, {}, {}], heading: { content: "Heading" }, position: { line: 1, column: 1 } };
        const templateSection = { sections: { subsection1: { required: true }, subsection2: { required: true } }, additionalSections: false };

        const result = validateSubsections(structureSection, templateSection);
        expect(result).to.be.an("array").that.is.not.empty;
        expect(result[0]).to.be.instanceOf(ValidationError);
        expect(result[0].message).to.include("Expected between");
    });

    it("should validate additional sections if allowed", () => {
        const structureSection = { sections: [{}, {}, {}], heading: { content: "Heading" }, position: { line: 1, column: 1 } };
        const templateSection = { sections: { subsection1: { required: true }, subsection2: { required: true } }, additionalSections: true };

        const result = validateSubsections(structureSection, templateSection);
        expect(result).to.be.an("array").that.is.empty;
    });

    it("should validate required subsections", () => {
        const structureSection = { sections: [{}, {}], heading: { content: "Heading" }, position: { line: 1, column: 1 } };
        const templateSection = { sections: { subsection1: { required: true }, subsection2: { required: true } } };

        const result = validateSubsections(structureSection, templateSection);
        expect(result).to.be.an("array").that.is.empty;
    });
});