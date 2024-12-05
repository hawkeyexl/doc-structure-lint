import { expect } from "chai";
import { validateParagraphs } from "./paragraphsValidator.js";
import { ValidationError } from "./ValidationError.js";

describe("validateParagraphs", () => {
    it("should return an error if the section has fewer paragraphs than the minimum count", () => {
        const section = {
            paragraphs: [{ content: "Paragraph 1" }],
            heading: { content: "Section 1" },
            position: { start: 0, end: 10 }
        };
        const template = {
            paragraphs: { min: 2 }
        };

        const errors = validateParagraphs(section, template);
        expect(errors).to.have.lengthOf(1);
        expect(errors[0]).to.be.instanceOf(ValidationError);
        expect(errors[0].message).to.equal("Expected at least 2 paragraphs, but found 1");
    });

    it("should return an error if the section has more paragraphs than the maximum count", () => {
        const section = {
            paragraphs: [{ content: "Paragraph 1" }, { content: "Paragraph 2" }, { content: "Paragraph 3" }],
            heading: { content: "Section 1" },
            position: { start: 0, end: 10 }
        };
        const template = {
            paragraphs: { max: 2 }
        };

        const errors = validateParagraphs(section, template);
        expect(errors).to.have.lengthOf(1);
        expect(errors[0]).to.be.instanceOf(ValidationError);
        expect(errors[0].message).to.equal("Expected at most 2 paragraphs, but found 3");
    });

    it("should return an error if a paragraph does not match the pattern", () => {
        const section = {
            paragraphs: [{ content: "Paragraph 1" }, { content: "Invalid Paragraph" }],
            heading: { content: "Section 1" },
            position: { start: 0, end: 10 }
        };
        const template = {
            paragraphs: { patterns: ["^Paragraph \\d+$"] }
        };

        const errors = validateParagraphs(section, template);
        expect(errors).to.have.lengthOf(1);
        expect(errors[0]).to.be.instanceOf(ValidationError);
        expect(errors[0].message).to.include("doesn't match expected pattern");
    });

    it("should return multiple errors if multiple validation rules are violated", () => {
        const section = {
            paragraphs: [{ content: "Invalid Paragraph" }],
            heading: { content: "Section 1" },
            position: { start: 0, end: 10 }
        };
        const template = {
            paragraphs: { min: 2, max: 1, patterns: ["^Paragraph \\d+$"] }
        };

        const errors = validateParagraphs(section, template);
        expect(errors).to.have.lengthOf(2);
    });

    it("should return no errors if all validation rules are satisfied", () => {
        const section = {
            paragraphs: [{ content: "Paragraph 1" }, { content: "Paragraph 2" }],
            heading: { content: "Section 1" },
            position: { start: 0, end: 10 }
        };
        const template = {
            paragraphs: { min: 2, max: 2, patterns: ["^Paragraph \\d+$"] }
        };

        const errors = validateParagraphs(section, template);
        expect(errors).to.have.lengthOf(0);
    });
});
