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
  let currentLevel = { level: 0, children: structure };
  const stack = [currentLevel];

  tokens.forEach(token => {
    if (token.type === 'heading_open') {
      const level = parseInt(token.tag.slice(1));
      const newLevel = { level, title: '', children: [] };

      while (currentLevel.level >= level) {
        stack.pop();
        currentLevel = stack[stack.length - 1];
      }

      currentLevel.children.push(newLevel);
      stack.push(newLevel);
      currentLevel = newLevel;
    } else if (token.type === 'inline' && stack[stack.length - 1].title === '') {
      stack[stack.length - 1].title = token.content;
    }
  });

  return structure;
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

    templateSection.children.forEach((templateChild, index) => {
      const actualChild = actualSection.children[index];
      compare(templateChild, actualChild, [...path, templateChild.title || `Section ${index + 1}`]);
    });

    if (actualSection.children.length > templateSection.children.length) {
      issues.push(`Extra sections found in ${path.join(' > ')}`);
    }
  }

  compare({ level: 0, children: template }, { level: 0, children: actual });
  return issues;
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