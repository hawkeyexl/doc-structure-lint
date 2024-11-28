import { expect } from 'chai';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseMarkdown } from '../src/markdownParser.js';
import { parseAsciiDoc } from '../src/asciidocParser.js';
import { validateStructure } from '../src/structureValidator.js';
import { loadAndValidateTemplates } from '../src/templateLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Markdown and AsciiDoc Structure Linter', () => {
  let templates;

  before(async () => {
    templates = await loadAndValidateTemplates();
  });

  it('should validate a correct Markdown file structure', () => {
    const markdownContent = readFileSync(path.join(__dirname, 'artifacts', 'match.md'), 'utf8');
    const structure = parseMarkdown(markdownContent);
    console.log('Markdown structure:', JSON.stringify(structure, null, 2));
    const errors = validateStructure(structure, templates['How-to']);
    console.log('Validation errors:', JSON.stringify(errors, null, 2));
    expect(errors).to.be.an('array').that.is.empty;
  });

  it('should validate a correct AsciiDoc file structure', () => {
    const asciidocContent = readFileSync(path.join(__dirname, 'artifacts', 'match.adoc'), 'utf8');
    const structure = parseAsciiDoc(asciidocContent);
    console.log('AsciiDoc structure:', JSON.stringify(structure, null, 2));
    const errors = validateStructure(structure, templates['How-to']);
    expect(errors).to.be.an('array').that.is.empty;
  });

  it('should detect errors in an incorrect Markdown file structure', () => {
    const incorrectMarkdown = `
# Incorrect Structure

## Missing Prerequisites

## Usage

## Extra Section
`;
    const structure = parseMarkdown(incorrectMarkdown);
    const errors = validateStructure(structure, templates['How-to']);
    expect(errors).to.be.an('array').that is.not.empty;
  });

  it('should detect errors in an incorrect AsciiDoc file structure', () => {
    const incorrectAsciidoc = `
= Incorrect Structure

== Missing Prerequisites

== Usage

== Extra Section
`;
    const structure = parseAsciiDoc(incorrectAsciidoc);
    console.log('Incorrect AsciiDoc structure:', JSON.stringify(structure, null, 2));
    const errors = validateStructure(structure, templates['How-to']);
    expect(errors).to.be.an('array').that is.not.empty;
  });
});
