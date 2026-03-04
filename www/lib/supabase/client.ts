import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xsuoursuscbxauwiragm.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzdW91cnN1c2NieGF1d2lyYWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3NDYwNDMsImV4cCI6MjA2NTMyMjA0M30.WpwhNxmcPKBZRNt0IE0tDMAcBbBqVuVqt24-gVbSUv4";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables in www !!");
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
