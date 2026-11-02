# Build from the repository root: docker build -f web/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
# Compressed once here, at the best ratio, so nginx sends these files as they are (gzip_static).
RUN find dist/web/browser -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.html' -o -name '*.webmanifest' \) -size +1k -exec gzip -9 -k -n {} +

FROM nginx:1.29-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist/web/browser /usr/share/nginx/html
