import MarkdownIt from "markdown-it";
import markdownItFrontMatter from "markdown-it-front-matter";

const md = new MarkdownIt().use(markdownItFrontMatter, function (fm) {

});

export function parseMarkdown(content) {
  const tokens = md.parse(content, {});
  let rootSection = null;
  let currentSection = null;
  let sectionStack = [];
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
    }
    else if (token.type === "heading_open") {
      const level = parseInt(token.tag.slice(1));

      if (level === 1 && !rootSection) {
        rootSection = {
          startIndex: charIndex,
          endIndex: content.length,
          heading: {
            startIndex: charIndex,
            endIndex: null,
            content: "",
          },
          paragraphs: [],
          sections: [],
        };
        currentSection = rootSection;
        sectionStack = [rootSection];
        result.sections.push(rootSection);
      } else {
        while (
          sectionStack.length > 1 &&
          sectionStack[sectionStack.length - 1].level >= level
        ) {
          sectionStack.pop();
        }

        const newSection = {
          startIndex: charIndex,
          endIndex: null,
          heading: {
            startIndex: charIndex,
            endIndex: null,
            content: "",
          },
          paragraphs: [],
          sections: [],
        };

        sectionStack[sectionStack.length - 1].sections.push(newSection);
        sectionStack.push(newSection);
        currentSection = newSection;
      }
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
