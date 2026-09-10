// STUB: real deployments send intake photos to Azure Cognitive Services Computer
// Vision (or a DigitalOcean GPU droplet running YOLO) for brand/style/serial
// suggestions (tech_stack_document.md). No such API is reachable here, so this
// returns a small set of canned suggestions after a short artificial delay, matching
// the shape a real CV response would take.
export interface CvSuggestion {
  brand?: string;
  category?: string;
  confidence: number;
}

const CANNED_SUGGESTIONS: CvSuggestion[] = [
  { brand: "Levi Strauss & Co.", category: "Clothing > Pants > Jeans", confidence: 0.82 },
  { brand: "Pyrex", category: "Housewares > Kitchen", confidence: 0.74 },
  { brand: "Schott NYC", category: "Clothing > Outerwear", confidence: 0.79 },
  { category: "Media > Vinyl Records", confidence: 0.61 },
];

export async function suggestMetadata(_photoUrl: string): Promise<CvSuggestion> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return CANNED_SUGGESTIONS[Math.floor(Math.random() * CANNED_SUGGESTIONS.length)];
}
