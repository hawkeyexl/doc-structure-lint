#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const markdownIt = require('markdown-it');

program
  .version('1.0.0')
  .description('Compare the structure of a markdown file against a template')
  .requiredOption('-t, --template <path>', 'Path to the template markdown file')
  .requiredOption('-f, --file <path>', 'Path to the markdown file to check')
  .parse(process.argv);

const options = program.opts();

function parseMarkdown(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const md = new markdownIt();
  const tokens = md.parse(content, {});
  return extractStructure(tokens);
}

function extractStructure(tokens) {
  const structure = [];
  let currentLevel = { level: 0, children: structure, content: [] };
  const stack = [currentLevel];

  tokens.forEach(token => {
    if (token.type === 'heading_open') {
      const level = parseInt(token.tag.slice(1));
      const newLevel = { level, title: '', children: [], content: [] };

      while (currentLevel.level >= level) {
        stack.pop();
        currentLevel = stack[stack.length - 1];
      }

      currentLevel.children.push(newLevel);
      stack.push(newLevel);
      currentLevel = newLevel;
    } else if (token.type === 'inline' && stack[stack.length - 1].title === '') {
      stack[stack.length - 1].title = token.content;
    } else if (token.type === 'paragraph_open') {
      currentLevel.content.push({ type: 'paragraph', content: '' });
    } else if (token.type === 'fence') {
      currentLevel.content.push({ type: 'code_block', content: token.content });
    } else if (token.type === 'inline' && currentLevel.content.length > 0) {
      const lastContent = currentLevel.content[currentLevel.content.length - 1];
      if (lastContent.type === 'paragraph') {
        lastContent.content += token.content;
      }
    } else if (token.type === 'html_block' && token.content.trim().startsWith('<!-- template:')) {
      currentLevel.template = parseTemplateComment(token.content);
    }
  });

  return structure;
}

function parseTemplateComment(comment) {
  const template = {};
  const lines = comment.trim().split('\n');
  lines.slice(1, -1).forEach(line => {
    const [key, value] = line.split(':').map(s => s.trim());
    template[key] = value;
  });
  return template;
}

function compareStructures(template, actual) {
  const issues = [];

  function compare(templateSection, actualSection, path = []) {
    if (!actualSection) {
      issues.push(`Missing section: ${path.join(' > ')}`);
      return;
    }

    if (templateSection.title && templateSection.title !== actualSection.title) {
      issues.push(`Title mismatch at ${path.join(' > ')}: Expected "${templateSection.title}", found "${actualSection.title}"`);
    }

    if (templateSection.template) {
      checkTemplateRules(templateSection, actualSection, path);
    }

    if (templateSection.template && templateSection.template.subheadings === '*') {
      // Allow any number of subheadings at any level
      return;
    }

    templateSection.children.forEach((templateChild, index) => {
      const actualChild = actualSection.children[index];
      compare(templateChild, actualChild, [...path, templateChild.title || `Section ${index + 1}`]);
    });

    if (actualSection.children.length > templateSection.children.length) {
      issues.push(`Extra sections found in ${path.join(' > ')}`);
    }
  }

  function checkTemplateRules(templateSection, actualSection, path) {
    const rules = templateSection.template;
    const sectionPath = path.join(' > ');

    if (rules.paragraphs) {
      const [min, max] = parseRange(rules.paragraphs);
      const paragraphCount = actualSection.content.filter(c => c.type === 'paragraph').length;
      if (paragraphCount < min || (max !== Infinity && paragraphCount > max)) {
        issues.push(`Paragraph count mismatch in ${sectionPath}: Expected ${formatRange(min, max)}, found ${paragraphCount}`);
      }
    }

    if (rules.code_blocks) {
      const [min, max] = parseRange(rules.code_blocks);
      const codeBlockCount = actualSection.content.filter(c => c.type === 'code_block').length;
      if (codeBlockCount < min || (max !== Infinity && codeBlockCount > max)) {
        issues.push(`Code block count mismatch in ${sectionPath}: Expected ${formatRange(min, max)}, found ${codeBlockCount}`);
      }
    }

    if (rules.subheadings && rules.subheadings !== '*') {
      const [min, max] = parseRange(rules.subheadings);
      const subheadingCount = actualSection.children.length;
      if (subheadingCount < min || (max !== Infinity && subheadingCount > max)) {
        issues.push(`Subheading count mismatch in ${sectionPath}: Expected ${formatRange(min, max)}, found ${subheadingCount}`);
      }
    }
  }

  compare({ level: 0, children: template }, { level: 0, children: actual });
  return issues;
}

function parseRange(rangeStr) {
  if (rangeStr.endsWith('+')) {
    const min = parseInt(rangeStr);
    return [min, Infinity];
  }
  const [min, max] = rangeStr.split('-').map(Number);
  return [min, max || min];
}

function formatRange(min, max) {
  return max === Infinity ? `${min}+` : min === max ? min : `${min}-${max}`;
}

try {
  const templateStructure = parseMarkdown(options.template);
  const fileStructure = parseMarkdown(options.file);

  const issues = compareStructures(templateStructure, fileStructure);

  if (issues.length === 0) {
    console.log('The markdown file structure matches the template.');
  } else {
    console.log('Issues found:');
    issues.forEach(issue => console.log(`- ${issue}`));
    process.exit(1);
  }
} catch (error) {
  console.error('An error occurred:', error.message);
  process.exit(1);
}