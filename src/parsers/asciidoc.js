import asciidoctor from 'asciidoctor';

export const parseAsciiDoc = (content) => {
  const processor = asciidoctor();
  const doc = processor.load(content);
  
  const rootSection = {
    title: doc.getDocumentTitle(),
    startIndex: 0,
    endIndex: content.length,
    paragraphs: 0,
    code_blocks: 0,
    subsections: []
  };

  const processBlock = (block, currentSection, content) => {
    if (block.getContext() === 'section') {
      const sectionTitle = block.getTitle();
      const sectionLevel = block.getLevel();
      const sectionMarker = '='.repeat(sectionLevel) + ' ' + sectionTitle;
      const startIndex = content.indexOf(sectionMarker, currentSection.startIndex);
      
      const newSection = {
        title: sectionTitle,
        startIndex: startIndex,
        endIndex: content.length, // Initially set to end of content, will be updated later
        paragraphs: 0,
        code_blocks: 0,
        subsections: []
      };
      
      currentSection.subsections.push(newSection);
      
      block.getBlocks().forEach(childBlock => processBlock(childBlock, newSection, content));
      
      // Update the endIndex of the new section
      if (newSection.subsections.length > 0) {
        newSection.endIndex = newSection.subsections[newSection.subsections.length - 1].endIndex;
      } else {
        const nextSectionIndex = content.indexOf('=', newSection.startIndex + sectionMarker.length);
        newSection.endIndex = nextSectionIndex !== -1 ? nextSectionIndex : content.length;
      }
    } else if (block.getContext() === 'paragraph') {
      currentSection.paragraphs++;
    } else if (block.getContext() === 'listing' && block.getStyle() === 'source') {
      currentSection.code_blocks++;
    }
  };

  doc.getBlocks().forEach(block => processBlock(block, rootSection, content));

  // Count paragraphs and code blocks in the root section
  const countRootBlocks = (section) => {
    section.subsections.forEach(subsection => {
      section.paragraphs += subsection.paragraphs;
      section.code_blocks += subsection.code_blocks;
      countRootBlocks(subsection);
    });
  };

  countRootBlocks(rootSection);

  return rootSection;
};
