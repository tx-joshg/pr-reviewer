import { GoogleGenAI, FunctionCallingConfigMode, Type, Schema } from '@google/genai';
import { LLMProvider, StructuredRequest, TextRequest } from './provider.js';

function convertJsonSchemaType(type: string): Type {
  const typeMap: Record<string, Type> = {
    string: Type.STRING,
    number: Type.NUMBER,
    integer: Type.INTEGER,
    boolean: Type.BOOLEAN,
    array: Type.ARRAY,
    object: Type.OBJECT,
  };
  return typeMap[type] ?? Type.STRING;
}

function convertSchemaProperties(
  properties: Record<string, unknown>
): Record<string, Schema> {
  const converted: Record<string, Schema> = {};
  for (const [key, value] of Object.entries(properties)) {
    const prop = value as Record<string, unknown>;
    const result: Schema = {
      type: convertJsonSchemaType(prop.type as string),
    };
    if (prop.description) result.description = prop.description as string;
    if (prop.enum) result.enum = prop.enum as string[];
    if (prop.items) {
      const items = prop.items as Record<string, unknown>;
      result.items = {
        type: convertJsonSchemaType(items.type as string),
        ...(items.properties
          ? {
              properties: convertSchemaProperties(
                items.properties as Record<string, unknown>
              ),
            }
          : {}),
        ...(items.required ? { required: items.required as string[] } : {}),
      };
    }
    converted[key] = result;
  }
  return converted;
}

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: `${request.systemPrompt}\n\n${request.userMessage}`,
      config: {
        tools: [
          {
            functionDeclarations: [
              {
                name: request.functionName,
                description: request.functionDescription,
                parameters: {
                  type: Type.OBJECT,
                  properties: convertSchemaProperties(request.parameters),
                  required: request.requiredFields,
                },
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [request.functionName],
          },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.find(
      (p) => p.functionCall?.name === request.functionName
    );

    if (!part?.functionCall?.args) {
      throw new Error(`Model did not return structured output via ${request.functionName}`);
    }

    return part.functionCall.args as T;
  }

  async generateText(request: TextRequest): Promise<string | null> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: `${request.systemPrompt}\n\n${request.userMessage}`,
    });

    return response.text ?? null;
  }
}
