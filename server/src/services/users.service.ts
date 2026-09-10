import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { sendEmail } from "../adapters/email";
import { ACCOUNT_SCOPED_ROLES, roleToAccountType, type Role } from "../lib/enums";

// Invite flow (Settings > Users & Permissions, app_flow_document.md): creates the
// User if new, grants the requested role at this store, and — for account-scoped
// roles — creates the linked Account so intake/POS/reporting has somewhere to point.
// Real deployments would email a set-password link; here the temp password is
// logged via the email stub and returned to the inviting admin for local testing.
export async function inviteUser(params: {
  storeId: string;
  email: string;
  name: string;
  role: Role;
  accountName?: string;
  splitPercent?: number;
}) {
  const tempPassword = crypto.randomBytes(6).toString("hex");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  let user = await prisma.user.findUnique({ where: { email: params.email } });
  if (!user) {
    user = await prisma.user.create({ data: { email: params.email, name: params.name, passwordHash } });
  }

  let accountId: string | undefined;
  const accountType = roleToAccountType(params.role);
  if (accountType) {
    const account = await prisma.account.create({
      data: {
        storeId: params.storeId,
        accountType,
        name: params.accountName || params.name,
        email: params.email,
        splitPercent: ACCOUNT_SCOPED_ROLES.includes(params.role) ? params.splitPercent ?? 60 : undefined,
      },
    });
    accountId = account.id;
  }

  const userRole = await prisma.userRole.create({
    data: { userId: user.id, role: params.role, storeId: params.storeId, accountId },
  });

  await sendEmail(
    params.email,
    "You've been invited to Teabox",
    `You've been added as ${params.role}. Temporary password: ${tempPassword}`
  );

  return { user, userRole, tempPassword };
}
