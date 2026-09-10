import type { PayoutRow } from "../extract/liberty";
import { mapPayoutStatus } from "./crosswalks";

export interface TransformedPayout {
  libertyClientId: number;
  amount: number;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
}

export function transformPayout(payout: PayoutRow): TransformedPayout {
  const status = mapPayoutStatus(payout.RECONCILE_STATUS);
  const createdAt = payout.PAYOUT_TS ?? new Date();
  return {
    libertyClientId: payout.CLIENT_ID,
    amount: Math.abs(payout.PAYOUT_AMT ?? 0),
    status,
    createdAt,
    paidAt: status === "PAID" ? createdAt : null,
  };
}
