import { describe, it, expect, afterEach, vi } from "vitest";
import { geminiProvider } from "@/lib/ai/providers/gemini";
import {
  AiAuthenticationError,
  AiProviderError,
  AiRateLimitError,
  AiTimeoutError,
  AiValidationError,
} from "@/lib/ai/errors";
import { mockFetchSequence } from "../../mocks/fetch";

const credentials = { apiKey: "test-google-key", model: "text-embedding-004" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("geminiProvider.capabilities", () => {
  it("declares embeddings-only support, matching what embed() actually does", () => {
    expect(geminiProvider.capabilities).toEqual({
      chat: false,
      embeddings: true,
      tools: false,
      streaming: false,
      vision: false,
      jsonMode: false,
    });
  });
});

describe("geminiProvider.embed — request shape", () => {
  it("sends the model, content, and API key in the URL", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }) }]);

    await geminiProvider.embed(credentials, "Nous livrons partout au Maroc.");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=test-google-key"
    );
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: "models/text-embedding-004",
      content: { parts: [{ text: "Nous livrons partout au Maroc." }] },
    });
  });

  it("URL-encodes the API key", async () => {
    const fetchMock = mockFetchSequence([{ json: async () => ({ embedding: { values: [0.1] } }) }]);

    await geminiProvider.embed({ apiKey: "key with spaces", model: "text-embedding-004" }, "hi");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("key=key%20with%20spaces");
  });
});

describe("geminiProvider.embed — response parsing", () => {
  it("returns the embedding values and the requested model", async () => {
    mockFetchSequence([{ json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }) }]);

    const result = await geminiProvider.embed(credentials, "hi");

    expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], model: "text-embedding-004" });
  });

  it("throws AiProviderError when the response has no embedding at all", async () => {
    mockFetchSequence([{ json: async () => ({}) }]);

    await expect(geminiProvider.embed(credentials, "hi")).rejects.toThrow(AiProviderError);
  });

  it("throws AiProviderError when the response's embedding has empty values", async () => {
    mockFetchSequence([{ json: async () => ({ embedding: { values: [] } }) }]);

    await expect(geminiProvider.embed(credentials, "hi")).rejects.toThrow(AiProviderError);
  });
});

describe("geminiProvider.embed — error mapping", () => {
  it("maps HTTP 401 to AiAuthenticationError", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);
    await expect(geminiProvider.embed(credentials, "hi")).rejects.toThrow(AiAuthenticationError);
  });

  it("maps HTTP 403 to AiAuthenticationError", async () => {
    mockFetchSequence([{ ok: false, status: 403 }]);
    await expect(geminiProvider.embed(credentials, "hi")).rejects.toThrow(AiAuthenticationError);
  });

  it("maps HTTP 429 to AiRateLimitError, carrying Retry-After when present", async () => {
    mockFetchSequence([{ ok: false, status: 429, headers: { "retry-after": "5" } }]);

    const error = await geminiProvider.embed(credentials, "hi").catch((err) => err);

    expect(error).toBeInstanceOf(AiRateLimitError);
    expect((error as AiRateLimitError).retryAfterSeconds).toBe(5);
  });

  it("maps HTTP 400 to AiValidationError", async () => {
    mockFetchSequence([{ ok: false, status: 400, text: async () => "invalid model" }]);
    await expect(geminiProvider.embed(credentials, "hi")).rejects.toThrow(AiValidationError);
  });

  it("maps HTTP 422 to AiValidationError", async () => {
    mockFetchSequence([{ ok: false, status: 422 }]);
    await expect(geminiProvider.embed(credentials, "hi")).rejects.toThrow(AiValidationError);
  });

  it("maps any other non-2xx status to the generic AiProviderError", async () => {
    mockFetchSequence([{ ok: false, status: 503 }]);
    await expect(geminiProvider.embed(credentials, "hi")).rejects.toThrow(AiProviderError);
  });

  it("maps a request timeout (AbortError) to AiTimeoutError", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(geminiProvider.embed(credentials, "hi")).rejects.toThrow(AiTimeoutError);
  });

  it("wraps a plain network error in AiProviderError, preserving it as `cause`", async () => {
    const networkError = new Error("ECONNRESET");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    const error = await geminiProvider.embed(credentials, "hi").catch((err) => err);

    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).cause).toBe(networkError);
  });

  it("every mapped error carries the provider name", async () => {
    mockFetchSequence([{ ok: false, status: 401 }]);
    const error = await geminiProvider.embed(credentials, "hi").catch((err) => err);
    expect((error as AiAuthenticationError).provider).toBe("gemini");
  });
});
