# Markdown and AsciiDoc Structure Linter

Markdown and AsciiDoc Structure Linter is a tool designed to validate the structure of Markdown and AsciiDoc files against predefined templates. It ensures that your documents adhere to specific structural requirements, making it ideal for maintaining consistency in documentation across projects.

## Features

- Validate Markdown and AsciiDoc files against custom templates
- Automatically detect file type based on extension or content
- Check for required sections, paragraph counts, and code block requirements
- Flexible template definitions using YAML
- Output results in both human-readable text and structured JSON formats
- Provide precise location information with start and end character indexes for each heading

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/your-username/markdown-structure-linter.git
   cd markdown-structure-linter
   ```

2. Install dependencies:
   ```
   npm install
   ```

## Usage

To use the Markdown and AsciiDoc Structure Linter, you need a Markdown or AsciiDoc file to lint and a template to lint against. The basic command structure is:

```
node index.js --file <path-to-file> --template <template-name>
```

### Options

- `--file` or `-f`: Path to the Markdown or AsciiDoc file to lint (required)
- `--template` or `-t`: Name of the template to use (required)
- `--json`: Output results in JSON format (optional)

### Examples

1. Lint a Markdown file using the "How-to" template:
   ```
   node index.js --file ./docs/how-to-guide.md --template How-to
   ```

2. Lint an AsciiDoc file using the "How-to" template:
   ```
   node index.js --file ./docs/how-to-guide.adoc --template How-to
   ```

3. Lint a file and output results in JSON format:
   ```
   node index.js --file ./docs/api-reference.md --template API-doc --json
   ```

## Project Structure

The project is organized into the following structure:

```
markdown-structure-linter/
├── src/
│   ├── schema.js
│   ├── templateLoader.js
│   ├── markdownParser.js
│   ├── asciidocParser.js
│   └── structureValidator.js
├── index.js
├── templates.yaml
├── package.json
└── README.md
```

- `src/schema.js`: Defines the JSON schema for template validation
- `src/templateLoader.js`: Handles loading and validating templates
- `src/markdownParser.js`: Parses Markdown content into a structured format
- `src/asciidocParser.js`: Parses AsciiDoc content into a structured format
- `src/structureValidator.js`: Validates the parsed document structure against the template
- `index.js`: Main entry point that ties everything together
- `templates.yaml`: Contains the template definitions

## Templates

Templates are defined in the `templates.yaml` file. Each template specifies the expected structure of a document, including:

- Required sections
- Paragraph count limits
- Code block requirements
- Nested section structures

For more information on creating and modifying templates, refer to the comments in the `templates.yaml` file.

## Output

### Text Output (Default)

When run without the `--json` flag, the linter provides human-readable output:

```
Structure violations found:
- [Introduction] (start: 0, end: 150): Expected at least 2 paragraphs, but found 1
- [Usage] (start: 151, end: 500): Missing required section "Examples"
```

### JSON Output

When run with the `--json` flag, the linter outputs structured JSON:

```json
{
  "success": false,
  "errors": [
    {
      "head": "Introduction",
      "startIndex": 0,
      "endIndex": 150,
      "message": "Expected at least 2 paragraphs, but found 1"
    },
    {
      "head": "Usage",
      "startIndex": 151,
      "endIndex": 500,
      "message": "Missing required section \"Examples\""
    }
  ]
}
```

The `startIndex` and `endIndex` properties provide the character positions of the start and end of each section, allowing for precise location of issues within the document.

## Contributing

Contributions to the Markdown and AsciiDoc Structure Linter are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
