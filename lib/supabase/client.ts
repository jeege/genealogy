import { createBrowserClient } from "@supabase/ssr";
import { getBrowserPublicRuntimeConfig } from "@/components/runtime-config-provider";
import { getSupabaseCookieName } from "@/lib/runtime-config";

export function createClient() {
  const config = getBrowserPublicRuntimeConfig();
  return createBrowserClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookieOptions: { name: getSupabaseCookieName(config.supabaseUrl) },
  });
}
