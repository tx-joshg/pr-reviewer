import { LLMProvider, ProviderConfig, ProviderName } from './provider.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';

export { LLMProvider, ProviderConfig, ProviderName } from './provider.js';

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config.apiKey, config.model, config.baseUrl);
    case 'anthropic':
      return new AnthropicProvider(config.apiKey, config.model);
    case 'gemini':
      return new GeminiProvider(config.apiKey, config.model);
    default:
      throw new Error(
        `Unknown LLM provider: "${config.provider}". Supported providers: openai, anthropic, gemini`
      );
  }
}
