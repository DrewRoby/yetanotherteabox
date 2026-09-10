import { Router } from "express";
import { z } from "zod";
import { completeSetup, needsSetup, SetupAlreadyCompleteError } from "../services/setup.service";

// Deliberately unauthenticated (mounted before the `authenticate` middleware in
// index.ts) — a brand-new deployment has no session to present yet. Both handlers
// re-check needsSetup() themselves regardless of what the client believes, so a
// stale "needsSetup: true" on the client can never re-run setup against a live store.
export const setupRouter = Router();

setupRouter.get("/status", async (_req, res) => {
  res.json({ needsSetup: await needsSetup() });
});

const completeSetupSchema = z.object({
  storeName: z.string().min(1),
  storeLocation: z.string().optional(),
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  password: z.string().min(8),
});

setupRouter.post("/complete", async (req, res) => {
  const parsed = completeSetupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await completeSetup(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof SetupAlreadyCompleteError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
});
