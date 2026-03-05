import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, StructuredRequest, TextRequest } from './provider.js';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const tool: Anthropic.Tool = {
      name: request.functionName,
      description: request.functionDescription,
      input_schema: {
        type: 'object',
        properties: request.parameters,
        required: request.requiredFields,
      },
    };

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userMessage }],
      tools: [tool],
      tool_choice: { type: 'tool', name: request.functionName },
    });

    const toolBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolBlock) {
      throw new Error(`Model did not return structured output via ${request.functionName}`);
    }

    return toolBlock.input as T;
  }

  async generateText(request: TextRequest): Promise<string | null> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userMessage }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );

    return textBlock?.text ?? null;
  }
}
