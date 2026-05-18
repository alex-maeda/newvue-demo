FROM node:18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps --ignore-scripts
COPY . .
RUN npm run build

FROM nginx:alpine
COPY devops/nginx/nginx.conf /etc/nginx/nginx.conf
COPY devops/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
