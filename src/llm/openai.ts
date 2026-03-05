import OpenAI from 'openai';
import { LLMProvider, StructuredRequest, TextRequest } from './provider.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.model = model;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userMessage },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: request.functionName,
            description: request.functionDescription,
            parameters: {
              type: 'object',
              properties: request.parameters,
              required: request.requiredFields,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: request.functionName } },
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== request.functionName) {
      throw new Error(`Model did not return structured output via ${request.functionName}`);
    }

    return JSON.parse(toolCall.function.arguments) as T;
  }

  async generateText(request: TextRequest): Promise<string | null> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userMessage },
      ],
    });

    return response.choices[0]?.message?.content ?? null;
  }
}
