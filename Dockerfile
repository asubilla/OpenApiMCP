# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
# Example:
#   docker run -p 3000:3000 openapimcp https://petstore3.swagger.io/api/v3/openapi.json --http --host 0.0.0.0
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--help"]
