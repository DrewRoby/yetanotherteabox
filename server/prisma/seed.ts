import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "teabox123!";

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  const passwordHash = await hash(DEMO_PASSWORD);

  const store = await prisma.store.create({
    data: { name: "MyResale Boutique — Demo Store", location: "Springfield, IL" },
  });

  const storeAccount = await prisma.account.create({
    data: { storeId: store.id, accountType: "STORE", name: "Store-Owned Inventory" },
  });

  const consignorAccount = await prisma.account.create({
    data: {
      storeId: store.id,
      accountType: "CONSIGNOR",
      name: "Jane Doe",
      email: "jane.consignor@example.com",
      splitPercent: 60,
      currentBalance: 1282.5,
    },
  });

  const boothAccount = await prisma.account.create({
    data: {
      storeId: store.id,
      accountType: "BOOTH_OWNER",
      name: "Vintage Vinyls (Booth #402)",
      email: "booth402@example.com",
      splitPercent: 70,
      currentBalance: 420.0,
    },
  });

  const donorAccount = await prisma.account.create({
    data: { storeId: store.id, accountType: "DONOR", name: "Estate Liquidation Donors" },
  });

  const vendorAccount = await prisma.account.create({
    data: {
      storeId: store.id,
      accountType: "VENDOR",
      name: "R. Vance Wholesale",
      splitPercent: 50,
      currentBalance: 95.0,
    },
  });

  // Users — one per internal role, plus a multi-role user (Manager + Consignor) to
  // exercise the login role-picker and Switch Role flow end to end.
  const owner = await prisma.user.create({
    data: { email: "owner@teabox.local", name: "Andrew Roby", passwordHash },
  });
  await prisma.userRole.create({ data: { userId: owner.id, role: "OWNER", storeId: store.id } });

  const multiRoleUser = await prisma.user.create({
    data: { email: "sarah@teabox.local", name: "Sarah Jenkins", passwordHash },
  });
  await prisma.userRole.create({ data: { userId: multiRoleUser.id, role: "MANAGER", storeId: store.id } });
  await prisma.userRole.create({
    data: { userId: multiRoleUser.id, role: "CONSIGNOR", storeId: store.id, accountId: consignorAccount.id },
  });

  const employee = await prisma.user.create({
    data: { email: "employee@teabox.local", name: "Mateo Alvarez", passwordHash },
  });
  await prisma.userRole.create({ data: { userId: employee.id, role: "EMPLOYEE", storeId: store.id } });

  const consignorUser = await prisma.user.create({
    data: { email: "jane.consignor@example.com", name: "Jane Doe", passwordHash },
  });
  await prisma.userRole.create({
    data: { userId: consignorUser.id, role: "CONSIGNOR", storeId: store.id, accountId: consignorAccount.id },
  });

  const boothUser = await prisma.user.create({
    data: { email: "booth402@example.com", name: "Vintage Vinyls", passwordHash },
  });
  await prisma.userRole.create({
    data: { userId: boothUser.id, role: "BOOTH_OWNER", storeId: store.id, accountId: boothAccount.id },
  });

  // Items across categories/statuses so every screen has real content.
  const itemDefs = [
    { sku: "CLO-9821", description: "Vintage Denim Jacket", category: "Clothing", brand: "Levi Strauss & Co.", size: "M", price: 45.0, status: "AVAILABLE", accountId: consignorAccount.id, days: 12 },
    { sku: "CLO-1190", description: "Silk Scarf", category: "Clothing", brand: "Hermès", price: 0.0, status: "DONATED", accountId: donorAccount.id, days: 40 },
    { sku: "MED-4410", description: "Vinyl: Dark Side of the Moon", category: "Media", brand: "Pink Floyd", price: 32.0, status: "PENDING", accountId: boothAccount.id, days: 2 },
    { sku: "ELE-0012", description: "Nintendo Gameboy", category: "Electronics", brand: "Nintendo", price: 85.0, status: "SOLD", accountId: vendorAccount.id, days: 20 },
    { sku: "HOU-5521", description: "Cast Iron Skillet", category: "Housewares", brand: "Lodge", price: 22.5, status: "AVAILABLE", accountId: storeAccount.id, days: 5 },
    { sku: "CLO-2201", description: "Vintage Leather Jacket", category: "Clothing", brand: "Schott NYC", style: "Perfecto 618", price: 245.0, status: "AVAILABLE", accountId: consignorAccount.id, days: 95 },
    { sku: "LP-99201", description: "The Beatles - Abbey Road", category: "Media", brand: "Apple Records", price: 108.0, status: "AVAILABLE", accountId: boothAccount.id, days: 8 },
    { sku: "LP-99205", description: "Pink Floyd - Dark Side", category: "Media", brand: "Harvest", price: 45.0, status: "AVAILABLE", accountId: boothAccount.id, days: 15 },
    { sku: "LP-99210", description: "Led Zeppelin IV", category: "Media", brand: "Atlantic", price: 55.0, status: "AVAILABLE", accountId: boothAccount.id, days: 100 },
    { sku: "HOU-3310", description: "Pyrex Mixing Bowl - Turquoise", category: "Housewares", brand: "Pyrex", price: 28.5, status: "AVAILABLE", accountId: donorAccount.id, days: 60 },
    { sku: "CLO-4471", description: "Hand-painted Ceramic Vase", category: "Housewares", price: 185.0, status: "SOLD", accountId: consignorAccount.id, days: 3 },
    { sku: "CLO-4472", description: "Rosewood Jewelry Box", category: "Housewares", price: 95.0, status: "PENDING", accountId: consignorAccount.id, days: 1 },
    { sku: "CLO-4473", description: "Embroidered Silk Screen", category: "Clothing", price: 540.0, status: "SOLD", accountId: consignorAccount.id, days: 10 },
    { sku: "ELE-0099", description: "Polaroid Camera - Vintage", category: "Electronics", brand: "Polaroid", price: 65.0, status: "AVAILABLE", accountId: vendorAccount.id, days: 25 },
    { sku: "CLO-5001", description: "Wool Peacoat - Navy", category: "Clothing", size: "L", price: 78.0, status: "AVAILABLE", accountId: consignorAccount.id, days: 33 },
  ];

  for (const def of itemDefs) {
    const intakeDate = new Date();
    intakeDate.setDate(intakeDate.getDate() - def.days);
    const item = await prisma.item.create({
      data: {
        sku: def.sku,
        description: def.description,
        category: def.category,
        brand: def.brand,
        style: (def as { style?: string }).style,
        size: (def as { size?: string }).size,
        price: def.price,
        status: def.status,
        intakeDate,
        accountId: def.accountId,
        storeId: store.id,
        history: {
          create: [{ changeType: "INTAKE", newValue: `Intake at $${def.price.toFixed(2)}`, timestamp: intakeDate }],
        },
      },
    });

    if (def.status === "SOLD") {
      const saleDate = new Date(intakeDate);
      saleDate.setDate(saleDate.getDate() + Math.min(def.days, 3));
      await prisma.sale.create({
        data: {
          itemId: item.id,
          salePrice: def.price,
          saleDate,
          paymentType: "CARD",
          registerName: "Main Terminal",
          processedById: employee.id,
          storeId: store.id,
        },
      });
    }
  }

  await prisma.payout.create({ data: { accountId: consignorAccount.id, amount: 95.0, status: "PAID", paidAt: new Date() } });
  await prisma.payout.create({ data: { accountId: boothAccount.id, amount: 420.0, status: "REQUESTED" } });

  await prisma.heartbeat.create({ data: { storeId: store.id, lastSyncedAt: new Date() } });

  await prisma.device.createMany({
    data: [
      { storeId: store.id, name: "Zebra ZD410 (USB)", type: "PRINTER", status: "CONNECTED" },
      { storeId: store.id, name: "Verifone P400 (Ethernet)", type: "PAYMENT_TERMINAL", status: "DISCONNECTED" },
    ],
  });

  console.log("Seed complete.\n");
  console.log("Demo logins (all use password: %s)", DEMO_PASSWORD);
  console.log("  owner@teabox.local        -> Owner");
  console.log("  sarah@teabox.local        -> Manager AND Consignor (role picker + Switch Role demo)");
  console.log("  employee@teabox.local     -> Employee");
  console.log("  jane.consignor@example.com -> Consignor (own account)");
  console.log("  booth402@example.com      -> Booth Owner (own account)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
