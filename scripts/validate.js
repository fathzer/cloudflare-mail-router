#!/usr/bin/env node
// Validates redirection table files (default: redirections.json).
// Prints the errors on stderr and exits with code 1 if a file is not valid.
import { readFileSync } from 'node:fs';
import { findDuplicateKeys, validate } from '../src/redirections.js';

const files = process.argv.slice(2);
if (files.length === 0) files.push('redirections.json');

let failed = false;
for (const file of files) {
  const errors = [];
  try {
    const text = readFileSync(file, 'utf8');
    const table = JSON.parse(text);
    errors.push(...findDuplicateKeys(text).map((key) => `Duplicate source address: ${key}`));
    errors.push(...validate(table));
  } catch (e) {
    errors.push(e.message);
  }
  if (errors.length > 0) {
    failed = true;
    for (const error of errors) console.error(`${file}: ${error}`);
  } else {
    console.error(`${file}: OK`);
  }
}
process.exit(failed ? 1 : 0);
