# Dockerfile for AgentCore Runtime
# Must be ARM64 architecture for AgentCore Runtime

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Configure UV for container environment
ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1

# Copy requirements and install dependencies
COPY requirements.txt requirements.txt
RUN uv pip install -r requirements.txt

# Install OpenTelemetry for observability
RUN uv pip install aws-opentelemetry-distro>=0.10.1

# Set AWS region environment variables
ENV AWS_REGION=ap-northeast-1 \
    AWS_DEFAULT_REGION=ap-northeast-1

# Signal that this is running in Docker
ENV DOCKER_CONTAINER=1

# Create non-root user for security
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

# Expose required ports
EXPOSE 8080
EXPOSE 8000

# Copy application code
COPY . .

# Run the application with OpenTelemetry instrumentation
CMD ["opentelemetry-instrument", "python", "-m", "agent"]
