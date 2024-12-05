import { lintDocument } from '../../src/index.js';

const result = await lintDocument({
  file: './test/artifacts/sample_markdown.md',
  templatePath: './templates.yaml',
  template: 'Sample'
});

console.log(result);