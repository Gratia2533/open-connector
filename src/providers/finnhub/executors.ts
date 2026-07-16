import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { defineApiKeyProviderExecutors } from "../provider-runtime.ts";
import { finnhubActionHandlers, validateFinnhubCredential } from "./runtime.ts";

export const executors: ProviderExecutors = defineApiKeyProviderExecutors("finnhub", finnhubActionHandlers);

export const credentialValidators: CredentialValidators = {
  apiKey: validateFinnhubCredential,
};
