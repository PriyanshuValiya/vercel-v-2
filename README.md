# Vercel Clone : Self-Hosted Cloud Deployment PaaS Platform

A production-grade, self-hosted deployment platform that replicates core Vercel functionality accepting GitHub repositories, building them automatically, and serving them via SSL-secured custom subdomains. Supports both static React frontends (served via S3) and Node.js backends (containerized and proxied dynamically).

## Project Overview

### What It Does

This platform allows developers to deploy their GitHub repositories with a single API call. It automatically clones the repository, installs dependencies, builds the project, and serves it on a unique subdomain mirroring the core deployment experience of Vercel.

### The Problem It Solves

Hosted deployment platforms like Vercel, Railway, and Render impose pricing tiers, cold starts, vendor lock-in, and limited infrastructure visibility. This project provides a fully self-owned alternative deployable on your own AWS infrastructure with complete transparency into every layer of the stack.

### Key Features

- **Automatic builds** - clones repo, detects framework, builds and deploys without manual intervention
- **Dual framework support** - React apps served statically via S3; Node.js apps containerized and proxied dynamically
- **Custom subdomain routing** - every deployed project receives a unique `<project-name>.<domain>` URL with SSL
- **Real-time build logs** - streamed and persisted to Supabase, accessible from the frontend during deployment
- **GitHub Webhook integration** - push to GitHub triggers automatic redeployment
- **Email notifications** - deployment success emails via Resend
- **On-demand infrastructure** - single-command Kubernetes cluster provisioning on AWS Spot instances (~70% cost reduction)
- **Idempotent teardown** - `destroy.sh` terminates all infrastructure cleanly, billing stops immediately

---

## User Diagram
<p align="center">
  <img src="https://github.com/PriyanshuValiya/vercel-v-2/blob/main/Vercel.png" alt="Vercel Clone Architecture" />
</p>

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15, Tailwind CSS, Supabase Auth |
| **Backend API** | Node.js, Express, TypeScript |
| **Build Runner** | Node.js, Docker, TypeScript |
| **Proxy** | Node.js, `http-proxy`, Express |
| **Upload Service** | Node.js, AWS SDK v3 (S3) |
| **Queue** | Upstash Redis (managed Redis with TLS) |
| **Database** | Selfhosted Supabase (PostgreSQL) |
| **Object Storage** | AWS S3 |
| **Container Runtime** | Docker |
| **Container Orchestration** | Kubernetes (KIND cluster) |
| **Reverse Proxy** | Nginx (on EC2 host, managed by runner-service) |
| **SSL** | Cloudflare Origin Certificates |
| **Infrastructure** | AWS EC2 (Spot instances), Terraform |
| **Email** | Resend |
| **DNS / CDN** | Cloudflare |

---

## Architecture Overview

The system is composed of four independent microservices coordinated via a Redis queue and a shared Supabase database.

```
                        ┌─────────────────────────────────────────────────┐
                        │              USER / FRONTEND (www)              │
                        │     Next.js — hosted on Vercel (vercel-v-2)     │
                        └──────────────────────┬──────────────────────────┘
                                               │ HTTPS API calls
                                               ▼
                        ┌─────────────────────────────────────────────────┐
                        │         api-vercel.priyanshuvaliya.dev          │
                        │                SERVER (port 4500)               │
                        │    Express API — manages projects, queues jobs  │
                        └────────┬──────────────────────┬─────────────────┘
                                 │ lpush                │ read/write
                                 ▼                      ▼
                   ┌─────────────────────┐   ┌──────────────────────┐
                   │   Upstash Redis     │   │  Supabase (Postgres) │
                   │   build-queue       │   │  projects, users,    │
                   └──────────┬──────────┘   │  logs table          │
                              │ rpop         └──────────────────────┘
                              ▼
                   ┌──────────────────────────────────────────────────────┐
                   │                 RUNNER SERVICE                       │
                   │  Polls Redis → clones repo → installs deps → builds  │
                   │                                                      │
                   │  React project:                                      │
                   │    npm run build → POST /upload (upload-service)     │
                   │    writeNginxRoute() → reloadNginx()                 │
                   │                                                      │
                   │  Node project:                                       │
                   │    docker build → docker run -p HOST:3000            │
                   │    writeNginxRoute() → reloadNginx()                 │
                   └───────────┬──────────────────┬───────────────────────┘
                               │                  │
                               ▼                  ▼
              ┌─────────────────────┐   ┌─────────────────────────────────┐
              │   UPLOAD SERVICE    │   │  Nginx (EC2 host)               │
              │   (port 4000)       │   │  /etc/nginx/conf.d/<id>.conf    │
              │   Uploads build →   │   │  SSL termination per project    │
              │   AWS S3 bucket     │   │  Proxy pass → S3 or container   │
              └─────────────────────┘   └─────────────────────────────────┘
                               │
                               ▼
                   ┌──────────────────────────────────────────────────────┐
                   │       *.priyanshuvaliya.dev (Cloudflare → EC2)       │
                   │                PROXY SERVICE (port 5000)             │
                   │  Extracts subdomain → queries Supabase for project   │
                   │  React  → 302 redirect to S3 URL                     │
                   │  Node   → http-proxy to 127.0.0.1:<port>             │
                   └──────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Service | Responsibility |
|---|---|
| `server` | REST API, project CRUD, Redis queue producer, webhook handler |
| `runner-service` | Redis consumer, build orchestrator, Docker image builder, Nginx config writer |
| `upload-service` | Receives build artifacts from runner, uploads to S3 |
| `proxy-service` | Subdomain-based request router — dispatches to S3 or running container |

---

## Project Structure

- **runner-service**: Handles command execution, port management, Nginx routing, Redis caching, and Supabase integration for deployment automation.
- **server**: Provides API endpoints for project management, proxying, and integration with Redis and Supabase.
- **upload-service**: Manages file uploads and S3 storage integration.
- **www**: The frontend application built with Next.js, including authentication, dashboard, deployment client, and UI components.

## Features
- Microservices architecture for scalability
- Dockerized services for easy deployment
- Next.js frontend for user interaction
- Nginx-based routing and proxying
- Redis and Supabase integration for data management
- S3 support for file uploads

## Demo Video
([🎥 Watch Demo](https://assets-priyanshuvaliya.s3.ap-south-1.amazonaws.com/Vercel.mp4))

## Getting Started

1. **Clone the repository:**
	```powershell
	git clone https://github.com/PriyanshuValiya/vercel.git
	cd vercel
	```
2. **Start all services using Docker Compose:**
	```powershell
	docker-compose up --build
	```
3. **Access the frontend:**
	Open your browser and navigate to `http://localhost:3000`.

## Requirements
- Docker & Docker Compose
- Node.js & npm (for local development)

	---

	## Demo Video (Click the image to see a demo video)

	<p align="center">
	<a href="https://assets-priyanshuvaliya.s3.ap-south-1.amazonaws.com/Vercel.mp4">
		<img src="https://raw.githubusercontent.com/PriyanshuValiya/vercel-v-2/main/Vercel.png" />
	</a>
	</p>