import asciidoctor from 'asciidoctor';
import { v4 as uuid } from 'uuid';

/**
 * Parses an AsciiDoc content string and returns a structured representation of the document.
 *
 * @param {string} content - The AsciiDoc content to parse.
 * @returns {Object} The parsed document structure.
 * @returns {Object[]} result.sections - The sections of the document.
 * @returns {Object} result.frontmatter - The frontmatter attributes of the document.
 *
 * @typedef {Object} Section
 * @property {string} id - The unique identifier of the section.
 * @property {Object} position - The position of the section in the content.
 * @property {Object[]} content - The content nodes of the section.
 * @property {Object} heading - The heading of the section.
 * @property {number} heading.level - The level of the heading.
 * @property {Object} heading.position - The position of the heading in the content.
 * @property {string} heading.content - The content of the heading.
 * @property {Object[]} paragraphs - The paragraphs in the section.
 * @property {Object[]} codeBlocks - The code blocks in the section.
 * @property {Object[]} lists - The lists in the section.
 * @property {Section[]} sections - The nested sections within the section.
 *
 * @typedef {Object} Position
 * @property {Object} start - The start position.
 * @property {number} start.line - The start line number.
 * @property {number} start.column - The start column number.
 * @property {number} start.offset - The start offset.
 * @property {Object} end - The end position.
 * @property {number} end.line - The end line number.
 * @property {number} end.column - The end column number.
 * @property {number} end.offset - The end offset.
 */
export function parseAsciiDoc(content) {
  const processor = asciidoctor();
  const doc = processor.load(content);

  const result = {
    frontmatter: extractFrontmatter(doc),
    sections: []
  };

  function extractFrontmatter(doc) {
    const attributes = doc.getAttributes();
    return Object.entries(attributes)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => ({ key, value }));
  }

  function processBlock(block, currentSection) {
    const position = calculatePosition(block, content);

    switch (block.getContext()) {
      case 'paragraph':
        const paragraph = {
          content: block.getContent(),
          position
        };
        currentSection.paragraphs.push(paragraph);
        addToSequence(currentSection, 'paragraphs', paragraph);
        break;

      case 'listing':
        if (block.getStyle() === 'source') {
          const codeBlock = {
            content: `\`\`\`${block.getAttribute('language') || ''}\n${block.getContent()}\`\`\``,
            position
          };
          currentSection.codeBlocks.push(codeBlock);
          addToSequence(currentSection, 'code_blocks', codeBlock);
        }
        break;

      case 'ulist':
      case 'olist':
        const list = {
          ordered: block.getContext() === 'olist',
          items: block.getItems().map(item => ({
            position: calculatePosition(item, content),
            content: [{
              content: item.getText(),
              position: calculatePosition(item, content)
            }]
          })),
          position
        };
        currentSection.lists.push(list);
        addToSequence(currentSection, 'lists', list);
        break;
    }

    // Process nested blocks
    block.getBlocks().forEach(child => processBlock(child, currentSection));
  }

  function processSection(block, parentSection = null) {
    const section = {
      id: uuid(),
      position: calculatePosition(block, content),
      content: [],
      heading: {
        level: block.getLevel() || 0,
        position: calculatePosition(block, content),
        content: block.getTitle() || ''
      },
      paragraphs: [],
      codeBlocks: [],
      lists: [],
      sections: []
    };

    if (!parentSection) {
      result.sections.push(section);
    } else {
      parentSection.sections.push(section);
    }

    block.getBlocks().forEach(childBlock => {
      if (childBlock.getContext() === 'section') {
        processSection(childBlock, section);
      } else {
        processBlock(childBlock, section);
      }
    });

    return section;
  }

  function addToSequence(section, type, node) {
    if (section.content.length > 0 && 
        Object.hasOwn(section.content[section.content.length - 1], type)) {
      section.content[section.content.length - 1][type].push(node);
      section.content[section.content.length - 1].position.end = node.position.end;
    } else {
      const sequenceNode = {
        position: node.position,
      };
      sequenceNode[type] = [node];
      section.content.push(sequenceNode);
    }
  }

  function calculatePosition(block, content) {
    // Note: This is a simplified position calculation.
    // You would need to implement proper line/column tracking based on your needs
    const sourceLocation = block.getSourceLocation();
    return {
      start: {
        line: sourceLocation?.getLineNumber() || 0,
        column: 1,
        offset: sourceLocation?.getStartOffset() || 0
      },
      end: {
        line: sourceLocation?.getLineNumber() || 0,
        column: 1,
        offset: sourceLocation?.getEndOffset() || content.length
      }
    };
  }

  // Process the document
  const rootBlocks = doc.getBlocks();
  rootBlocks.forEach(block => {
    if (block.getContext() === 'preamble') {
      // Skip the preamble
    } else if (block.getContext() === 'section') {
      processSection(block);
    } else {
      // Create a default section for content without a heading
      const defaultSection = {
        id: uuid(),
        position: calculatePosition(block, content),
        content: [],
        heading: {
          level: 0,
          position: null,
          content: null
        },
        paragraphs: [],
        codeBlocks: [],
        lists: [],
        sections: []
      };
      result.sections.push(defaultSection);
      processBlock(block, defaultSection);
    }
  });

  return result;
}
