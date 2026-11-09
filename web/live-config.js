/* MOA live operator config. Only public Supabase values belong here.
 * Never put service_role, sb_secret_*, or MOA_INGEST_TOKEN in frontend code.
 * Populate publishableKey with Supabase Settings > API Keys > Publishable key.
 */
window.MOA_LIVE_CONFIG = Object.freeze({
  projectUrl: "https://kdhopbqqmfbmnqipkwcc.supabase.co",
  publishableKey: "sb_publishable_VtMzh5DKy_4TEzRlYECyKw_1UelS-af", // Put ONLY an sb_publishable_... key (or legacy anon key) here.
  functionName: "moa-operator-api"
});
