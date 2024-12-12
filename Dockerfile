# Application Docker file Configuration
# Visit https://docs.docker.com/engine/reference/builder/
# Using multi stage build

# Prepare the image when build
# also use to minimize the docker image
FROM node:22-alpine as builder

WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npm install -g @nestjs/cli 
COPY . .
RUN nest build app


# Build the image as production
# So we can minimize the size
FROM node:22-alpine as production

ARG NODE_ENV=production

WORKDIR /app
COPY package*.json ./
ENV PORT=4000
ENV NODE_ENV=Production
RUN npm install
COPY --from=builder /app/dist ./dist
EXPOSE ${PORT}

CMD ["node", "dist/main"]
