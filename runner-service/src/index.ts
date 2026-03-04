import dotenv from "dotenv";
dotenv.config();

import redis from "./utils/redis";
import { Project } from "./types/types";
import { getAvailablePort } from "./utils/portManager";
import { writeNginxRoute, reloadNginx } from "./utils/nginx";
import { createClient } from "@supabase/supabase-js";
import simpleGit from "simple-git";
import path from "path";
import fs from "fs-extra";
import { runCommandWithLogs } from "./utils/command";
import { updateLogs } from "./utils/logger";
import { exec } from "child_process";
import { sendDeploymentMail } from "./utils/mail";

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.BASE_IP_URL ||
  !process.env.BASE_URL
) {
  throw new Error(
    "Missing Supabase environment variables OR BASE_IP_URL in runner service !!"
  );
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function updateViteConfig(dir: string, projectId: string) {
  const jsConfig = path.join(dir, "vite.config.js");
  const tsConfig = path.join(dir, "vite.config.ts");

  let configPath = "";

  if (await fs.pathExists(tsConfig)) {
    configPath = tsConfig;
  } else if (await fs.pathExists(jsConfig)) {
    configPath = jsConfig;
  }

  if (!configPath) {
    throw new Error("vite.config.js or vite.config.ts not found in project");
  }

  let configContent = await fs.readFile(configPath, "utf-8");

  configContent = configContent.replace(/base:\s*["'`](.*?)["'`],?/g, "");

  const baseLine = `  base: "/${projectId}/",`;

  if (configContent.includes("defineConfig({")) {
    configContent = configContent.replace(
      /defineConfig\(\{\s*/,
      (match) => `${match}${baseLine}\n`
    );
  } else {
    configContent = configContent.replace(
      /\{\s*/,
      (match) => `${match}${baseLine}\n`
    );
  }

  await fs.writeFile(configPath, configContent);
}

export const stopAndRemoveContainer = async (
  imageName: string,
  jobId: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const listContainers = `docker ps -a --filter ancestor=${imageName} --format "{{.ID}}"`;

    exec(listContainers, async (err, stdout, stderr) => {
      if (err) {
        console.error("Error listing containers:", stderr);
        return reject(err);
      }

      const containerIds = stdout.split("\n").filter(Boolean);

      if (containerIds.length === 0) {
        console.log(`No running containers found for image: ${imageName}`);
      } else {
        await updateLogs(
          jobId,
          `$ Cleaning Old Docker Containers and Image...`
        );
      }

      const stopRemoveCommands = containerIds
        .map((id) => `docker rm -f ${id}`)
        .join(" && ");

      const finalCommand = stopRemoveCommands
        ? `${stopRemoveCommands} && docker rmi -f ${imageName}`
        : `docker rmi -f ${imageName}`;

      exec(finalCommand, (err2, stdout2, stderr2) => {
        if (err2) {
          console.error(
            `Failed to remove container/image for ${imageName}:`,
            stderr2
          );
          return reject(err2);
        }
        resolve();
      });

      await updateLogs(jobId, `$ Cleaned up old Containes...`);
    });
  });
};

async function processJob(job: Project) {
  console.log("🔧 Processing:", job.project_name);

  const tmpRoot =
    process.platform === "win32" ? "C:\\tmp" : "/home/ubuntu/vercel/builds";
  const dir = path.join(tmpRoot, `${job.project_name}-${Date.now()}`);

  if (await fs.pathExists(dir)) await fs.remove(dir);
  await fs.ensureDir(dir);

  await supabase
    .from("projects")
    .update({ status: "building", logs: "" })
    .eq("id", job.id);

  try {
    await updateLogs(job.id, `$ Cloning repo ${job.repo_url}...`);
    await simpleGit().clone(job.repo_url, dir);
    await updateLogs(job.id, "$ Repo cloned successfully..");

    if (job.env_variables && typeof job.env_variables === "object") {
      const envContent = Object.entries(job.env_variables)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      await fs.writeFile(path.join(dir, ".env"), envContent);
      await updateLogs(job.id, "$ .env file created, variable injected...");
    }

    if (job.framework === "React") {
      await updateLogs(job.id, "$ Installing dependencies...");
      await runCommandWithLogs("npm", ["install"], dir, job.id);
      await updateLogs(job.id, "$ Updating vite.config.js...");
      await updateViteConfig(dir, job.id);
      await updateLogs(job.id, "$ Building project...");
      await runCommandWithLogs("npm", ["run", "build"], dir, job.id);
      await updateLogs(job.id, "$ Project built successfully...");

      const possibleDirs = ["dist", "build", "out"];

      let buildPath = "";
      for (const dirName of possibleDirs) {
        const fullPath = path.join(dir, dirName);
        if (await fs.pathExists(fullPath)) {
          buildPath = fullPath;
          break;
        }
      }

      if (!buildPath) {
        throw new Error("No valid frontend build folder found.");
      }

      await updateLogs(job.id, `$ Found build folder: ${buildPath}`);

      console.log(`Calling ${process.env.BASE_IP_URL!}/upload`);
      const response = await fetch(`${process.env.BASE_IP_URL!}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: job.id, localPath: buildPath }),
      });

      const { url: deployedUrl } = await response.json();
      await updateLogs(job.id, `$ Uploaded build to S3 successfully...`);

      // writeNginxRoute(job.id, false);
      // reloadNginx();

      await fs.remove(dir);
      await updateLogs(job.id, `$ Cleaned up local build...`);

      await supabase
        .from("projects")
        .update({ status: "deployed", deployed_url: deployedUrl })
        .eq("id", job.id);

      await updateLogs(job.id, `$🎉🎉 React app deployed at: ${deployedUrl}`);

      await sendDeploymentMail({
        userId: job.user_id,
        projectName: job.repo_url.split("/").pop()?.replace(".git", "") || "",
        deployedUrl,
        framework: job.framework,
        deploymentTime: new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        }),
      });
    } else {
      const port = job.port == null ? await getAvailablePort() : job.port;

      const dockerfilePath = path.join(dir, "Dockerfile");
      const isTSProject = fs.existsSync(path.join(dir, "tsconfig.json"));

      const possibleEntryNames = [
        "server.ts",
        "index.ts",
        "main.ts",
        "app.ts",
        "server.js",
        "index.js",
        "main.js",
        "app.js",
      ];

      let entryFile = "";
      for (const file of possibleEntryNames) {
        const filePath = isTSProject
          ? path.join(dir, "src", file)
          : path.join(dir, file);
        if (fs.existsSync(filePath)) {
          entryFile = isTSProject ? `src/${file}` : file;
          break;
        }
      }

      if (!entryFile) entryFile = isTSProject ? "src/index.ts" : "index.js";

      if (!fs.existsSync(dockerfilePath)) {
        const defaultDockerfile = `
          FROM node:18-alpine
          WORKDIR /app
          COPY . .
          RUN npm install
          ${isTSProject ? "RUN npm run build" : ""}
          COPY .env .env
          ENV PORT=3000
          EXPOSE 3000
          CMD ["node", "${isTSProject ? "dist" : "."}/${entryFile.replace(
            ".ts",
            ".js"
          )}"]
        `;
        fs.writeFileSync(dockerfilePath, defaultDockerfile.trim());
        await updateLogs(
          job.id,
          "@ No Dockerfile found, creating Dockerfile..."
        );
      }

      await updateLogs(job.id, "$ Installing dependencies...");
      await runCommandWithLogs("npm", ["install"], dir, job.id);

      const imageName = `${job.project_name}-${job.id}`.toLowerCase();

      await stopAndRemoveContainer(imageName, job.id);

      await updateLogs(job.id, `$ Building Docker image...`);
      await runCommandWithLogs(
        "docker",
        ["build", "-t", imageName, "."],
        dir,
        job.id
      );

      await updateLogs(job.id, `$ Running Docker container...`);
      await runCommandWithLogs(
        "docker",
        ["run", "-d", "-p", `${port}:3000`, "--name", imageName, imageName],
        dir,
        job.id
      );

      const deployedUrl = `${process.env.BASE_URL!}/${job.id}`;
      // writeNginxRoute(job.id, true, port);
      // reloadNginx();

      await fs.remove(dir);
      await updateLogs(job.id, `$ Cleaned up local build storage...`);

      await supabase
        .from("projects")
        .update({ status: "deployed", deployed_url: deployedUrl, port })
        .eq("id", job.id);

      await updateLogs(job.id, `$🎉🎉 Node app deployed at: ${deployedUrl}`);

      await sendDeploymentMail({
        userId: job.user_id,
        projectName: job.repo_url.split("/").pop()?.replace(".git", "") || "",
        deployedUrl,
        framework: job.framework,
        deploymentTime: new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        }),
      });
    }
  } catch (err: any) {
    console.error("# Build failed:", err);
    await updateLogs(job.id, `# Build failed: ${err.message || err}`);
    await fs.remove(dir);
    await updateLogs(job.id, `$ Cleaned up local build...`);
    await supabase
      .from("projects")
      .update({ status: "error" })
      .eq("id", job.id);
  }
}

async function startPolling() {
  console.log("@ Runner service polling Redis...");
  setInterval(async () => {
    const jobString = await redis.rpop("build-queue");
    if (!jobString || jobString === "null") {
      console.log("@ No job found in Redis...");
      return;
    }

    try {
      const job: Project = JSON.parse(jobString);
      if (!job?.project_name || !job?.repo_url) {
        console.log("# Invalid job payload:", job);
        return;
      }
      await processJob(job);
    } catch (err) {
      console.error("# Failed to parse job JSON:", jobString);
    }
  }, 5000);
}

startPolling();