import { expect } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getFile } from './getFile.js';

describe('getFile', () => {
    let sandbox;
    
    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it('should handle local file paths and return content', async () => {
        const testContent = 'test file content';
        const testPath = 'test.txt';
        
        sandbox.stub(fs, 'existsSync').returns(true);
        sandbox.stub(fs, 'readFileSync').returns(testContent);
        
        const result = await getFile(testPath);

        expect(result.result).to.equal('success');
        expect(result.content).to.equal(testContent);
        expect(result.path).to.include(testPath);
    });

    it('should return error for non-existent local files', async () => {
        sandbox.stub(fs, 'existsSync').returns(false);
        
        const result = await getFile('./nonexistent.txt');
        
        expect(result.result).to.equal('error');
        expect(result.message).to.equal('File not found');
    });

    it('should handle string responses from URLs', async () => {
        const testUrl = 'https://test.com/data.txt';
        const testData = 'value';
        
        sandbox.stub(axios, 'get').resolves({ data: testData });
        sandbox.stub(fs, 'existsSync').returns(false);
        sandbox.stub(fs, 'mkdirSync');
        sandbox.stub(fs, 'writeFileSync');
        
        const result = await getFile(testUrl);

        expect(typeof result.content).to.equal('string');
    });

    it('should handle JSON responses from URLs', async () => {
        const testUrl = 'https://test.com/data.json';
        const testData = { key: 'value' };
        
        sandbox.stub(axios, 'get').resolves({ data: testData });
        sandbox.stub(fs, 'existsSync').returns(false);
        sandbox.stub(fs, 'mkdirSync');
        sandbox.stub(fs, 'writeFileSync');
        
        const result = await getFile(testUrl);

        expect(typeof result.content).to.equal("object");
    });

    it('should handle YAML responses from URLs', async () => {
        const testUrl = 'https://test.com/data.yaml';
        const testData = 'key: value';
        
        sandbox.stub(axios, 'get').resolves({ data: testData });
        sandbox.stub(fs, 'existsSync').returns(false);
        sandbox.stub(fs, 'mkdirSync');
        sandbox.stub(fs, 'writeFileSync');
        
        const result = await getFile(testUrl);

        expect(typeof result.content).to.equal("object");
    }
)

    it('should handle errors during file operations', async () => {
        sandbox.stub(fs, 'existsSync').throws(new Error('File system error'));
        
        const result = await getFile('./test.txt');
        
        expect(result.result).to.equal('error');
        expect(result.message).to.be.an('error');
    });
});