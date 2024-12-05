import { expect } from "chai";
import { lintDocument } from "./index.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("lintDocument", () => {
    let tempDir;
    let templateFile;
    let documentFile;

    beforeEach(() => {
        // Create temporary directory and files for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'));
        templateFile = path.join(tempDir, 'templates.yaml');
        documentFile = path.join(tempDir, 'test-document.md');
    });

    afterEach(() => {
        // Cleanup temporary files
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should lint a markdown file successfully", async () => {
        const validTemplate = `
templates:
  test-template:
    sections:
      section1:
        heading:
          const: "Test Section"
        required: true`;

        const validDocument = "# Test Section\nSome content here.";

        fs.writeFileSync(templateFile, validTemplate);
        fs.writeFileSync(documentFile, validDocument);

        const result = await lintDocument({
            file: documentFile,
            templatePath: templateFile,
            template: "test-template"
        });

        expect(result.success).to.be.true;
        expect(result.errors).to.be.empty;
    });

    it("should detect heading mismatch", async () => {
        const template = `
templates:
  test-template:
    sections:
      section1:
        heading:
          const: "Expected Heading"
        required: true`;

        const document = "# Wrong Heading\nSome content here.";

        fs.writeFileSync(templateFile, template);
        fs.writeFileSync(documentFile, document);

        const result = await lintDocument({
            file: documentFile,
            templatePath: templateFile,
            template: "test-template"
        });

        expect(result.success).to.be.false;
        expect(result.errors).to.have.lengthOf(1);
        expect(result.errors[0].message).to.include('Expected title "Expected Heading"');
    });

    it("should throw error for non-existent template", async () => {
        const template = `templates: {}`;
        const document = "# Test\nContent";

        fs.writeFileSync(templateFile, template);
        fs.writeFileSync(documentFile, document);

        try {
            await lintDocument({
                file: documentFile,
                templatePath: templateFile,
                template: "non-existent-template"
            });
            expect.fail('Should have thrown an error');
        } catch (error) {
            expect(error.message).to.include('Template "non-existent-template" not found');
        }
    });

    it("should validate complex document structure", async () => {
        const template = `
templates:
  test-template:
    sections:
      intro:
        heading:
          const: "Introduction"
        required: true
        sections:
          details:
            heading:
              pattern: "^Details: .*$"
            required: true`;

        const document = `# Introduction
Some intro content.
## Details: Section 1
Detail content here.`;

        fs.writeFileSync(templateFile, template);
        fs.writeFileSync(documentFile, document);

        const result = await lintDocument({
            file: documentFile,
            templatePath: templateFile,
            template: "test-template"
        });

        expect(result.success).to.be.true;
        expect(result.errors).to.be.empty;
    });
});