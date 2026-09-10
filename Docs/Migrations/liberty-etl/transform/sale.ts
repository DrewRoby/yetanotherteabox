import type { SaleDetailRow } from "../extract/liberty";
import { mapPaymentType } from "./crosswalks";

export interface TransformedSale {
  libertyItemId: number;
  salePrice: number;
  saleDate: Date;
  paymentType: string;
}

export function transformSaleDetail(
  detail: SaleDetailRow,
  paymentTypeIdBySaleId: Map<number, number>
): TransformedSale {
  const paymentTypeId = paymentTypeIdBySaleId.get(detail.SALE_ID);
  return {
    libertyItemId: detail.ITEM_ID,
    salePrice: detail.PRICE_SOLD,
    saleDate: detail.SALE_TS,
    paymentType: paymentTypeId != null ? mapPaymentType(paymentTypeId) : "CASH",
  };
}
