# Stage 1: Build the application
FROM node:20-alpine as builder
WORKDIR /app

# Disable Puppeteer Chromium download to speed up layer caching significantly
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Frontend build-time variables (used by Vite import.meta.env)
ARG VITE_API_URL=/api/v1
ARG VITE_API_KEY=
ARG VITE_LANGUAGE_ID=kz_KSL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_KEY=${VITE_API_KEY}
ENV VITE_LANGUAGE_ID=${VITE_LANGUAGE_ID}

# Install compatibility libraries for Alpine
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve the application
FROM nginx:stable-alpine
WORKDIR /usr/share/nginx/html

# Remove default nginx page
RUN rm -rf ./*

# Copy built assets from builder stage with correct permissions
COPY --chown=nginx:nginx --from=builder /app/dist .

# Copy nginx template (will be processed at startup with envsubst)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Default backend URL (can be overridden via environment variable)
ENV BACKEND_URL=http://localhost:8000

# Expose port 80
EXPOSE 80

# nginx:stable-alpine image automatically processes templates in
# /etc/nginx/templates/ using envsubst at startup.
# No custom CMD needed — the default entrypoint handles it.
