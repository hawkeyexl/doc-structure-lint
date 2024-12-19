# Doc Structure Lint

> **This is an alpha release.** Interfaces and structures are subject to change.

A tool to validate Markdown document structure against specified templates, ensuring consistent documentation across your projects.

## Features

- Validate Markdown documents against YAML-defined templates
- Rich validation capabilities:
  - [Section and subsection structure validation](#section-properties)
  - [Paragraph count requirements](#paragraphs)
  - [List validation](#lists) (ordered/unordered, item counts)
  - [Code block requirements](#code-blocks)
- Detailed error reporting with precise document positions
- Template dereferencing support for modular template definitions
- JSON Schema validation for template files

### Planned Features

- Frontmatter validation
- AsciiDoc support
- reStructuredText support
- Infer template from document structure

## Usage (as a CLI tool)

```bash
npx doc-structure-lint --file-path path/to/doc.md --template path/to/template.yaml
```

Doc Structure Lint uses a _local_ language model to evaluate some parts of your templates and content. This model only takes about 2 GB of storage, and it's only downloaded once. When you run the tool for the first time, it may take a few minutes to download the language model. If you don't want to download the model during installation, set the `DOC_STRUCTURE_LINT_PRELOAD` environment variable to `0`. However, if you specify an `instructions` property in your template, the model will be downloaded regardless of the `DOC_STRUCTURE_LINT_PRELOAD` variable value.

```bash
export DOC_STRUCTURE_LINT_PRELOAD=0 && npx doc-structure-lint --file-path path/to/doc.md --template path/to/template.yaml
```

### Options

- `--file-path` or `-f`: URL or path to the content to lint. Local paths can be individual files or directories.
- `--template-path` or `-p`: URL or path to the template file (default: `./template.yaml`).
- `--template` or `-t`: Name of the template to use
- `--json`: Output results in JSON format

## Usage (as a package)

### Installation

```bash
npm install doc-structure-lint
```

### API Usage

```javascript
import { lintDocument } from "doc-structure-lint";

async function validateDocument() {
  const result = await lintDocument({
    file: "path/to/doc.md",  // Path or URL. Doesn't support directories.
    templatePath: "path/to/template.yaml",  // Path or URL
    template: "Template name",  // Name of the template to use
  });
}
```

## Template Format

Templates are defined in YAML (as shown here) or JSON and specify the structure and content requirements for your documents. Each template can contain multiple sections with various validation rules.

Template definitions also support referencing with the `$ref` key, allowing you to reuse common section definitions across multiple templates.

### Basic Structure

```yaml
templates:
  template-name: # Must be alphanumeric, can include hyphens and underscores
    sections: # Required - contains section definitions
      section-name: # Must be alphanumeric, can include hyphens and underscores
        # Section properties go here
```

### Section Properties

```yml
description: Description of the section's purpose
instructions: # List of instructions that a section must follow, evaluated by a local language model. Doesn't evaluate content from subsections.
  - Instruction 1
  - Instruction 2
required: true # Whether the section must be present (default: true)
heading:
  const: Exact heading text # Exact heading text match
  pattern: ^Regex pattern$ # Regex pattern for heading text
sections: # Nested subsection definitions
  nested-section:
    # Nested section properties
additionalSections: false # Allow undefined subsections (default: false)
```

### Content Validation Rules

#### Paragraphs

```yaml
paragraphs:
  min: 0 # Minimum number of paragraphs
  max: 10 # Maximum number of paragraphs
  patterns: # Array of regex patterns applied sequentially
    - "^Start with.*"
    - ".*end with this$"
```

#### Code Blocks

```yaml
code_blocks:
  min: 0 # Minimum number of code blocks
  max: 5 # Maximum number of code blocks
```

#### Lists

```yaml
lists:
  min: 0 # Minimum number of lists
  max: 5 # Maximum number of lists
  items: # Requirements for list items
    min: 1 # Minimum items per list
    max: 10 # Maximum items per list
    paragraphs: # Paragraph requirements within items
      min: 0
      max: 2
    code_blocks: # Code block requirements within items
      min: 0
      max: 1
    lists: # Nested list requirements
      min: 0
      max: 2
```

#### Content Sequence

Use `sequence` to specify a strict order of content elements:

```yaml
sequence:
  - paragraphs:
      min: 1 # Must start with at least one paragraph
      max: 3 # But a maximum of three paragraphs
  - code_blocks:
      max: 1 # Followed by at most one code block
  - lists:
      min: 1 # Then at least one list
  - paragraphs:
      min: 1 # And ending with at least one paragraph
```

### Example Template

The following definition includes templates for a "How To" guide and an "API Operation" reference. Note that the `parameters` component is used in multiple sections with the `$ref` key.

```yaml
templates:
  how-to:
    sections:
      title:
        instructions:
          - Must mention the intent of the document
        paragraphs:
          min: 1
        sections:
          overview:
            heading:
              const: Overview
            paragraphs:
              min: 1
          before you start:
            heading:
              const: Before you start
            paragraphs:
              min: 1
          task:
            paragraphs:
              min: 1
            additionalSections: true
            sections:
              Sub-task:
                paragraphs:
                  min: 1
          see also:
            heading:
              const: See also
            paragraphs:
              min: 1
  api-operation:
    sections:
      overview:
        heading:
          const: "Overview"
        paragraphs:
          min: 1
          max: 3
      request-parameters:
        $ref: "#/components/parameters"
      response-parameters:
        $ref: "#/components/parameters"
      examples:
        required: true
        code_blocks:
          min: 1
        sections:
          success:
            heading:
              const: "Success Response"
            sequence:
              - paragraphs:
                  min: 1
              - code_blocks:
                  min: 1
          error:
            required: false
            heading:
              const: "Error Response"

components:
  parameters:
    required: false
    heading:
      pattern: "^Parameters|Request Parameters$"
    lists:
      min: 1
      items:
        min: 1
```

To use this template, save it to a file (like the default `templates.yaml`) and specify the template name that matches the key you set in your definition:

```bash how-to
npx doc-structure-lint --file-path path/to/doc.md --template-path path/to/templates.yaml --template how-to
```

```bash api-operation
npx doc-structure-lint --file-path path/to/operation.md --template-path path/to/templates.yaml --template api-operation
```

## Development

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Run tests:

   ```bash
   npm test
   ```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.
