export interface StructuredRequest<T> {
  systemPrompt: string;
  userMessage: string;
  functionName: string;
  functionDescription: string;
  parameters: Record<string, unknown>;
  requiredFields: string[];
}

export interface TextRequest {
  systemPrompt: string;
  userMessage: string;
}

export interface LLMProvider {
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>;
  generateText(request: TextRequest): Promise<string | null>;
}

export type ProviderName = 'openai' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  provider: ProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
}
