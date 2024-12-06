import { expect } from "chai";
import { validateInstructions } from "./instructionValidator.js";
import { ValidationError } from "./ValidationError.js";

describe("validateInstructions", () => {
    it("should return an empty array if there are no instructions", async () => {
        const section = { 
            rawContent: "Test content", 
            heading: { content: "Test heading" }, 
            position: { start: { line: 1, column: 1 } }
        };
        const template = {};

        const result = await validateInstructions(section, template);
        expect(result).to.be.an("array").that.is.empty;
    }).timeout(20000);

    it("should return validation errors if instructions fail", async () => {
        const section = { 
            rawContent: "Invalid content that will fail validation", 
            heading: { content: "Test heading" }, 
            position: { start: { line: 1, column: 1 } }
        };
        const template = { 
            instructions: ["Content must mention all three primary colors"] 
        };

        const result = await validateInstructions(section, template);
        expect(result).to.be.an("array").that.is.not.empty;
        expect(result[0]).to.be.instanceOf(ValidationError);
    }).timeout(20000);

    it("should return an empty array if all instructions pass", async () => {
        const section = { 
            rawContent: "Valid content that meets all requirements", 
            heading: { content: "Test heading" }, 
            position: { start: { line: 1, column: 1 } }
        };
        const template = { 
            instructions: ["Content must not be empty"] 
        };

        const result = await validateInstructions(section, template);
        expect(result).to.be.an("array").that.is.empty;
    }).timeout(20000);
});