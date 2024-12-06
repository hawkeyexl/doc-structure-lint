# Doc Structure Lint

> **This is an alpha release.** Interfaces and structures are subject to change.

A tool to validate Markdown document structure against specified templates, ensuring consistent documentation across your projects.

## Features

- Validate Markdown documents against YAML-defined templates
- Rich validation capabilities:
  - Section and subsection structure validation
  - Paragraph count requirements
  - List validation (ordered/unordered, item counts)
  - Code block requirements
- Detailed error reporting with precise document positions
- Template dereferencing support for modular template definitions
- JSON Schema validation for template files

### Planned Features

- Frontmatter validation
- AsciiDoc support
- reStructuredText support
- Custom validation rules
- Infer template from document structure

## Usage (as a CLI tool)

```bash
npx doc-structure-lint --file path/to/doc.md --template path/to/template.yaml
```

### Options

- `--file-path` or `-f`: Path to the Markdown document to validate
- `--template-path` or `-p`: Path to the YAML template file
- `--template` or `-t`: Name of the template to use

## Usage (as a package)

### Installation

```bash
npm install doc-structure-lint
```

### API Usage

```javascript
import { lintDocument } from 'doc-structure-lint';

async function validateDocument() {
    const result = await lintDocument({
      file: "path/to/doc.md",
      templatePath: "path/to/template.yaml",
      template: "Template name",
    });
}
```

## Template Format

Templates are defined in YAML and can specify:

```yaml
templates:
  how-to-guide: # Template name
    sections:
      introduction: # Section name
        paragraphs: # Paragraph count requirements for the whole section
          min: 1
          max: 3
      prerequisites:
        sequence:    # Specific sequence of elements in the section
            - paragraphs:
               min: 1
            - lists:
               min: 1
               items:
                  min: 2
      usage:
        code_blocks:
          min: 1
        sections:
          advanced_features: # Subsection name
            required: false
          troubleshooting:
```

> **Note:** Comprehensive rules reference coming soon.

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
