import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { defineApiKeyProviderExecutors } from "../provider-runtime.ts";
import { finnhubActionHandlers, validateFinnhubCredential } from "./runtime.ts";

const service = "finnhub";

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, finnhubActionHandlers);

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }) {
    return validateFinnhubCredential(input.apiKey, fetcher, signal);
  },
};
