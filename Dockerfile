# Use Alpine as the base image for a lightweight container
FROM alpine:3.18

# Set the working directory
WORKDIR /app

# Install necessary packages
RUN apk add --no-cache \
    tzdata \
    curl \
    ca-certificates \
    unzip \
    wget \
    bash \
    && ln -sf /usr/share/zoneinfo/Etc/UTC /etc/localtime

# Install Bun - https://bun.sh/
RUN curl -fsSL https://bun.sh/install | bash

# Add Bun to the PATH
ENV BUN_INSTALL=/root/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH

# Copy package.json and install dependencies using Bun
COPY package.json ./
RUN bun install --production

# Copy the rest of the application code
COPY src ./src
COPY tsconfig.json .
COPY .env.production .env

# Set environment variables
ENV NODE_ENV=production

# Expose the application port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "start"]