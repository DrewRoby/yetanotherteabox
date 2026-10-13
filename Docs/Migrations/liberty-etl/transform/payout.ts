import type { PayoutLineRow, PayoutRow } from "../extract/liberty";
import { mapPayoutLineType, mapPayoutMethod, mapPayoutStatus } from "./crosswalks";

export interface TransformedPayout {
  libertyClientId: number;
  amount: number;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  method: string | null;
  checkNumber: string | null;
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
    method: mapPayoutMethod(payout.PAYMENT_ACT_ID),
    checkNumber: mapPayoutMethod(payout.PAYMENT_ACT_ID) === "CHECK" ? payout.CHECK_NUM?.trim() || null : null,
  };
}

export interface TransformedPayoutLine {
  libertyPayoutId: number;
  libertyItemId: number | null;
  lineType: string;
  description: string | null;
  transTs: Date | null;
  amount: number;
}

// Amount keeps Liberty's sign (deductions/returns negative). Description keeps the
// source transaction label, plus Liberty's free-text note when it has one.
export function transformPayoutLine(line: PayoutLineRow): TransformedPayoutLine {
  const note = line.ACT_TRANS_DESC?.trim();
  return {
    libertyPayoutId: line.PAYOUT_ID,
    libertyItemId: line.ITEM_ID ? line.ITEM_ID : null,
    lineType: mapPayoutLineType(line.TRANS_CD_ID),
    description: note ? `${line.TRANS_CD_DESC}: ${note}` : line.TRANS_CD_DESC,
    transTs: line.ACT_TRANS_TS,
    amount: line.ACT_TRANS_AMT ?? 0,
  };
}
