# Markdown Structure Linter

Markdown Structure Linter is a tool designed to validate the structure of markdown files against predefined templates. It ensures that your markdown documents adhere to specific structural requirements, making it ideal for maintaining consistency in documentation across projects.

## Features

- Validate markdown files against custom templates
- Check for required sections, paragraph counts, and code block requirements
- Flexible template definitions using YAML
- Output results in both human-readable text and structured JSON formats

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

To use the Markdown Structure Linter, you need a markdown file to lint and a template to lint against. The basic command structure is:

```
node index.js --file <path-to-markdown> --template <template-name>
```

### Options

- `--file` or `-f`: Path to the markdown file to lint (required)
- `--template` or `-t`: Name of the template to use (required)
- `--json`: Output results in JSON format (optional)

### Examples

1. Lint a markdown file using the "How-to" template:
   ```
   node index.js --file ./docs/how-to-guide.md --template How-to
   ```

2. Lint a markdown file and output results in JSON format:
   ```
   node index.js --file ./docs/api-reference.md --template API-doc --json
   ```

## Templates

Templates are defined in the `templates.yaml` file. Each template specifies the expected structure of a markdown document, including:

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
- [Introduction] (index: 0): Expected at least 2 paragraphs, but found 1
- [Usage] (index: 42): Missing required section "Examples"
```

### JSON Output

When run with the `--json` flag, the linter outputs structured JSON:

```json
{
  "success": false,
  "errors": [
    {
      "head": "Introduction",
      "index": 0,
      "message": "Expected at least 2 paragraphs, but found 1"
    },
    {
      "head": "Usage",
      "index": 42,
      "message": "Missing required section \"Examples\""
    }
  ]
}
```

## Contributing

Contributions to the Markdown Structure Linter are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
