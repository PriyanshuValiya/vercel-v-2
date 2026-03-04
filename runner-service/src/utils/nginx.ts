import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import { exec } from "child_process";

// ---------------------------------------------------------------------------
// FEATURE: Subdomain-based routing
//
// OLD behaviour: Each project was served at a path on the main domain:
//   React: https://BUCKET.s3.REGION.amazonaws.com/projectId/
//   Node:  https://vercel.priyanshuvaliya.dev/projectId  (port exposed publicly)
//
// NEW behaviour: Each project gets its own subdomain:
//   React: https://projectname.vercel.priyanshuvaliya.dev
//   Node:  https://projectname.vercel.priyanshuvaliya.dev
//
// Nginx now generates per-project server {} blocks keyed by server_name
// instead of location /projectId/ blocks.
//
// Required new env vars in runner-service/.env:
//   DEPLOY_DOMAIN=vercel.priyanshuvaliya.dev
//   SSL_CERT_PATH=/etc/ssl/cloudflare/origin.pem
//   SSL_CERT_KEY_PATH=/etc/ssl/cloudflare/origin.key
// ---------------------------------------------------------------------------

if (
  !process.env.S3_BUCKET ||
  !process.env.AWS_REGION ||
  !process.env.DEPLOY_DOMAIN ||
  !process.env.SSL_CERT_PATH ||
  !process.env.SSL_CERT_KEY_PATH
) {
  throw new Error(
    "Missing required env vars: S3_BUCKET, AWS_REGION, DEPLOY_DOMAIN, SSL_CERT_PATH, SSL_CERT_KEY_PATH",
  );
}

const nginxRoutePath =
  process.platform === "win32"
    ? path.resolve(__dirname, "../../nginx/routes")
    : "/etc/nginx/conf.d/routes";

// ---------------------------------------------------------------------------
// slugifyProjectName
//
// Converts a project/repo name into a valid DNS label for use as a subdomain.
// GitHub repo names are already mostly safe, but this handles edge cases like
// uppercase letters, underscores, and leading/trailing hyphens.
//
// "My_App"  → "my-app"
// "APP__v2" → "app-v2"
// "-broken" → "broken"
// ---------------------------------------------------------------------------
export function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // replace non-alphanumeric/hyphen with hyphen
    .replace(/-+/g, "-") // collapse consecutive hyphens
    .replace(/^-|-$/g, ""); // strip leading/trailing hyphens
}

// ---------------------------------------------------------------------------
// writeNginxRoute
//
// CHANGED: Now writes a server {} block using server_name (subdomain routing)
// instead of a location /projectId/ {} block (path routing).
//
// Node apps:  traffic to projectname.vercel.priyanshuvaliya.dev →
//             proxy_pass to localhost:PORT (Docker internal port, not public)
//
// React apps: traffic to projectname.vercel.priyanshuvaliya.dev →
//             proxy_pass to S3 bucket prefix for this projectId
//
// SSL is terminated by Cloudflare's edge. Nginx receives the connection from
// Cloudflare on port 443 and validates using the Cloudflare origin certificate.
// Port 80 simply redirects to HTTPS.
//
// Parameters:
//   projectName  — human-readable name used as the subdomain label
//   projectId    — S3 prefix key (UUID), used only for React S3 path
//   isNode       — true for Node/Docker apps, false for React/S3 apps
//   port         — Docker-mapped host port (Node only, stays internal to EC2)
// ---------------------------------------------------------------------------
export function writeNginxRoute(
  projectName: string,
  projectId: string,
  isNode: boolean,
  port?: number,
): void {
  if (!fs.existsSync(nginxRoutePath)) {
    fs.mkdirSync(nginxRoutePath, { recursive: true });
  }

  const slug = slugifyProjectName(projectName);
  const subdomain = `${slug}.${process.env.DEPLOY_DOMAIN}`;
  const filePath = path.join(nginxRoutePath, `${projectId}.conf`);

  const sslBlock = `
    ssl_certificate ${process.env.SSL_CERT_PATH};
    ssl_certificate_key ${process.env.SSL_CERT_KEY_PATH};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;`.trim();

  // Redirect HTTP → HTTPS (Cloudflare already handles this at the edge,
  // but this keeps the origin correct for Full strict mode)
  const httpRedirectBlock = `
server {
    listen 80;
    server_name ${subdomain};
    return 301 https://$host$request_uri;
}`.trim();

  let httpsBlock: string;

  if (isNode) {
    // -----------------------------------------------------------------------
    // Node app — proxy to Docker container on internal host port.
    // The port is bound on 127.0.0.1 so it is NOT accessible from outside
    // the EC2 instance. No EC2 security group rule needed for this port.
    // -----------------------------------------------------------------------
    httpsBlock = `
server {
    listen 443 ssl;
    server_name ${subdomain};

    ${sslBlock}

    location / {
        proxy_pass http://127.0.0.1:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}`.trim();
  } else {
    // -----------------------------------------------------------------------
    // React app — proxy to S3 bucket prefix.
    //
    // Since Vite now builds with base "/" (see index.ts updateViteConfig),
    // all asset paths are relative to the root of the subdomain.
    // Nginx rewrites requests from / to the S3 prefix /<projectId>/.
    //
    // proxy_ssl_server_name on  — required for SNI when connecting to S3 HTTPS
    // proxy_set_header Host    — required for S3 path-style virtual hosting
    // -----------------------------------------------------------------------
    httpsBlock = `
server {
    listen 443 ssl;
    server_name ${subdomain};

    ${sslBlock}

    location / {
        proxy_pass https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${projectId}/;
        proxy_ssl_server_name on;
        proxy_set_header Host ${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_intercept_errors on;
        error_page 404 = /index.html;
    }
}`.trim();
  }

  const config = `${httpRedirectBlock}\n\n${httpsBlock}\n`;

  try {
    fs.writeFileSync(filePath, config);
    console.log(`[NGINX] Subdomain route written: https://${subdomain}`);
  } catch (err) {
    console.error(`[NGINX] Failed to write route: ${err}`);
  }
}

export function reloadNginx(): void {
  exec("nginx -s reload", (err) => {
    if (err) {
      console.error("[NGINX] Reload failed:", err);
    } else {
      console.log("[NGINX] Reloaded successfully");
    }
  });
}
