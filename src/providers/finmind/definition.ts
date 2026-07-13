import type { ProviderDefinition } from "../../core/types.ts";

import { finmindActions } from "./actions.ts";

export const provider: ProviderDefinition = {
  service: "finmind",
  displayName: "FinMind",
  categories: ["Finance", "Data"],
  authTypes: ["api_key"],
  auth: [
    {
      type: "api_key",
      label: "API Token",
      placeholder: "Your FinMind API token",
      description: "FinMind token sent only to fixed, curated read-only datasets.",
      extraFields: [],
    },
  ],
  homepageUrl: "https://finmindtrade.com",
  actions: finmindActions,
};
