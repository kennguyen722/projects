FROM mcr.microsoft.com/devcontainers/javascript-node:20
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm ci || npm install
COPY src ./src
RUN npm run build
EXPOSE 8080
CMD ["npm", "start"]