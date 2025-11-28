FROM maven:3.9.6-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /app/target/user-service-0.1.0.jar app.jar
EXPOSE 8083
# Use Spring Boot launcher to load classes from BOOT-INF
ENTRYPOINT ["java","-jar","app.jar"]
