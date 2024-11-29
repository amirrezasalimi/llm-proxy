import express from "express";
import cors from "cors";
import helmet from "helmet";
import OpenAI from "openai";
import { nanoid } from "nanoid";
import { z } from "zod";

const app = express();
const port = process.env.PORT || 3000;
const maxConcurrent = parseInt(process.env.MAX_CONCURRENT || "2", 10);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE_URL,
});

// Types
interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  [key: string]: any;
}

interface RequestStatus {
  status: "pending" | "processing" | "completed" | "error";
  request: ChatCompletionRequest;
  webhookUrl?: string;
  response?: any;
  error?: {
    message: string;
    type: string;
    attempts?: number;
  };
  timestamp: number;
}

// Zod schemas
const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "function"]),
  content: z.string(),
  name: z.string().optional(),
  function_call: z.record(z.unknown()).optional(),
});

const chatCompletionSchema = z.object({
  model: z.string().default("gpt-3.5-turbo"),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  max_tokens: z.number().positive().int().optional(),
  stream: z.boolean().optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  functions: z.array(z.record(z.unknown())).optional(),
  function_call: z.union([z.string(), z.record(z.unknown())]).optional(),
  webhookUrl: z.string().url().optional(),
});

// Request queue and concurrency management
class RequestQueue {
  private queue: string[] = [];
  private processing = new Set<string>();
  private maxConcurrent: number;
  private processingPromises = new Map<string, Promise<void>>();

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async add(requestId: string): Promise<void> {
    if (this.processingPromises.size < this.maxConcurrent) {
      await this.startProcessing(requestId);
    } else {
      this.queue.push(requestId);
    }
  }

  private async startProcessing(requestId: string): Promise<void> {
    const processPromise = this.processRequest(requestId);
    this.processingPromises.set(requestId, processPromise);

    try {
      await processPromise;
    } finally {
      this.processingPromises.delete(requestId);
      this.processing.delete(requestId);
      this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    while (
      this.queue.length > 0 &&
      this.processingPromises.size < this.maxConcurrent
    ) {
      const nextRequestId = this.queue.shift();
      if (nextRequestId) {
        await this.startProcessing(nextRequestId);
      }
    }
  }

  private async processRequest(requestId: string): Promise<void> {
    this.processing.add(requestId);
    const request = requestStore.get(requestId);
    if (!request) return;

    try {
      await processRequestWithRetry(requestId, request.request);
    } catch (error) {
      console.error(`Error processing request ${requestId}:`, error);
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getProcessingCount(): number {
    return this.processing.size;
  }
}

const requestQueue = new RequestQueue(maxConcurrent);

const requestStore = new Map<string, RequestStatus>();

// Clean up old requests periodically (keep for 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, request] of requestStore.entries()) {
    if (request.timestamp < oneHourAgo) {
      requestStore.delete(id);
    }
  }
}, 300000); // Clean every 5 minutes

// Middleware
app.use(express.json());
app.use(helmet());

app.use(cors());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Submit chat completion request
app.post("/v1/chat/completions", async (req, res) => {
  const requestId = nanoid();

  // Validate request body
  const result = chatCompletionSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: {
        message: "Invalid request body",
        type: "validation_error",
        details: result.error.errors,
      },
    });
  }

  const validatedData = result.data;
  const { webhookUrl, ...chatCompletionParams } = validatedData;

  // Store request in memory
  requestStore.set(requestId, {
    status: "pending",
    request: chatCompletionParams,
    webhookUrl,
    timestamp: Date.now(),
  });

  // Add to queue for processing
  await requestQueue.add(requestId);

  // Return request ID immediately with queue information
  res.status(202);
  res.json({
    request_id: requestId,
    status: "pending",
    queue_position: requestQueue.getQueueLength(),
    active_requests: requestQueue.getProcessingCount(),
  });
});

// Get request status/response
app.get("/v1/chat/completions/:requestId", (req, res) => {
  const { requestId } = req.params;
  const request = requestStore.get(requestId);

  if (!request) {
    return res.status(404).json({
      error: {
        message: "Request not found",
        type: "request_not_found",
      },
    });
  }

  // If completed, include the response
  if (request.status === "completed") {
    res.status(200);
    return res.json({
      status: request.status,
      response: request.response,
      queue_position: 0,
      active_requests: requestQueue.getProcessingCount(),
    });
  }

  // If error occurred, include the error
  if (request.status === "error") {
    return res.status(500).json({
      status: request.status,
      error: request.error,
      queue_position: 0,
      active_requests: requestQueue.getProcessingCount(),
    });
  }

  // If still processing or pending, return status with queue information
  res.json({
    status: request.status,
    queue_position: requestQueue.getQueueLength(),
    active_requests: requestQueue.getProcessingCount(),
  });
});

async function callWebhook(requestId: string, data: any) {
  const request = requestStore.get(requestId);
  if (!request?.webhookUrl) return;

  try {
    const response = await fetch(request.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        ...data,
      }),
    });

    if (!response.ok) {
      console.error(`Webhook call failed for ${requestId}:`, await response.text());
    }
  } catch (error) {
    console.error(`Error calling webhook for ${requestId}:`, error);
  }
}

async function processRequestWithRetry(
  requestId: string,
  params: ChatCompletionRequest,
  retryCount = 0
): Promise<void> {
  const request = requestStore.get(requestId);
  if (!request) return;

  try {
    request.status = "processing";
    const completion = await openai.chat.completions.create(params as any);

    request.status = "completed";
    request.response = completion;
    
    // Call webhook if URL was provided
    if (request.webhookUrl) {
      await callWebhook(requestId, {
        status: "completed",
        response: completion,
      });
    }
  } catch (error: any) {
    console.error(`OpenAI API Error (attempt ${retryCount + 1}/3):`, error);

    if (retryCount < 2) {
      const delay = Math.pow(2, retryCount) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return processRequestWithRetry(requestId, params, retryCount + 1);
    }

    request.status = "error";
    request.error = {
      message: error?.message || "An error occurred while processing your request",
      type: error?.type || "internal_server_error",
      attempts: retryCount + 1,
    };

    // Call webhook with error if URL was provided
    if (request.webhookUrl) {
      await callWebhook(requestId, {
        status: "error",
        error: request.error,
      });
    }
  }
}

app.listen(port, () => {
  console.log(`Proxy server running at http://localhost:${port}`);
});
