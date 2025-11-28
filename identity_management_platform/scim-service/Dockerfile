FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY src ./src
COPY proto ./proto
ENV GRPC_USER_HOST=user-service
ENV GRPC_USER_PORT=8083
ENV JWKS_URL=http://auth-service:8081/oauth/jwks
EXPOSE 8082
CMD ["node","src/index.js"]
