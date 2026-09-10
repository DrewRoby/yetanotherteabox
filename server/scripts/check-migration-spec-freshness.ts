// Guards against Docs/Migrations/sql_server_data_model_migration_spec.md going stale
// silently. The spec's own header already says "update this doc whenever
// schema.prisma or enums.ts changes" — this makes that machine-checkable instead of
// relying on someone remembering. No git hook: this repo has no CI (see root
// CLAUDE.md's "Deliberate simplifications"), so this stays a manual-but-cheap command,
// same trust model as the sentence it backs up.
//
// Usage:
//   npm run check:migration-spec            # verify, exit 1 on mismatch
//   npm run check:migration-spec -- --write # re-stamp after updating the spec
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..");
const SCHEMA_PATH = path.join(ROOT, "server", "prisma", "schema.prisma");
const ENUMS_PATH = path.join(ROOT, "server", "src", "lib", "enums.ts");
const SPEC_PATH = path.join(ROOT, "Docs", "Migrations", "sql_server_data_model_migration_spec.md");

const STAMP_RE = /<!-- migration-spec-freshness: schema\.prisma=([a-f0-9]{8}) enums\.ts=([a-f0-9]{8}) -->/;

function hash(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function main() {
  const write = process.argv.includes("--write");
  const schemaHash = hash(SCHEMA_PATH);
  const enumsHash = hash(ENUMS_PATH);
  const stampLine = `<!-- migration-spec-freshness: schema.prisma=${schemaHash} enums.ts=${enumsHash} -->`;

  const spec = fs.readFileSync(SPEC_PATH, "utf8");
  const match = spec.match(STAMP_RE);

  if (write) {
    const next = match ? spec.replace(STAMP_RE, stampLine) : `${stampLine}\n${spec}`;
    fs.writeFileSync(SPEC_PATH, next);
    console.log(`Stamped ${path.relative(ROOT, SPEC_PATH)} with ${stampLine}`);
    return;
  }

  if (!match) {
    console.error(
      `No freshness stamp found in ${path.relative(ROOT, SPEC_PATH)}.\n` +
        `Run 'npm run check:migration-spec -- --write' after confirming the spec is current.`
    );
    process.exit(1);
  }

  const [, stampedSchema, stampedEnums] = match;
  const problems: string[] = [];
  if (stampedSchema !== schemaHash) problems.push("server/prisma/schema.prisma");
  if (stampedEnums !== enumsHash) problems.push("server/src/lib/enums.ts");

  if (problems.length > 0) {
    console.error(
      `Docs/Migrations/sql_server_data_model_migration_spec.md may be stale — ` +
        `changed since last stamped: ${problems.join(", ")}.\n` +
        `Update the spec's affected sections, then run 'npm run check:migration-spec -- --write'.`
    );
    process.exit(1);
  }

  console.log("Migration spec is up to date with schema.prisma and enums.ts.");
}

main();
