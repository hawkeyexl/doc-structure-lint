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
    section: {
      description: "A section of a document demarkated by a heading",
      type: "object",
      additionalProperties: false,
      properties: {
        description: {
          description: "Description of the section",
          type: "string",
        },
        title: {
          description: "Exact title of the section",
          type: "object",
          properties: {
            const: {
              description: "Exact title of the section",
              type: "string",
            },
          },
        },
        required: {
          description: "Whether the section is required",
          type: "boolean",
          default: true,
        },
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
