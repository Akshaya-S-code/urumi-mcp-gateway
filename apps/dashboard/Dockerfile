FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHON=/usr/bin/python3
COPY package.json package-lock.json ./
COPY services ./services
COPY apps ./apps
COPY packages ./packages

RUN npm ci
RUN npm run build --workspace=dashboard

FROM nginx:alpine
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
