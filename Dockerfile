# Stage 1: Build the application
FROM node:20-alpine as builder
WORKDIR /app

# Disable Puppeteer Chromium download to speed up layer caching significantly
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install compatibility libraries for Alpine
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

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

# Copy custom nginx config with CORS headers
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# The default nginx command will start the server
CMD ["nginx", "-g", "daemon off;"]
