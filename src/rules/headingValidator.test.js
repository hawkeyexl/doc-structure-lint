import { expect } from "chai";
import { validateHeading } from "./headingValidator.js";
import { ValidationError } from "./ValidationError.js";

describe("validateHeading", () => {
    it("should return an empty array if template.heading is not defined", () => {
        const section = { heading: { content: "Test Heading" }, position: {} };
        const template = {};
        const result = validateHeading(section, template);
        expect(result).to.be.an("array").that.is.empty;
    });

    it("should return a ValidationError if heading does not match the constant", () => {
        const section = { heading: { content: "Wrong Heading" }, position: {} };
        const template = { heading: { const: "Expected Heading" } };
        const result = validateHeading(section, template);
        expect(result).to.have.lengthOf(1);
        expect(result[0]).to.be.instanceOf(ValidationError);
        expect(result[0].message).to.equal('Expected title "Expected Heading", but found "Wrong Heading"');
    });

    it("should return a ValidationError if heading does not match the pattern", () => {
        const section = { heading: { content: "Invalid Heading" }, position: {} };
        const template = { heading: { pattern: "^Valid Heading$" } };
        const result = validateHeading(section, template);
        expect(result).to.have.lengthOf(1);
        expect(result[0]).to.be.instanceOf(ValidationError);
        expect(result[0].message).to.equal('Title "Invalid Heading" doesn\'t match pattern "^Valid Heading$"');
    });

    it("should return multiple ValidationErrors if heading does not match both constant and pattern", () => {
        const section = { heading: { content: "Wrong Heading" }, position: {} };
        const template = { heading: { const: "Expected Heading", pattern: /^Valid Heading$/ } };
        const result = validateHeading(section, template);
        expect(result).to.have.lengthOf(2);
        expect(result[0]).to.be.instanceOf(ValidationError);
        expect(result[1]).to.be.instanceOf(ValidationError);
    });

    it("should return an empty array if heading matches both constant and pattern", () => {
        const section = { heading: { content: "Valid Heading" }, position: {} };
        const template = { heading: { const: "Valid Heading", pattern: /^Valid Heading$/ } };
        const result = validateHeading(section, template);
        expect(result).to.be.an("array").that.is.empty;
    });
});