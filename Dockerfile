# Stage 1: Build the application
FROM node:20-alpine as builder
WORKDIR /app

# Disable Puppeteer Chromium download to speed up layer caching significantly
ENV PUPPETEER_SKIP_DOWNLOAD=true

# No VITE_* build args: the UI only talks to our own renderer over relative
# paths, and no API key is baked into the frontend any more.

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
