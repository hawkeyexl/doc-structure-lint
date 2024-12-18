import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Gets content from a URL or file path, processes it, and returns the content or saves to temp directory if remote.
 * 
 * @async
 * @function getFile
 * @param {string} pathOrUrl - The URL or file path to get content from.
 * @returns {Promise<Object>} - A promise that resolves to an object containing the result status and content info.
 * @property {string} result - The result status, either "success" or "error".
 * @property {string} [path] - The path to the content (file path or saved temp file).
 * @property {string} [content] - The file content (only for local files).
 * @property {string} [message] - The error message (only present if result is "error").
 */
async function getFile(pathOrUrl) {
  try {
    // Check if the input is a URL or file path
    const isURL = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://');
    
    if (isURL) {
      // Fetch content from URL
      const response = await axios.get(pathOrUrl);
      let content = response.data;

      // Convert content to string if it's an object
      if (typeof content === "object") {
        content = JSON.stringify(content, null, 2);
      } else {
        content = content.toString();
      }
      
      // Create unique filename using MD5 hash
      const fileName = pathOrUrl.split("/").pop();
      const hash = crypto.createHash("md5").update(content).digest("hex");
      const filePath = `${os.tmpdir}/doc-structure-lint/${hash}_${fileName}`;
      
      // If doc-structure-lint temp directory doesn't exist, create it
      if (!fs.existsSync(`${os.tmpdir}/doc-structure-lint`)) {
        fs.mkdirSync(`${os.tmpdir}/doc-structure-lint`);
      }
      // If file doesn't exist, write it
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, response.data);
      }
        
      return { result: "success", path: filePath };
    } else {
      // Handle local file path
      const currentFilePath = fileURLToPath(import.meta.url);
      const currentDir = path.dirname(currentFilePath);
      // Convert relative path to absolute if needed
      const absolutePath = path.isAbsolute(pathOrUrl) 
        ? pathOrUrl 
        : path.resolve(currentDir, pathOrUrl);

      // Check if file exists
      if (!fs.existsSync(absolutePath)) {
        return { result: "error", message: "File not found" };
      }

      // Read and return file content
      const content = fs.readFileSync(absolutePath, 'utf8');
      return { 
        result: "success", 
        path: absolutePath,
        content
      };
    }
  } catch (error) {
    // Return any errors encountered
    return { result: "error", message: error };
  }
}

export default getFile;
