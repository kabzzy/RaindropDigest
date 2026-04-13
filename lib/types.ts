export type Collection = {
  _id: number;
  title: string;
  count?: number;
  parent?: {
    $id: number;
  };
};

export type CollectionOption = {
  id: number;
  title: string;
  count: number;
  path: string;
};

export type SummaryModel = string;

export type LLMProvider = "openai" | "gemini";

export type RaindropItem = {
  _id: number;
  title: string;
  excerpt?: string;
  note?: string;
  type: string;
  link: string;
  domain?: string;
  tags?: string[];
  created?: string;
};

export type ExtractedContent = {
  url: string;
  title: string;
  text: string;
  byline?: string;
  siteName?: string;
};

export type SummaryCategory =
  | "tech_article"
  | "non_tech_article"
  | "action_item"
  | "other";

export type SummaryResult = {
  contentType: SummaryCategory;
  confidence: number;
  summary: string;
  bullets: string[];
  rationale: string;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
};

export type SummarizedItem = {
  id: number;
  title: string;
  url: string;
  domain: string;
  raindropType: string;
  summary: SummaryResult;
};
