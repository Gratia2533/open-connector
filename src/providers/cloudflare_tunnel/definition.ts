import type { ProviderDefinition } from "../../core/types.ts";

import { cloudflareTunnelActions } from "./actions.ts";

export const provider: ProviderDefinition = {
  service: "cloudflare_tunnel",
  displayName: "Cloudflare Tunnel",
  categories: ["Developer Tools", "Security"],
  authTypes: ["custom_credential"],
  auth: [
    {
      type: "custom_credential",
      fields: [
        {
          key: "apiKey",
          label: "API Token",
          inputType: "password",
          required: true,
          secret: true,
          placeholder: "cloudflare_api_token",
          description:
            "Scoped Cloudflare API Token used only by fixed Tunnel and DNS workflow actions. Create one at https://dash.cloudflare.com/profile/api-tokens",
        },
        {
          key: "accountId",
          label: "Account ID",
          inputType: "text",
          required: true,
          secret: false,
          placeholder: "023e105f4ecef8ad9ca31a8372d0c353",
          description:
            "Cloudflare account ID used for every Tunnel request. See https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/",
        },
      ],
    },
  ],
  homepageUrl: "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/",
  actions: cloudflareTunnelActions,
};
