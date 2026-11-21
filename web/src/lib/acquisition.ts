// How the store came to own a store-owned item — Item.consignmentType (server:
// lib/enums.ts CONSIGNMENT_TYPES). null = consigned, or nobody recorded it.

export const ACQUISITION_LABELS: Record<string, string> = {
  "Walk-in Donation": "Walk-in donation (no account)",
  "Buy-Outright": "Purchased (person, vendor or lot)",
  Trade: "Trade",
  "Expired Consignment": "Expired consignment, kept by the store",
};

// Chosen at intake (server: INTAKE_CONSIGNMENT_TYPES); "Expired Consignment" is set by a
// flip to store inventory, never picked by hand at intake.
export const INTAKE_ACQUISITIONS = ["Walk-in Donation", "Buy-Outright", "Trade"];

// Acquisitions that cost the store something.
export const COSTED_ACQUISITIONS = ["Buy-Outright", "Trade"];

export function acquisitionLabel(value: string | null | undefined): string {
  return value ? ACQUISITION_LABELS[value] ?? value : "—";
}
