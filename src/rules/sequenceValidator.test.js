import { expect } from "chai";
import { validateSequence } from "./sequenceValidator.js";
import { ValidationError } from "./ValidationError.js";

describe("validateSequence", () => {
  it("should return an empty array if template.sequence or structure.content is missing", () => {
    const structure = {};
    const template = {};
    const result = validateSequence(structure, template);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should return a length error if sequence lengths do not match", () => {
    const structure = {
      content: [{ paragraphs: "content1" }],
      heading: { content: "heading1" },
      position: { line: 1, column: 1 },
    };
    const template = {
      sequence: [{ paragraphs: "template1" }, { code_blocks: "template2" }],
    };
    const result = validateSequence(structure, template);
    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.be.instanceOf(ValidationError);
    expect(result[0].message).to.include(
      "Expected 2 content types in sequence, but found 1"
    );
  });

  it("should return an order error if sequence order is incorrect", () => {
    const structure = {
      content: [{ paragraphs: "content1" }, { code_blocks: "content2" }],
      heading: { content: "heading1" },
      position: { line: 1, column: 1 },
    };
    const template = {
      sequence: [{ code_blocks: "template1" }, { paragraphs: "template2" }],
    };
    const result = validateSequence(structure, template);
    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.be.instanceOf(ValidationError);
    expect(result[0].message).to.include(
      'Expected sequence ["code_blocks","paragraphs"], but found sequence ["paragraphs","code_blocks"]'
    );
  });

  it("should return validation errors for each sequence item", () => {
    const structure = {
      content: [
        {
          paragraphs: [
            {
              content: "Before you begin, make sure you have the following:",
              position: {
                start: {
                  line: 14,
                  column: 1,
                  offset: 241,
                },
                end: {
                  line: 14,
                  column: 52,
                  offset: 292,
                },
              },
            },
          ],
        },
        {
          lists: [
            {
              ordered: false,
              items: [
                {
                  position: {
                    start: {
                      line: 16,
                      column: 1,
                      offset: 294,
                    },
                    end: {
                      line: 16,
                      column: 22,
                      offset: 315,
                    },
                  },
                  content: [
                    {
                      content: "A valid license key",
                      position: {
                        start: {
                          line: 16,
                          column: 3,
                          offset: 296,
                        },
                        end: {
                          line: 16,
                          column: 22,
                          offset: 315,
                        },
                      },
                    },
                  ],
                },
                {
                  position: {
                    start: {
                      line: 17,
                      column: 1,
                      offset: 316,
                    },
                    end: {
                      line: 17,
                      column: 22,
                      offset: 337,
                    },
                  },
                  content: [
                    {
                      content: "At least 4GB of RAM",
                      position: {
                        start: {
                          line: 17,
                          column: 3,
                          offset: 318,
                        },
                        end: {
                          line: 17,
                          column: 22,
                          offset: 337,
                        },
                      },
                    },
                  ],
                },
                {
                  position: {
                    start: {
                      line: 19,
                      column: 1,
                      offset: 339,
                    },
                    end: {
                      line: 19,
                      column: 6,
                      offset: 344,
                    },
                  },
                  content: [
                    {
                      content: "foo",
                      position: {
                        start: {
                          line: 19,
                          column: 3,
                          offset: 341,
                        },
                        end: {
                          line: 19,
                          column: 6,
                          offset: 344,
                        },
                      },
                    },
                  ],
                },
                {
                  position: {
                    start: {
                      line: 20,
                      column: 1,
                      offset: 345,
                    },
                    end: {
                      line: 20,
                      column: 6,
                      offset: 350,
                    },
                  },
                  content: [
                    {
                      content: "bar",
                      position: {
                        start: {
                          line: 20,
                          column: 3,
                          offset: 347,
                        },
                        end: {
                          line: 20,
                          column: 6,
                          offset: 350,
                        },
                      },
                    },
                  ],
                },
                {
                  position: {
                    start: {
                      line: 22,
                      column: 1,
                      offset: 352,
                    },
                    end: {
                      line: 22,
                      column: 4,
                      offset: 355,
                    },
                  },
                  content: [
                    {
                      content: "x",
                      position: {
                        start: {
                          line: 22,
                          column: 3,
                          offset: 354,
                        },
                        end: {
                          line: 22,
                          column: 4,
                          offset: 355,
                        },
                      },
                    },
                  ],
                },
                {
                  position: {
                    start: {
                      line: 23,
                      column: 1,
                      offset: 356,
                    },
                    end: {
                      line: 23,
                      column: 4,
                      offset: 359,
                    },
                  },
                  content: [
                    {
                      content: "y",
                      position: {
                        start: {
                          line: 23,
                          column: 3,
                          offset: 358,
                        },
                        end: {
                          line: 23,
                          column: 4,
                          offset: 359,
                        },
                      },
                    },
                  ],
                },
              ],
              position: {
                start: {
                  line: 16,
                  column: 1,
                  offset: 294,
                },
                end: {
                  line: 23,
                  column: 4,
                  offset: 359,
                },
              },
            },
          ],
        },
      ],
      heading: { content: "heading1" },
      position: { line: 1, column: 1 },
    };
    const template = {
      sequence: [{ paragraphs: { min: 5 } }, { lists: { min: 5 } }],
    };

    const result = validateSequence(structure, template);
    expect(result).to.have.lengthOf(2);
    expect(result[0]).to.be.instanceOf(ValidationError);
    expect(result[0].message).to.include("Expected at least 5 paragraphs, but found 1");
    expect(result[1]).to.be.instanceOf(ValidationError);
    expect(result[1].message).to.include("Expected at least 5 lists, but found 1");
  });
});
