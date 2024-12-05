import { expect } from "chai";
import { loadAndValidateTemplates } from "./templateLoader.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("loadAndValidateTemplates", () => {
    let tempDir;
    let tempFile;

    beforeEach(() => {
        // Create temporary directory and file for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
        tempFile = path.join(tempDir, 'test-templates.yaml');
    });

    afterEach(() => {
        // Cleanup temporary files after each test
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should load, dereference, and validate templates successfully", async () => {
        const validTemplate = `
templates:
  template1:
    sections:
      section1:
        heading:
          const: "Test Heading"
        required: true`;

        fs.writeFileSync(tempFile, validTemplate);
        const result = await loadAndValidateTemplates(tempFile);

        expect(result).to.be.an('object');
        expect(result).to.have.property('template1');
        expect(result.template1.sections.section1.heading.const).to.equal('Test Heading');
    });

    it("should throw error for non-existent file", async () => {
        const nonExistentFile = path.join(tempDir, 'non-existent.yaml');
        
        try {
            await loadAndValidateTemplates(nonExistentFile);
            expect.fail('Should have thrown an error');
        } catch (error) {
            expect(error.message).to.include('Template file not found');
        }
    });

    it("should throw error for invalid YAML", async () => {
        const invalidYaml = `
templates:
  template1:
    heading: {
      const: "Incomplete YAML`;

        fs.writeFileSync(tempFile, invalidYaml);
        
        try {
            await loadAndValidateTemplates(tempFile);
            expect.fail('Should have thrown an error');
        } catch (error) {
            expect(error.message).to.include('Error reading template file');
        }
    });

    it("should throw error for invalid template schema", async () => {
        const invalidTemplate = `
templates:
  template1:
    invalid_field: true`;

        fs.writeFileSync(tempFile, invalidTemplate);
        
        try {
            await loadAndValidateTemplates(tempFile);
            expect.fail('Should have thrown an error');
        } catch (error) {
            expect(error.message).to.include('Template is invalid');
        }
    });

    it("should handle templates with references", async () => {
        const templateWithRefs = `
templates:
  template1:
    $ref: '#/templates/template2'
  template2:
    sections:
      section1:
        heading:
            const: "Referenced Heading"
        required: true`;

        fs.writeFileSync(tempFile, templateWithRefs);
        const result = await loadAndValidateTemplates(tempFile);

        expect(result).to.be.an('object');
        expect(result.template1.sections.section1.heading.const).to.equal('Referenced Heading');
    });
});