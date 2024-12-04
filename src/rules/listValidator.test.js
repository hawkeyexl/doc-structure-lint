import { expect } from "chai";
import { validateLists } from "./listValidator.js";
import { ValidationError } from "./ValidationError.js";

describe("validateLists", () => {
  let section, template;

  beforeEach(() => {
    section = {
      lists: [],
      heading: { content: "Section Heading" },
      position: { start: 1, end: 2 },
    };

    template = {
      lists: {
        min: 1,
        max: 3,
        items: {
          min: 1,
          max: 5,
        },
      },
    };
  });

  it("should return an empty array if template.lists is not defined", () => {
    delete template.lists;
    const result = validateLists(section, template);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should return an empty array if section.lists is not defined", () => {
    delete section.lists;
    const result = validateLists(section, template);
    expect(result).to.be.an("array").that.is.empty;
  });

  it("should return a ValidationError if the number of lists is less than the minimum required", () => {
    section.lists = [];
    const result = validateLists(section, template);
    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.be.instanceOf(ValidationError);
    expect(result[0].message).to.include("Expected at least 1 lists");
  });

  it("should return a ValidationError if the number of lists exceeds the maximum allowed", () => {
    section.lists = [
      { items: [1] },
      { items: [1] },
      { items: [1] },
      { items: [1] },
    ];
    const result = validateLists(section, template);
    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.be.instanceOf(ValidationError);
    expect(result[0].message).to.include("Expected at most 3 lists");
  });

  it("should return a ValidationError if any list exceeds the maximum number of items", () => {
    section.lists = [{ items: [1, 2, 3, 4, 5, 6] }];
    const result = validateLists(section, template);
    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.be.instanceOf(ValidationError);
    expect(result[0].message).to.include("Expected at most 5 items in a list");
  });

  it("should return a ValidationError if any list has fewer items than the minimum required", () => {
    section.lists = [{ items: [] }];
    const result = validateLists(section, template);
    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.be.instanceOf(ValidationError);
    expect(result[0].message).to.include("Expected at least 1 items in a list");
  });

  it("should return multiple ValidationErrors if multiple validation rules are violated", () => {
    section.lists = [{ items: [] }, { items: [1, 2, 3, 4, 5, 6] }];
    const result = validateLists(section, template);
    expect(result).to.have.lengthOf(2);
    expect(result[0]).to.be.instanceOf(ValidationError);
    expect(result[1]).to.be.instanceOf(ValidationError);
  });

  it("should return an empty array if all validation rules are satisfied", () => {
    section.lists = [{ items: [1, 2] }, { items: [1, 2, 3] }];
    const result = validateLists(section, template);
    expect(result).to.be.an("array").that.is.empty;
  });
});
