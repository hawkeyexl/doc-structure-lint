import { expect } from 'chai';
import { validateStructure } from '../src/structureValidator.js';

describe('validateStructure', () => {
  it('should return no errors for a valid structure', () => {
    const section = {
      title: 'Test Section',
      paragraphs: 2,
      code_blocks: 1,
      subsections: [],
      startIndex: 0,
      endIndex: 100
    };
    const template = {
      title: { const: 'Test Section' },
      paragraphs: { min: 1, max: 3 },
      code_blocks: { min: 1, max: 2 }
    };
    const errors = validateStructure(section, template);
    expect(errors).to.have.lengthOf(0);
  });

  it('should return an error for incorrect title', () => {
    const section = {
      title: 'Wrong Title',
      paragraphs: 2,
      code_blocks: 1,
      subsections: [],
      startIndex: 0,
      endIndex: 100
    };
    const template = {
      title: { const: 'Correct Title' },
      paragraphs: { min: 1, max: 3 },
      code_blocks: { min: 1, max: 2 }
    };
    const errors = validateStructure(section, template);
    expect(errors).to.have.lengthOf(1);
    expect(errors[0].message).to.include('Expected title "Correct Title", but found "Wrong Title"');
  });

  it('should return an error for too few paragraphs', () => {
    const section = {
      title: 'Test Section',
      paragraphs: 1,
      code_blocks: 1,
      subsections: [],
      startIndex: 0,
      endIndex: 100
    };
    const template = {
      title: { const: 'Test Section' },
      paragraphs: { min: 2, max: 3 },
      code_blocks: { min: 1, max: 2 }
    };
    const errors = validateStructure(section, template);
    expect(errors).to.have.lengthOf(1);
    expect(errors[0].message).to.include('Expected at least 2 paragraphs, but found 1');
  });

  it('should return an error for too many code blocks', () => {
    const section = {
      title: 'Test Section',
      paragraphs: 2,
      code_blocks: 3,
      subsections: [],
      startIndex: 0,
      endIndex: 100
    };
    const template = {
      title: { const: 'Test Section' },
      paragraphs: { min: 1, max: 3 },
      code_blocks: { min: 1, max: 2 }
    };
    const errors = validateStructure(section, template);
    expect(errors).to.have.lengthOf(1);
    expect(errors[0].message).to.include('Expected at most 2 code blocks, but found 3');
  });

  it('should return an error for missing required subsection', () => {
    const section = {
      title: 'Test Section',
      paragraphs: 2,
      code_blocks: 1,
      subsections: [],
      startIndex: 0,
      endIndex: 100
    };
    const template = {
      title: { const: 'Test Section' },
      paragraphs: { min: 1, max: 3 },
      code_blocks: { min: 1, max: 2 },
      sections: {
        'Required Subsection': { required: true }
      }
    };
    const errors = validateStructure(section, template);
    expect(errors).to.have.lengthOf(1);
    expect(errors[0].message).to.include('Missing required section "Required Subsection"');
  });

  it('should return an error for unexpected subsection', () => {
    const section = {
      title: 'Test Section',
      paragraphs: 2,
      code_blocks: 1,
      subsections: [{ title: 'Unexpected Subsection', startIndex: 50, endIndex: 75 }],
      startIndex: 0,
      endIndex: 100
    };
    const template = {
      title: { const: 'Test Section' },
      paragraphs: { min: 1, max: 3 },
      code_blocks: { min: 1, max: 2 },
      sections: {}
    };
    const errors = validateStructure(section, template);
    expect(errors).to.have.lengthOf(1);
    expect(errors[0].message).to.include('Unexpected section "Unexpected Subsection"');
  });
});
