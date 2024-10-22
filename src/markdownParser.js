import MarkdownIt from "markdown-it";
import markdownItFrontMatter from "markdown-it-front-matter";
import { v4 as uuid } from "uuid";

const md = new MarkdownIt().use(markdownItFrontMatter, function (fm) {});

export function parseMarkdown(content) {
  const tokens = md.parse(content, {});
  let currentSection = null;
  let charIndex = 0;

  const result = {
    frontmatter: [],
    sections: [],
  };

  for (const token of tokens) {
    charIndex += token.content.length;

    if (token.type === "front_matter") {
      let items = token.meta.trim().split("\n");
      items = items.map((item) => {
        const parts = item.split(":");
        return {
          key: parts[0].trim(),
          value: parts.slice(1).join(":").trim(),
        };
      });
      result.frontmatter = items;
    } else if (token.type === "heading_open") {
      const level = parseInt(token.tag.slice(1));

      const newSection = {
        id: `${uuid()}`,
        startIndex: charIndex,
        endIndex: `null`,
        heading: {
          level,
          startIndex: charIndex,
          endIndex: null,
          content: "",
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
    } else if (
      token.type === "inline" &&
      currentSection &&
      !currentSection.heading.content
    ) {
      currentSection.heading.content = token.content;
      currentSection.heading.endIndex = charIndex;
    } else if (token.type === "paragraph_open") {
      const paragraph = {
        startIndex: charIndex,
        endIndex: null,
        content: "",
      };
      currentSection.paragraphs.push(paragraph);
    } else if (
      token.type === "inline" &&
      currentSection.paragraphs.length > 0
    ) {
      const paragraph =
        currentSection.paragraphs[currentSection.paragraphs.length - 1];
      paragraph.content += token.content;
      paragraph.endIndex = charIndex;
    } else if (token.type === "fence") {
      const codeBlock = {
        startIndex: charIndex,
        endIndex: charIndex + token.content.length,
        content: `\`\`\`${token.info}\n${token.content}\`\`\``,
      };
      if (!currentSection.codeBlocks) {
        currentSection.codeBlocks = [];
      }
      currentSection.codeBlocks.push(codeBlock);
    }
  }

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