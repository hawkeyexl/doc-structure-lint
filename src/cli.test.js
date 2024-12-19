import { expect } from "chai";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";

const execAsync = promisify(exec);

describe("CLI functionality", () => {
    let tempDir;
    let templateFile;
    let documentFile;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
        templateFile = path.join(tempDir, 'templates.yaml');
        documentFile = path.join(tempDir, 'test-document.md');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should validate document successfully via npx command", async () => {
        const template = `
templates:
  test-template:
    sections:
      intro:
        heading:
          const: "Introduction"
        required: true`;

        const document = "# Introduction\nSome content here.";

        fs.writeFileSync(templateFile, template);
        fs.writeFileSync(documentFile, document);

        const { stdout, stderr } = await execAsync(
            `npx . --file-path ${documentFile} --template-path ${templateFile} --template test-template`
        );

        expect(stdout).to.include("Validation successful");
    }).timeout(20000);

    it("should report validation errors via npx command", async () => {
        const template = `
templates:
  test-template:
    sections:
      intro:
        heading:
          const: "Expected Heading"
        required: true`;

        const document = "# Wrong Heading\nSome content here.";

        fs.writeFileSync(templateFile, template);
        fs.writeFileSync(documentFile, document);

        try {
            await execAsync(
                `npx . --file-path="${documentFile}" --template-path="${templateFile}" --template="test-template"`
            );
            expect.fail("Should have thrown an error");
        } catch (error) {
            expect(error.stdout).to.include("Expected title");
        }
    }).timeout(20000);

    it("should show help message with --help flag", async () => {
        const { stdout } = await execAsync("npx . --help");
        
        expect(stdout).to.include("Options:");
        expect(stdout).to.include("--file");
        expect(stdout).to.include("--template-path");
        expect(stdout).to.include("--template");
    }).timeout(20000);

    it("should fail with meaningful error for missing arguments", async () => {
        try {
            await execAsync("npx .");
            expect.fail("Should have thrown an error");
        } catch (error) {
            expect(error.stderr).to.include("Options");
        }
    }).timeout(20000);

    it("should handle invalid template path gracefully", async () => {
        try {
            await execAsync(
                `npx . --file-path="${documentFile}" --template-path="non-existent.yaml" --template="test-template"`
            );
            expect.fail("Should have thrown an error");
        } catch (error) {
            expect(error.stderr).to.include("Error reading template file");
            expect(error.code).to.equal(1);
        }
    }).timeout(20000);

    it("should handle malformed template file", async () => {
        fs.writeFileSync(templateFile, "invalid: yaml: content:");
        try {
            await execAsync(
                `npx . --file-path="${documentFile}" --template-path="${templateFile}" --template="test-template"`
            );
            expect.fail("Should have thrown an error");
        } catch (error) {
            expect(error.stderr).to.include("Failed to load and validate templates");
            expect(error.code).to.equal(1);
        }
    }).timeout(20000);

//     it("should validate document successfully via URL", async () => {
//         const template = `
// templates:
//   test-template:
//     sections:
//       intro:
//         heading:
//           const: "Introduction"
//         required: true`;

//         const document = "# Introduction\nSome content here.";

//         fs.writeFileSync(templateFile, template);
//         fs.writeFileSync(documentFile, document);

//         const templateUrl = `file://${templateFile}`;
//         const documentUrl = `file://${documentFile}`;

//         const { stdout, stderr } = await execAsync(
//             `npx . --file-path ${documentUrl} --template-path ${templateUrl} --template test-template`
//         );

//         expect(stdout).to.include("Validation successful");
//     }).timeout(20000);

//     it("should report validation errors via URL", async () => {
//         const template = `
// templates:
//   test-template:
//     sections:
//       intro:
//         heading:
//           const: "Expected Heading"
//         required: true`;

//         const document = "# Wrong Heading\nSome content here.";

//         fs.writeFileSync(templateFile, template);
//         fs.writeFileSync(documentFile, document);

//         const templateUrl = `file://${templateFile}`;
//         const documentUrl = `file://${documentFile}`;

//         try {
//             await execAsync(
//                 `npx . --file-path="${documentUrl}" --template-path="${templateUrl}" --template="test-template"`
//             );
//             expect.fail("Should have thrown an error");
//         } catch (error) {
//             expect(error.stdout).to.include("Expected title");
//         }
//     }).timeout(20000);

//     it("should handle invalid template URL gracefully", async () => {
//         const document = "# Introduction\nSome content here.";
//         fs.writeFileSync(documentFile, document);

//         const invalidTemplateUrl = "http://invalid-url.com/non-existent.yaml";
//         const documentUrl = `file://${documentFile}`;

//         try {
//             await execAsync(
//                 `npx . --file-path="${documentUrl}" --template-path="${invalidTemplateUrl}" --template="test-template"`
//             );
//             expect.fail("Should have thrown an error");
//         } catch (error) {
//             expect(error.stdout).to.include("Failed to fetch template file");
//             expect(error.code).to.equal(1);
//         }
//     }).timeout(20000);

//     it("should handle invalid document URL gracefully", async () => {
//         const template = `
// templates:
//   test-template:
//     sections:
//       intro:
//         heading:
//           const: "Introduction"
//         required: true`;

//         fs.writeFileSync(templateFile, template);

//         const templateUrl = `file://${templateFile}`;
//         const invalidDocumentUrl = "http://invalid-url.com/non-existent.md";

//         try {
//             await execAsync(
//                 `npx . --file-path="${invalidDocumentUrl}" --template-path="${templateUrl}" --template="test-template"`
//             );
//             expect.fail("Should have thrown an error");
//         } catch (error) {
//             expect(error.stdout).to.include("Failed to fetch file");
//             expect(error.code).to.equal(1);
//         }
//     }).timeout(20000);

    it("should validate all markdown files in a directory", async () => {
        const template = `
templates:
  test-template:
    sections:
      intro:
        heading:
          const: "Introduction"
        required: true`;

        const document1 = "# Introduction\nContent 1";
        const document2 = "# Introduction\nContent 2";

        fs.writeFileSync(templateFile, template);
        fs.writeFileSync(path.join(tempDir, 'doc1.md'), document1);
        fs.writeFileSync(path.join(tempDir, 'doc2.md'), document2);

        const { stdout } = await execAsync(
            `npx . --file-path ${tempDir} --template-path ${templateFile} --template test-template`
        );

        expect(stdout).to.include("Validation successful");
        expect(stdout).to.include("doc1.md");
        expect(stdout).to.include("doc2.md");
    }).timeout(20000);

    it("should report errors for invalid files in directory", async () => {
        const template = `
templates:
  test-template:
    sections:
      intro:
        heading:
          const: "Introduction"
        required: true`;

        const validDoc = "# Introduction\nValid content";
        const invalidDoc = "# Wrong Heading\nInvalid content";

        fs.writeFileSync(templateFile, template);
        fs.writeFileSync(path.join(tempDir, 'valid.md'), validDoc);
        fs.writeFileSync(path.join(tempDir, 'invalid.md'), invalidDoc);

        try {
            await execAsync(
                `npx . --file-path ${tempDir} --template-path ${templateFile} --template test-template`
            );
            expect.fail("Should have thrown an error");
        } catch (error) {
            expect(error.stdout).to.include("Validation successful");
            expect(error.stdout).to.include("Expected title");
        }
    }).timeout(20000);

    it("should ignore non-markdown files in directory", async () => {
        const template = `
templates:
  test-template:
    sections:
      intro:
        heading:
          const: "Introduction"
        required: true`;

        const markdownDoc = "# Introduction\nValid content";

        fs.writeFileSync(templateFile, template);
        fs.writeFileSync(path.join(tempDir, 'document.md'), markdownDoc);
        fs.writeFileSync(path.join(tempDir, 'ignore.txt'), 'Some text');
        fs.writeFileSync(path.join(tempDir, 'ignore.json'), '{}');

        const { stdout } = await execAsync(
            `npx . --file-path ${tempDir} --template-path ${templateFile} --template test-template`
        );
        expect(stdout).to.include("document.md");
        expect(stdout).to.include("Validation successful");
        expect(stdout).to.not.include("ignore.txt");
        expect(stdout).to.not.include("ignore.json");
    }).timeout(20000);

    it("should handle empty directory gracefully", async () => {
        const template = `
templates:
  test-template:
    sections:
      intro:
        heading:
          const: "Introduction"
        required: true`;

        fs.writeFileSync(templateFile, template);
        const emptyDir = path.join(tempDir, 'empty');
        fs.mkdirSync(emptyDir);

        try {
            await execAsync(
                `npx . --file-path ${emptyDir} --template-path ${templateFile} --template test-template`
            );
            expect.fail("Should have thrown an error");
        } catch (error) {
            expect(error.stdout).to.include("No supported files found");
            expect(error.code).to.equal(1);
        }
    }).timeout(20000);
});
