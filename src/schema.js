export const schema = {
  type: "object",
  additionalProperties: false,
  patternProperties: {
    "^[A-Za-z-_]+$": {
      type: "object",
      additionalProperties: false,
      properties: {
        sections: {
          type: "object",
          additionalProperties: false,
          patternProperties: {
            "^[A-Za-z-_]+$": {
              $ref: "#/definitions/section",
            },
          },
        },
      },
    },
  },
  definitions: {
    paragraphs: {
      type: "object",
      properties: {
        min: {
          description: "Minimum number of paragraphs",
          type: "integer",
          minimum: 0,
        },
        max: {
          description: "Maximum number of paragraphs",
          type: "integer",
        },
        patterns: {
          description:
            "Array of regex patterns for paragraphs, applied in sequence to paragraphs as they appear",
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    },
    code_blocks: {
      description: "Code block requirements",
      type: "object",
      properties: {
        min: {
          description: "Minimum number of code blocks",
          type: "integer",
          minimum: 0,
        },
        max: {
          description: "Maximum number of code blocks",
          type: "integer",
        },
      },
    },
    lists: {
      description: "List requirements",
      type: "object",
      properties: {
        min: {
          description: "Minimum number of lists",
          type: "integer",
          minimum: 0,
        },
        max: {
          description: "Maximum number of lists",
          type: "integer",
        },
        items: {
          description: "Item requirements",
          type: "object",
          properties: {
            min: {
              description: "Minimum number of items in a list",
              type: "integer",
              minimum: 0,
            },
            max: {
              description: "Maximum number of items in a list",
              type: "integer",
            },
            paragraphs: {
              $ref: "#/definitions/paragraphs",
            },
            code_blocks: {
              $ref: "#/definitions/code_blocks",
            },
            lists: {
              $ref: "#/definitions/lists",
            },
          },
        },
      },
    },
    sequence_item: {
      type: "object",
      additionalProperties: false,
      anyOf: [
        {
          properties: {
            paragraphs: {
              $ref: "#/definitions/paragraphs",
            },
          },
        },
        {
          properties: {
            code_blocks: {
              $ref: "#/definitions/code_blocks",
            },
          },
        },
        {
          properties: {
            lists: {
              $ref: "#/definitions/lists",
            },
          },
        },
      ],
    },
    section: {
      description: "A section of a document demarkated by a heading",
      type: "object",
      additionalProperties: false,
      properties: {
        description: {
          description: "Description of the section",
          type: "string",
        },
        heading: {
          description: "Heading rules",
          type: "object",
          anyOf: [
            {
              properties: {
                const: {
                  description: "Exact heading of the section",
                  type: "string",
                },
              },
            },
            {
              properties: {
                pattern: {
                  description: "Regex pattern for the heading",
                  type: "string",
                },
              },
            },
          ],
        },
        required: {
          description: "Whether the section is required",
          type: "boolean",
          default: true,
        },
        sequence: {
          description: "Ordered sequence of elements in the section",
          type: "array",
          minItems: 1,
          items: {
            $ref: "#/definitions/sequence_item",
          },
        },
        paragraphs: {
          $ref: "#/definitions/paragraphs",
        },
        code_blocks: {
          $ref: "#/definitions/code_blocks",
        },
        lists: {
          $ref: "#/definitions/lists",
        },
        additionalSections: {
          description: "Allow undefined sections",
          type: "boolean",
          default: false,
        },
        sections: {
          description: "Object of subsections",
          type: "object",
          patternProperties: {
            "^[A-Za-z-_]+": {
              anyOf: [{ $ref: "#/definitions/section" }],
            },
          },
        },
      },
    },
  },
};
