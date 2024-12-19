import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import YAML from "yaml";
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
export async function getFile(pathOrUrl) {
  try {
    // Check if the input is a URL or file path
    const isURL =
      pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://");

    let content;
    if (isURL) {
      // Fetch content from URL
      const response = await axios.get(pathOrUrl);
      content = response.data;
    } else {
      // Handle local file path
      const currentDir = process.cwd();
      // Convert relative path to absolute if needed
      const absolutePath = path.isAbsolute(pathOrUrl)
        ? pathOrUrl
        : path.resolve(currentDir, pathOrUrl);

      // Check if file exists
      if (!fs.existsSync(absolutePath)) {
        return { result: "error", message: "File not found" };
      }

      // Read and return file content
      content = fs.readFileSync(absolutePath, "utf8");
      pathOrUrl = absolutePath;
    }

    if (typeof content === "string") {
      // If file is YAML, parse it
      if (pathOrUrl.endsWith(".yaml") || pathOrUrl.endsWith(".yml")) {
        content = YAML.parse(content);
      } else if (pathOrUrl.endsWith(".json")) {
        // If file is JSON, parse it
        content = JSON.parse(content);
      }
    }
    return { result: "success", content, path: pathOrUrl };
  } catch (error) {
    // Return any errors encountered
    return { result: "error", message: error };
  }
}
