import { expect } from "chai";
import { validateCodeBlocks } from "./codeBlocksValidator.js";
import { ValidationError } from "./ValidationError.js";

describe("validateCodeBlocks", () => {
    it("should return an empty array if template.code_blocks is not defined", () => {
        const section = { codeBlocks: [] };
        const template = {};
        const result = validateCodeBlocks(section, template);
        expect(result).to.be.an("array").that.is.empty;
    });

    it("should return an empty array if section.codeBlocks is not defined", () => {
        const section = {};
        const template = { code_blocks: { min: 1, max: 3 } };
        const result = validateCodeBlocks(section, template);
        expect(result).to.be.an("array").that.is.empty;
    });

    it("should return a ValidationError if the number of code blocks is less than the minimum required", () => {
        const section = { codeBlocks: [], heading: { content: "Test Heading" }, position: 1 };
        const template = { code_blocks: { min: 1 } };
        const result = validateCodeBlocks(section, template);
        expect(result).to.have.lengthOf(1);
        expect(result[0]).to.be.instanceOf(ValidationError);
        expect(result[0].message).to.equal("Expected at least 1 code blocks, but found 0");
    });

    it("should return a ValidationError if the number of code blocks exceeds the maximum allowed", () => {
        const section = { codeBlocks: [1, 2, 3, 4], heading: { content: "Test Heading" }, position: 1 };
        const template = { code_blocks: { max: 3 } };
        const result = validateCodeBlocks(section, template);
        expect(result).to.have.lengthOf(1);
        expect(result[0]).to.be.instanceOf(ValidationError);
        expect(result[0].message).to.equal("Expected at most 3 code blocks, but found 4");
    });

    it("should return an empty array if the number of code blocks is within the allowed range", () => {
        const section = { codeBlocks: [1, 2], heading: { content: "Test Heading" }, position: 1 };
        const template = { code_blocks: { min: 1, max: 3 } };
        const result = validateCodeBlocks(section, template);
        expect(result).to.be.an("array").that.is.empty;
    });
});