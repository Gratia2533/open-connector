import type {
  CredentialValidationResult,
  CredentialValidators,
  ExecutionContext,
  ProviderExecutors,
} from "../../core/types.ts";
import type { CloudflareTunnelContext } from "./runtime.ts";

import { requiredString } from "../../core/cast.ts";
import { defineProviderExecutors, ProviderRequestError } from "../provider-runtime.ts";
import { cloudflareTunnelActionHandlers, validateCloudflareTunnelCredential } from "./runtime.ts";

const service = "cloudflare_tunnel";

export const executors: ProviderExecutors = defineProviderExecutors<CloudflareTunnelContext>({
  service,
  handlers: cloudflareTunnelActionHandlers,
  async createContext(context: ExecutionContext, fetcher: typeof fetch): Promise<CloudflareTunnelContext> {
    const credential = await context.getCredential(service);
    if (credential?.authType !== "custom_credential") {
      throw new ProviderRequestError(401, "Configure cloudflare_tunnel credentials first.");
    }
    return {
      accessToken: requiredCredentialString(credential.values.apiKey, "apiKey"),
      accountId: requiredCredentialString(credential.values.accountId, "accountId"),
      fetcher,
      signal: context.signal,
    };
  },
});

export const credentialValidators: CredentialValidators = {
  async customCredential(input, { fetcher, signal }): Promise<CredentialValidationResult> {
    return validateCloudflareTunnelCredential(input.values, fetcher, signal);
  },
};

function requiredCredentialString(value: unknown, fieldName: string): string {
  return requiredString(value, fieldName, (message) => new ProviderRequestError(400, message));
}
