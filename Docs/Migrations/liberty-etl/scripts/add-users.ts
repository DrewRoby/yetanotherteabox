// Bulk-add (or update) logins for an EXISTING, already-migrated Teabox store, driven
// by config/store.yaml — the repeatable counterpart to scripts/migrate.ts, which
// deliberately refuses to run a second time once a Store exists. Use this one for
// the ongoing case: "hire a new employee", "give this consignor a portal login",
// "add a manager", etc.
//
// Idempotent: re-running with the same config is a no-op for anything already
// granted. Add new entries to config/store.yaml under `roles:` (or edit `owner:`)
// and re-run to apply just the difference — existing Users/UserRoles are left alone
// except that an account-scoped role's `accountId` is updated if the config's
// `account:` name now resolves to a different Account.
//
// Usage: TEABOX_DATABASE_URL="file:<path to the live/target DB>" npm run add-users
import "dotenv/config";
import { loadStoreConfig } from "../config/loadStoreConfig";
import { prisma } from "../load/prisma";
import { applyUsersAndRoles } from "../load/users";

async function main() {
  const config = loadStoreConfig();

  const store = await prisma.store.findFirst();
  if (!store) {
    throw new Error(
      "No Store found in the target DB — this script only adds users to an already-set-up store. " +
        "Run scripts/migrate.ts (or complete the app's Setup Wizard) first."
    );
  }

  const accounts: { id: string; name: string }[] = await prisma.account.findMany({
    where: { storeId: store.id },
    select: { id: true, name: true },
  });
  const accountIdByName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a.id]));

  const result = await applyUsersAndRoles(store.id, config, accountIdByName);

  console.log(`Store: "${store.name}"\n`);

  if (result.usersCreated.length) {
    console.log(`Created ${result.usersCreated.length} new User(s):`);
    for (const u of result.usersCreated) console.log(`  ${u.email.padEnd(35)} ${u.name}`);
  } else {
    console.log("No new Users created.");
  }

  if (result.rolesGranted.length) {
    console.log(`\nGranted ${result.rolesGranted.length} new role(s):`);
    for (const r of result.rolesGranted) console.log(`  ${r.role.padEnd(12)} ${r.email}`);
  }

  if (result.rolesUpdated.length) {
    console.log(`\nUpdated ${result.rolesUpdated.length} existing role grant(s) (account mapping changed):`);
    for (const r of result.rolesUpdated) console.log(`  ${r.role.padEnd(12)} ${r.email}`);
  }

  if (result.rolesUnchanged.length) {
    console.log(`\n${result.rolesUnchanged.length} role grant(s) already existed, unchanged.`);
  }

  if (result.unmatchedAccounts.length) {
    console.warn(
      `\nWARNING: ${result.unmatchedAccounts.length} config role entr${result.unmatchedAccounts.length === 1 ? "y" : "ies"} ` +
        `could not be matched to an existing Account by name and were skipped:\n  ${result.unmatchedAccounts.join("\n  ")}`
    );
  }

  if (result.usersCreated.length === 0 && result.rolesGranted.length === 0 && result.rolesUpdated.length === 0) {
    console.log("\nNothing to do — config/store.yaml already matches the database.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
