import { createClient } from "@supabase/supabase-js";
import DeploymentClient from "./deployment-client";

const supabase = createClient(
  "https://xsuoursuscbxauwiragm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzdW91cnN1c2NieGF1d2lyYWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3NDYwNDMsImV4cCI6MjA2NTMyMjA0M30.WpwhNxmcPKBZRNt0IE0tDMAcBbBqVuVqt24-gVbSUv4"
);

export default async function DeploymentPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    return null;
  }

  return <DeploymentClient initialProject={project} />;
}
