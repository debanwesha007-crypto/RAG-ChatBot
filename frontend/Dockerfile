# --- Build stage ---
FROM node:20-slim AS build

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

# Backend URL baked in at build time (VITE_API_BASE), defaults to same-origin /api
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

# --- Serve stage ---
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
