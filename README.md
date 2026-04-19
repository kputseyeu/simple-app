# Simple Auth App

A simple login/registration application with PostgreSQL and Docker support.

## Features
- User registration with username, email, and password
- User login with JWT token authentication
- Password hashing with bcrypt
- PostgreSQL database
- Docker support for easy deployment

## Quick Start with Docker Compose

```bash
docker-compose up -d
```

Access the app at http://localhost:3000

## Manual Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables (copy `.env.example` to `.env`):
```bash
cp .env.example .env
```

3. Start PostgreSQL (or use docker-compose for the database only):
```bash
docker-compose up -d db
```

4. Run the app:
```bash
npm start
```

## API Endpoints

- `POST /api/register` - Register a new user
  - Body: `{ "username": "...", "email": "...", "password": "..." }`

- `POST /api/login` - Login and get JWT token
  - Body: `{ "username": "...", "password": "..." }`

## GitOps Deployment

This app is ready for GitOps platforms. The Dockerfile creates a production-ready container.

Build image:
```bash
docker build -t simple-auth-app:latest .
```

Run container:
```bash
docker run -p 3000:3000 \
  -e DB_HOST=your-db-host \
  -e DB_PASSWORD=your-db-password \
  simple-auth-app:latest
```
