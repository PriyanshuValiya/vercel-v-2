import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { exec } from "child_process";

if (!process.env.S3_BUCKET || !process.env.AWS_REGION) {
  throw new Error(
    "Missing required environment variables: S3_BUCKET or AWS_REGION in runner service !!",
  );
}

const nginxRoutePath =
  process.platform === "win32"
    ? path.resolve(__dirname, "../../nginx/routes")
    : "/etc/nginx/conf.d/routes";

export function writeNginxRoute(
  projectId: string,
  isNode: boolean,
  port?: number,
) {
  if (!fs.existsSync(nginxRoutePath)) {
    fs.mkdirSync(nginxRoutePath, { recursive: true });
  }

  const filePath = path.join(nginxRoutePath, `${projectId}.conf`);

  const config = isNode
    ? `location /${projectId}/ {
  proxy_pass http://localhost:${port}/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection 'upgrade';
  proxy_set_header Host $host;
  proxy_cache_bypass $http_upgrade;
  rewrite ^/${projectId}/(.*)$ /$1 break;
}`.trim()
    : `location /${projectId}/ {
  proxy_pass https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${projectId}/;
  rewrite ^/${projectId}/(.*)$ /$1 break;
}`.trim();

  try {
    fs.writeFileSync(filePath, config);
    console.log(`[NGINX] Route written to ${filePath}`);
  } catch (err) {
    console.error(`[NGINX] Failed to write route: ${err}`);
  }
}

export function reloadNginx() {
  exec("nginx -s reload", (err) => {
    if (err) {
      console.error("[NGINX] Reload failed:", err);
    } else {
      console.log("[NGINX] Reloaded successfully");
    }
  });
}
