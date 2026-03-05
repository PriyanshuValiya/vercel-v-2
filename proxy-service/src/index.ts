import dotenv from "dotenv";
dotenv.config();

import express from "express";
import supabase from "./utils/supabase";

const app = express();
const S3_BASE = process.env.BUCKET_NAME!;
const PORT = process.env.PORT || 5000;

app.use(async (req: express.Request, res: express.Response) => {
  const hostname = req.headers.host?.split(":")[0] || "";
  const projectSlug = hostname.split(".")[0];

  if (!projectSlug) {
    res.status(400).send("Bad Request: missing subdomain");
    return;
  }

  try {
    const { data: project, error } = await supabase
      .from("projects")
      .select("id, status")
      .ilike("deployed_url", `%${projectSlug}%`)
      .eq("status", "deployed")
      .single();

    if (error || !project) {
      console.error(`[Proxy] Not found: ${projectSlug}`);
      res.status(404).send(`
        <h2>404 — Project not found</h2>
        <p>No deployed project found for <strong>${projectSlug}</strong></p>
      `);
      return;
    }

    const reqPath = req.path === "/" ? "/index.html" : req.path;
    const redirectUrl = `${S3_BASE}/${project.id}${reqPath}`;

    console.log(`[Proxy] ${hostname} → ${redirectUrl}`);
    res.redirect(302, redirectUrl);

  } catch (err) {
    console.error("[Proxy] Error:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/", (req, res) => {
    res.send('Proxy Service is working..');
});

app.listen(PORT, () => {
  console.log(`Proxy service running on port ${PORT}`);
});