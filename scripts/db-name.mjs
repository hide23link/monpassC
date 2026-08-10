#!/usr/bin/env node
// Prints the D1 database name configured in wrangler.jsonc. Used by npm
// scripts so they aren't hardcoded to one deployment's database name.
import { readFileSync } from "node:fs";

const raw = readFileSync("wrangler.jsonc", "utf8").replace(/\/\/.*$/gm, "");
const config = JSON.parse(raw);
console.log(config.d1_databases[0].database_name);
