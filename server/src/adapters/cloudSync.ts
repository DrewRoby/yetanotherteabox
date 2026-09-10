import { prisma } from "../lib/prisma";

// STUB: real deployments run this as an Azure Functions / DigitalOcean App Platform
// job that pushes local changes to cloud Postgres and pulls marketplace requests
// every <=10 minutes (tech_stack_document.md, backend_structure_document.md). There
// is no cloud endpoint to reach here, so "syncing" just stamps the store's Heartbeat
// row — the same signal Settings' System Sync tab and any monitoring would key off.
export async function runHeartbeatSync(storeId: string): Promise<{ lastSyncedAt: Date }> {
  console.log(`[cloud-sync stub] would push local changes for store ${storeId} to cloud now`);
  const heartbeat = await prisma.heartbeat.upsert({
    where: { storeId },
    update: { lastSyncedAt: new Date() },
    create: { storeId, lastSyncedAt: new Date() },
  });
  return { lastSyncedAt: heartbeat.lastSyncedAt };
}
