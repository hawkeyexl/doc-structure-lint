#!/usr/bin/env node

import fs from "fs";
import os from "os";
import path from "path";

const dir = path.join(os.tmpdir(), "doc-structure-lint");

export function getTempDir() {
  // Recursively create the directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function cleanTempDir(filesToKeep) {
  // Clean up any files in the directory that aren't expected
  fs.readdirSync(dir).forEach((file) => {
    if (!filesToKeep.includes(file)) {
      fs.unlinkSync(path.join(dir, file));
    }
  });
  return fs.readdirSync(dir);
}

// Only run the cleanup if this file is being executed directly
if (process.argv[1].endsWith("tempDir.js") && process.argv[2] === "clean") {
  cleanTempDir([]);
}