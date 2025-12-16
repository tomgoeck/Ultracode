#!/usr/bin/env node

/**
 * Test Runner for Ultracode MAKER
 * Uses native Node.js test runner (node:test)
 */

const { run } = require("node:test");
const { spec } = require("node:test/reporters");
const path = require("path");

console.log("🧪 Running Ultracode MAKER Test Suite\n");

// Run all test files
run({
  files: [
    path.join(__dirname, "integration.test.js"),
  ],
  concurrency: 1, // Run tests sequentially
})
  .compose(spec) // Use spec reporter for readable output
  .pipe(process.stdout)
  .on("end", () => {
    console.log("\n✅ All tests completed!");
  });
