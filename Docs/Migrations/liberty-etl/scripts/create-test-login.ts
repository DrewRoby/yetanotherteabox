// One-off: create a single OWNER login against the scratch DB so the migrated data
// can be smoke-tested in the running app. Not part of the migration batch itself —
// real User/UserRole migration (staff + any consignor logins) is a separate,
// not-yet-built step; this shop has none of the latter (spec §3.1).
import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { prisma } from "../load/prisma";

async function main() {
  const store = await prisma.store.findFirstOrThrow();
  const email = "sherry@hiddentreasures.test";
  const password = "test-login-123!";
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: "Sherry Stacey" },
    update: { passwordHash },
  });

  await prisma.userRole.upsert({
    where: { userId_role_storeId: { userId: user.id, role: "OWNER", storeId: store.id } },
    create: { userId: user.id, role: "OWNER", storeId: store.id },
    update: {},
  });

  console.log(`Login ready: ${email} / ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
