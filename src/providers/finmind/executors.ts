import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { defineApiKeyProviderExecutors } from "../provider-runtime.ts";
import { finmindActionHandlers, validateFinmindCredential } from "./runtime.ts";

const service = "finmind";

export const executors: ProviderExecutors = defineApiKeyProviderExecutors(service, finmindActionHandlers);

export const credentialValidators: CredentialValidators = {
  apiKey(input, { fetcher, signal }) {
    return validateFinmindCredential(input.apiKey, fetcher, signal);
  },
};
