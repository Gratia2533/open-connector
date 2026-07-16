import type { ProviderDefinition } from "../../core/types.ts";

import { finnhubActions } from "./actions.ts";

export const provider: ProviderDefinition = {
  service: "finnhub",
  displayName: "Finnhub",
  categories: ["Finance", "Data"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "API Key",
      placeholder: "Your Finnhub API key",
      description: "API key sent only to fixed, curated Finnhub read-only actions.",
    },
  ],
  homepageUrl: "https://finnhub.io",
  actions: finnhubActions,
};
