import { remark } from 'remark';
import remarkFrontmatter from 'remark-frontmatter';
import { v4 as uuid } from 'uuid';

export function parseMarkdown(content) {
  const tree = remark().use(remarkFrontmatter).parse(content);
  let currentSection = null;
  let charIndex = 0;

  const result = {
    frontmatter: [],
    sections: [],
  };

  const processNode = (node, parentSection) => {
    if (node.type === 'yaml') {
      const items = node.value.trim().split('\n').map(item => {
        const parts = item.split(':');
        return {
          key: parts[0].trim(),
          value: parts.slice(1).join(':').trim(),
        };
      });
      result.frontmatter = items;
    } else if (node.type === 'heading') {
      const level = node.depth;
      const newSection = {
        id: `${uuid()}`,
        startIndex: charIndex,
        endIndex: null,
        heading: {
          level,
          startIndex: charIndex,
          endIndex: null,
          content: node.children.map(child => child.value).join(''),
        },
        paragraphs: [],
        codeBlocks: [],
        sections: [],
      };

      if (level === 1) {
        result.sections.push(newSection);
      } else if (level > currentSection.heading.level) {
        currentSection.sections.push(newSection);
      } else if (level <= currentSection.heading.level) {
        let parent = findParent(result, currentSection.id);
        while (level <= parent.heading.level) {
          parent = findParent(result, parent.id);
        }
        parent.sections.push(newSection);
      }

      currentSection = newSection;
    } else if (node.type === 'paragraph') {
      const paragraph = {
        startIndex: charIndex,
        endIndex: charIndex + node.children.map(child => child.value).join('').length,
        content: node.children.map(child => child.value).join(''),
      };
      currentSection.paragraphs.push(paragraph);
    } else if (node.type === 'code') {
      const codeBlock = {
        startIndex: charIndex,
        endIndex: charIndex + node.value.length,
        content: `\`\`\`${node.lang}\n${node.value}\`\`\``,
      };
      currentSection.codeBlocks.push(codeBlock);
    }

    if (node.children) {
      node.children.forEach(child => processNode(child, currentSection));
    }
  };

  processNode(tree, null);

  return result;
}

// Function to find immediate parent of an object with given ID
function findParent(obj, targetId, parent = null) {
  // If current object has the target ID, return its parent
  if (obj.id === targetId) {
      return parent;
  }
  
  // If object has sections, search through them
  if (obj.sections && Array.isArray(obj.sections)) {
      for (const section of obj.sections) {
          const result = findParent(section, targetId, obj);
          if (result !== null) {
              return result;
          }
      }
  }
  
  return null;
}
