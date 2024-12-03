import { remark } from "remark";
import remarkFrontmatter from "remark-frontmatter";
import { v4 as uuid } from "uuid";

export function parseMarkdown(content) {
  const tree = remark().use(remarkFrontmatter).parse(content);
  let currentSection = null;

  const result = {
    frontmatter: [],
    sections: [],
  };

  const updateParentPositions = (section, endPosition) => {
    if (!section || !endPosition) return;

    // Ensure position object exists
    if (!section.position) {
      section.position = {
        start: { line: 0, column: 0, offset: 0 },
        end: { line: 0, column: 0, offset: 0 },
      };
    }

    // Update section's end position if the new end position is greater
    if (section.position.end.offset < endPosition.offset) {
      section.position.end = { ...endPosition };
    }

    // Find and update parent's position
    const parent = findParent(result, section.id);
    if (parent && parent.position) {
      updateParentPositions(parent, endPosition);
    }
  };

  const processSection = (node) => {
    const newSection = {
      id: uuid(),
      position: node.position,
      heading: {
        level: node.depth,
        position: node.position,
        content: node.children.map((child) => child.value).join(""),
      },
      paragraphs: [],
      codeBlocks: [],
      lists: [],
      sections: [],
    };
    return newSection;
  };

  const processParagraph = (node) => {
    const result = {
      position: node.position,
      content: node.children.map((child) => child.value).join(""),
    };
    return result;
  };

  const processCodeBlock = (node) => {
    const result = {
      position: node.position,
      content: `\`\`\`${node.lang}\n${node.value}\`\`\``,
    };
    return result;
  };

  const processList = (node) => {
    const result = {
      position: node.position,
      ordered: node.ordered,
      items: node.children.map((item) => {
        if (item.type === "listItem") {
          return {
            position: item.position,
            content: item.children.map((child) => {
              switch (child.type) {
                case "paragraph":
                  return processParagraph(child);
                case "code":
                  return processCodeBlock(child);
                case "list":
                  return processList(child);
                default:
                  return {
                    position: child.position,
                    content: child.value || "",
                  };
                }
            }),
          };
        }
      }),
    };
    return result;
  };

  const processNode = (node, parentSection) => {
    if (node.type === "yaml") {
      const items = node.value
        .trim()
        .split("\n")
        .map((item) => {
          const parts = item.split(":");
          return {
            key: parts[0].trim(),
            value: parts.slice(1).join(":").trim(),
          };
        });
      result.frontmatter = items;
    } else if (node.type === "heading") {
      // Ensure result has a position object before creating new section
      const newSection = processSection(node);

      // Update parent section's end position
      if (parentSection) {
        updateParentPositions(parentSection, node.position.end);
      }

      if (node.depth === 1) {
        result.sections.push(newSection);
      } else if (currentSection && node.depth > currentSection.heading.level) {
        currentSection.sections.push(newSection);
      } else if (currentSection && node.depth <= currentSection.heading.level) {
        let parent = findParent(result, currentSection.id);
        while (parent && node.depth <= parent.heading.level) {
          parent = findParent(result, parent.id);
        }
        if (parent) {
          parent.sections.push(newSection);
        }
      }

      currentSection = newSection;
    } else if (node.type === "paragraph") {
      const paragraph = processParagraph(node);
      updateParentPositions(parentSection, node.position.end);
      currentSection.paragraphs.push(paragraph);
    } else if (node.type === "code") {
      const codeBlock = processCodeBlock(node);
      updateParentPositions(parentSection, node.position.end);
      currentSection.codeBlocks.push(codeBlock);
    } else if (node.type === "list") {
      const list = processList(node);
      updateParentPositions(parentSection, node.position.end);
      currentSection.lists.push(list);
    }

    if (node.children && node.type !== "list") {
      node.children.forEach((child) => processNode(child, currentSection));
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
