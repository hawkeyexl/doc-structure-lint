import MarkdownIt from "markdown-it";

const md = new MarkdownIt();

export function parseMarkdown(content) {
  const tokens = md.parse(content, {});
  const sections = [];
  let currentSection = null;
  let charIndex = 0;

  for (const token of tokens) {
    if (token.type === "heading_open") {
      if (currentSection) {
        currentSection.endIndex = charIndex;
        sections.push(currentSection);
      }
      currentSection = {
        title: "",
        level: parseInt(token.tag.slice(1)),
        paragraphs: 0,
        code_blocks: 0,
        subsections: [],
        startIndex: charIndex,
        endIndex: null,
      };
    } else if (
      token.type === "inline" &&
      currentSection &&
      !currentSection.title
    ) {
      currentSection.title = token.content;
    } else if (token.type === "paragraph_open") {
      currentSection.paragraphs++;
    } else if (token.type === "fence") {
      currentSection.code_blocks++;
    }
    charIndex += token.content ? token.content.length : 0;
  }

  if (currentSection) {
    currentSection.endIndex = charIndex;
    sections.push(currentSection);
  }

  return organizeHierarchy(sections);
}

function organizeHierarchy(sections) {
  const root = { subsections: [] };
  const stack = [root];

  for (const section of sections) {
    while (stack.length > 1 && stack[stack.length - 1].level >= section.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    parent.subsections.push(section);
    stack.push(section);
  }

  return root.subsections[0];
}
