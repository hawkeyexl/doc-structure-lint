import { validateParagraphs } from "./paragraphsValidator.js";
import { validateCodeBlocks } from "./codeBlocksValidator.js";
import { validateLists } from "./listValidator.js";

export function validateSequence(structure, template) {
  const errors = [];
  if (!template.sequence) return errors;

  // Group content by type for validation
  const contentByType = {
    paragraph: [],
    code_block: [],
    list: []
  };

  // Map content to their original positions and extract elements
  const positionMap = new Map();
  structure.content.forEach((item, index) => {
    // Handle nested element structure
    const contentItem = {
      type: item.type,
      ...item.element,
      originalIndex: index
    };
    
    contentByType[item.type]?.push(contentItem);
    positionMap.set(contentItem, index);
  });

  let lastPosition = -1;
  
  for (const seqItem of template.sequence) {
    const type = seqItem.type;
    const items = contentByType[type] || [];

    // Validate content type specific rules with position context
    switch (type) {
      case 'paragraph':
        if (seqItem.paragraphs) {
          structure.paragraphs = items;
          template.paragraphs = seqItem.paragraphs;
          errors.push(...validateParagraphs(structure, template));
        }
        break;

      case 'code_block':
        if (seqItem.code_blocks) {
          structure.codeBlocks = items;
          template.code_blocks = seqItem.code_blocks;
          errors.push(...validateCodeBlocks(structure, template));
        }
        break;

      case 'list':
        if (seqItem.lists) {
          structure.lists = items;
          template.lists = seqItem.lists;
          errors.push(...validateLists(structure, template));
        }
        break;
    }

    // Validate sequence order with position information
    for (const item of items) {
      const position = positionMap.get(item);
      if (position <= lastPosition) {
        errors.push({
          type: 'sequence_order_error',
          message: `${type} found out of sequence at position ${position}`,
          position: item.position
        });
      }
      lastPosition = Math.max(lastPosition, position);
    }
  }

  // Check for content not defined in sequence
  const definedTypes = new Set(template.sequence.map(item => item.type));
  const unexpectedContent = structure.content.filter(item => !definedTypes.has(item.type));
  
  if (unexpectedContent.length > 0) {
    errors.push({
      type: 'sequence_unexpected_content',
      message: `Found ${unexpectedContent.length} content elements not defined in sequence`,
      position: unexpectedContent[0].element?.position
    });
  }

  return errors;
}