# Vercel Clone Project

This repository contains a monorepo implementation of a Vercel-like deployment platform. It is designed to manage, deploy, and serve web projects using a microservices architecture. The project leverages Docker, TypeScript, Next.js, and various utility services for scalable and efficient deployment workflows.

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
