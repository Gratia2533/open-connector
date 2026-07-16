import type { CredentialValidators, ProviderExecutors } from "../../core/types.ts";

import { defineApiKeyProviderExecutors } from "../provider-runtime.ts";
import { finmindActionHandlers, validateFinMindCredential } from "./runtime.ts";

export const executors: ProviderExecutors = defineApiKeyProviderExecutors("finmind", finmindActionHandlers);

export const credentialValidators: CredentialValidators = {
  apiKey: validateFinMindCredential,
};
