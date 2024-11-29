# Use Ubuntu as the base image
FROM ubuntu:22.04

# Set the working directory
WORKDIR /app

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary packages
RUN apt-get update && apt-get install -y \
    tzdata \
    curl \
    ca-certificates \
    unzip \
    wget \
    bash \
    gcc \
    g++ \
    libstdc++ \
    && rm -rf /var/lib/apt/lists/* \
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