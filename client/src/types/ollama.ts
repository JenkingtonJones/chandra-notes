export interface Model {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: ModelDetails;
}

export interface ModelDetails {
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

export interface OllamaModelsResponse {
  models: Model[];
}

export interface OllamaCompletionRequest {
  model: string;
  prompt: string;
  system?: string;
  template?: string;
  context?: number[];
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stop?: string[];
    num_predict?: number;
    seed?: number;
  };
}

export interface OllamaCompletionResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}
