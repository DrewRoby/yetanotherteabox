// Deliberately imports the Prisma Client already generated for server/prisma/schema.prisma
// rather than maintaining a second copy/schema here — this tool has no schema of its
// own, it targets Teabox's real one. Re-run `npx prisma generate` in server/ after any
// schema change; this file just needs that generated client to exist.
import * as path from "path";

const serverClientPath = path.join(__dirname, "..", "..", "..", "..", "server", "node_modules", "@prisma", "client");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require(serverClientPath);

export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TEABOX_DATABASE_URL } },
});
