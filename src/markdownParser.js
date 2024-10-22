import MarkdownIt from "markdown-it";

const md = new MarkdownIt();

export function parseMarkdown(content) {
  const tokens = md.parse(content, {});
  let rootSection = null;
  let currentSection = null;
  let sectionStack = [];
  let charIndex = 0;

  for (const token of tokens) {
    if (token.type === "heading_open") {
      const level = parseInt(token.tag.slice(1));
      
      if (level === 1 && !rootSection) {
        rootSection = {
          title: "",
          level: 1,
          paragraphs: 0,
          code_blocks: 0,
          subsections: [],
          startIndex: charIndex,
          endIndex: content.length,
        };
        currentSection = rootSection;
        sectionStack = [rootSection];
      } else {
        while (sectionStack.length > 1 && sectionStack[sectionStack.length - 1].level >= level) {
          sectionStack.pop();
        }

        const newSection = {
          title: "",
          level: level,
          paragraphs: 0,
          code_blocks: 0,
          subsections: [],
          startIndex: charIndex,
          endIndex: null,
        };

        sectionStack[sectionStack.length - 1].subsections.push(newSection);
        sectionStack.push(newSection);
        currentSection = newSection;
      }
    } else if (token.type === "inline" && currentSection && !currentSection.title) {
      currentSection.title = token.content;
    } else if (token.type === "paragraph_open") {
      currentSection.paragraphs++;
    } else if (token.type === "fence") {
      currentSection.code_blocks++;
    }

    charIndex += token.content ? token.content.length : 0;
  }

  if (!rootSection) {
    rootSection = {
      title: "Untitled Document",
      level: 0,
      paragraphs: 0,
      code_blocks: 0,
      subsections: [],
      startIndex: 0,
      endIndex: content.length,
    };
  }

  // Set endIndex for all sections
  const setEndIndex = (section, endIndex) => {
    section.endIndex = endIndex;
    if (section.subsections.length > 0) {
      for (let i = 0; i < section.subsections.length; i++) {
        const nextIndex = i < section.subsections.length - 1 ? section.subsections[i + 1].startIndex : endIndex;
        setEndIndex(section.subsections[i], nextIndex);
      }
    }
  };
  setEndIndex(rootSection, content.length);

  return rootSection;
}
