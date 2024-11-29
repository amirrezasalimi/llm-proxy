import { describe, expect, test } from "bun:test";

// Helper function to poll request status until completion or timeout
async function pollRequestStatus(requestId: string, maxAttempts = 10, interval = 1000): Promise<any> {
  const API_URL = "http://localhost:3000";
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusResponse = await fetch(`${API_URL}/v1/chat/completions/${requestId}`);
    const statusData = await statusResponse.json();
    
    console.log(JSON.stringify(statusData,null,2));
    
    if (statusData.status === "completed" || statusData.status === "error") {
      return statusData;
    }
    
    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Request ${requestId} did not complete within ${maxAttempts * interval}ms`);
}

describe("API Tests", () => {
  const API_URL = "http://localhost:3000";

  test("health check endpoint", async () => {
    const response = await fetch(`${API_URL}/health`);
    expect(response.status).toBe(200);
  });

  test("chat completion endpoint with polling", async () => {
    const mockRequest = {
      model: "meta-llama/llama-3.2-3b-instruct",
      messages: [{ role: "user", content: "Hello" }]
    };

    // Initial request
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(mockRequest)
    });

    expect(response.status).toBe(202); // Accepted
    const data = await response.json();

    
    expect(data).toHaveProperty("request_id");

    // Poll for completion
    const finalStatus = await pollRequestStatus(data.request_id);

    expect(finalStatus.status).toMatch(/^(completed|error)$/);
    
    if (finalStatus.status === "completed") {
      expect(finalStatus.response).toBeDefined();
      expect(finalStatus.response.choices).toBeDefined();
    } else {
      expect(finalStatus.error).toBeDefined();
    }
  }, 30000); // Increased timeout to 30 seconds

  test("invalid request handling", async () => {
    const invalidRequest = {
      // Missing required fields
    };

    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(invalidRequest)
    });

    expect(response.status).toBe(400);
  });
});
