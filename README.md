# LLM Proxy

A robust Express-based proxy server for managing Large Language Model API requests with request queuing, status tracking, and concurrent request handling.

## Features

- **Request Queuing**: Efficient management of concurrent LLM API requests
- **Status Tracking**: Monitor request status (pending, processing, completed, error)
- **Rate Limiting**: Built-in request queue with configurable concurrency
- **Error Handling**: Automatic retry mechanism for failed requests
- **Webhook Support**: Optional callbacks when requests complete or fail
- **OpenAI Integration**: Pre-configured for OpenAI API with customizable endpoints
- **Type Safety**: Built with TypeScript for robust type checking
- **Security**: Includes Helmet middleware and API key authentication for enhanced API security

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.1.36 or later)
- OpenAI API key
- Node.js environment

## Installation

```bash
# Clone the repository
git clone [your-repo-url]
cd llm-proxy

# Install dependencies
bun install
```

## Configuration

Create a `.env` file in the root directory:

```env
PORT=3000
OPENAI_API_KEY=your-api-key-here
OPENAI_API_BASE_URL=your-endpoint-here
MAX_CONCURRENT=2
API_KEY=your-proxy-api-key-here
```

## Usage

### Authentication

All endpoints (except `/health`) require authentication using an API key. Include the API key in your requests using the `X-API-Key` header:

```http
X-API-Key: your-proxy-api-key-here
```

Requests without a valid API key will receive a 401 Unauthorized response.

### API Endpoints

#### 1. Health Check
```http
GET /health
```
Returns server health status.

Response:
```json
{
  "status": "ok"
}
```

#### 2. Submit Chat Completion
```http
POST /v1/chat/completions
```

Request body:
```typescript
{
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "function";
    content: string;
    name?: string;
    function_call?: Record<string, unknown>;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  presence_penalty?: number;  // Range: -2.0 to 2.0
  frequency_penalty?: number; // Range: -2.0 to 2.0
  top_p?: number;            // Range: 0 to 1
  stop?: string | string[];
  functions?: Array<Record<string, unknown>>;
  function_call?: string | Record<string, unknown>;
  webhookUrl?: string;       // Optional webhook URL for completion notifications
}
```

Success Response (202 Accepted):
```json
{
  "request_id": "string",
  "status": "pending",
  "queue_position": number,
  "active_requests": number
}
```

Error Response (400 Bad Request):
```json
{
  "error": {
    "message": "Invalid request body",
    "type": "validation_error",
    "details": []
  }
}
```

#### 3. Check Request Status
```http
GET /v1/chat/completions/:requestId
```

Responses:

Success (200 OK):
```typescript
interface RequestStatus {
  status: "completed";
  request: ChatCompletionRequest;
  response: any;  // OpenAI API response
  timestamp: number;
}
```

Pending/Processing (200 OK):
```typescript
interface RequestStatus {
  status: "pending" | "processing";
  request: ChatCompletionRequest;
  timestamp: number;
}
```

Error (200 OK):
```typescript
interface RequestStatus {
  status: "error";
  request: ChatCompletionRequest;
  error: {
    message: string;
    type: string;
    attempts?: number;
  };
  timestamp: number;
}
```

Not Found (404):
```json
{
  "error": {
    "message": "Request not found",
    "type": "request_not_found"
  }
}
```

#### 3. Webhook Notifications

If a `webhookUrl` is provided in the request, the server will send a POST request to that URL when the request is completed or encounters an error.

Successful Completion Webhook:
```json
{
  "request_id": "string",
  "status": "completed",
  "response": {
    // OpenAI completion response
  }
}
```

Error Webhook:
```json
{
  "request_id": "string",
  "status": "error",
  "error": {
    "message": "Error message",
    "type": "error_type",
    "attempts": number
  }
}
```

### Example Usage

```typescript
async function chatWithLLM(messages: Array<{ role: string; content: string }>) {
  try {
    // Submit request
    const submitResponse = await fetch('http://localhost:3000/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': 'your-proxy-api-key-here'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.7
      })
    });
    
    const { request_id } = await submitResponse.json();
    
    // Poll for completion
    while (true) {
      const statusResponse = await fetch(`http://localhost:3000/v1/chat/completions/${request_id}`, {
        headers: { 
          'X-API-Key': 'your-proxy-api-key-here'
        }
      });
      const status = await statusResponse.json();
      
      if (status.status === 'completed') {
        return status.response;
      }
      
      if (status.status === 'error') {
        throw new Error(status.error?.message || 'Unknown error');
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Usage
const conversation = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is the capital of France?' }
];

const response = await chatWithLLM(conversation);
console.log(response);
```

### Request Queue Features

The proxy implements automatic request queuing with the following features:
- Concurrent request limit: 2 requests processed simultaneously
- Automatic queue management
- Request timeout handling
- Automatic cleanup of old requests (after 1 hour)
- Queue position tracking
- Active request count

### Error Handling

The proxy implements automatic retry logic for failed requests. Common error types:

- `validation_error`: Invalid request parameters
- `request_not_found`: Request ID doesn't exist or was cleaned up
- Network errors: Connection issues with OpenAI API
- Rate limiting: Too many requests to OpenAI API
- Server errors: Internal server issues

## Docker Support

Build and run using Docker:

```bash
# Build the image
docker build -t llm-proxy .

# Run the container
docker run -p 3000:3000 --env-file .env llm-proxy
```

## Development

```bash
# Run tests
bun test

# Start development server
bun run dev
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.