import { createClient } from "@nhost/nhost-js";

export const nhost = createClient({
  authUrl:
    "https://pszgoljqdxwingbbitai.auth.ap-south-1.nhost.run/v1",
  graphqlUrl:
    "https://pszgoljqdxwingbbitai.graphql.ap-south-1.nhost.run/v1",
  storageUrl:
    "https://pszgoljqdxwingbbitai.storage.ap-south-1.nhost.run/v1",
  functionsUrl:
    "https://pszgoljqdxwingbbitai.functions.ap-south-1.nhost.run/v1",
});