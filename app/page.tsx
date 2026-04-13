"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CollectionOption,
  LLMProvider,
  SummaryCategory,
  SummaryModel,
  SummarizedItem
} from "@/lib/types";

type CollectionsResponse = {
  collections?: CollectionOption[];
  error?: string;
};

type SummaryResponse = {
  total?: number;
  items?: SummarizedItem[];
  error?: string;
};

type ConfigResponse = {
  provider?: LLMProvider;
  defaultModel?: SummaryModel;
  availableModels?: SummaryModel[];
  error?: string;
};

const toneLabels: Record<string, string> = {
  action_item: "Action Item",
  tech_article: "Tech Article",
  non_tech_article: "Non-Tech Article",
  other: "Other"
};

const sectionOrder: SummaryCategory[] = [
  "tech_article",
  "non_tech_article",
  "action_item",
  "other"
];

const sectionTitles: Record<SummaryCategory, string> = {
  tech_article: "Tech Briefings",
  non_tech_article: "General Briefings",
  action_item: "Action Desk",
  other: "Other Links"
};

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export default function HomePage() {
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<SummaryModel>("");
  const [availableModels, setAvailableModels] = useState<SummaryModel[]>([]);
  const [maxItems, setMaxItems] = useState<string>("20");
  const [items, setItems] = useState<SummarizedItem[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    async function loadInitialData() {
      setLoadingCollections(true);
      setError("");

      const [configResponse, collectionsResponse] = await Promise.all([
        fetch("/api/config", {
          cache: "no-store"
        }),
        fetch("/api/collections", {
          cache: "no-store"
        })
      ]);
      const configData = (await configResponse.json()) as ConfigResponse;
      const collectionsData = (await collectionsResponse.json()) as CollectionsResponse;

      if (!configResponse.ok || configData.error) {
        setError(configData.error || "Failed to load app configuration");
        setLoadingCollections(false);
        return;
      }

      if (!collectionsResponse.ok || collectionsData.error) {
        setError(collectionsData.error || "Failed to load collections");
        setLoadingCollections(false);
        return;
      }

      const models = configData.availableModels || [];
      setAvailableModels(models);
      setSelectedModel(configData.defaultModel || models[0] || "");
      setCollections(collectionsData.collections || []);
      setSelectedCollection(
        collectionsData.collections?.[0]?.id ? String(collectionsData.collections[0].id) : ""
      );
      setLoadingCollections(false);
    }

    void loadInitialData();
  }, []);

  async function summarizeCollection() {
    if (!selectedCollection) return;
    const parsedMaxItems = Number(maxItems);
    const safeMaxItems =
      Number.isFinite(parsedMaxItems) && parsedMaxItems > 0
        ? Math.min(500, Math.floor(parsedMaxItems))
        : 20;

    setLoadingSummary(true);
    setError("");
    setItems([]);

    const response = await fetch("/api/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        collectionId: Number(selectedCollection),
        maxItems: safeMaxItems,
        model: selectedModel
      })
    });

    const data = (await response.json()) as SummaryResponse;

    if (!response.ok || data.error) {
      setError(data.error || "Failed to summarize collection");
      setLoadingSummary(false);
      return;
    }

    setItems(data.items || []);
    setLoadingSummary(false);
  }

  const generatedAt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "full"
      }).format(new Date()),
    []
  );

  const groupedSections = sectionOrder
    .map((type) => ({
      type,
      title: sectionTitles[type],
      items: items.filter((item) => item.summary.contentType === type)
    }))
    .filter((section) => section.items.length > 0);

  const selectedLabel =
    collections.find((collection) => String(collection.id) === selectedCollection)?.path || "No folder";

  return (
    <main className="newsletter-shell">
      <section className="masthead">
        <p className="kicker">RAINDROP DIGEST</p>
        <h1>Daily Link Intelligence</h1>
        <p className="lede">
          A newsletter-style issue generated from one Raindrop folder. Every item is classified,
          linked, and summarized in long-form.
        </p>
      </section>

      <section className="toolbar" aria-label="Digest controls">
        <div className="field">
          <label htmlFor="collection">Folder</label>
          <select
            id="collection"
            value={selectedCollection}
            onChange={(event) => setSelectedCollection(event.target.value)}
            disabled={loadingCollections || loadingSummary}
          >
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.path} ({collection.count})
              </option>
            ))}
          </select>
        </div>

        <div className="field field-medium">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value as SummaryModel)}
            disabled={loadingCollections || loadingSummary}
          >
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div className="field field-compact">
          <label htmlFor="max-items">Items</label>
          <input
            id="max-items"
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={maxItems}
            onChange={(event) => setMaxItems(event.target.value)}
            disabled={loadingCollections || loadingSummary}
          />
        </div>

        <button onClick={summarizeCollection} disabled={!selectedCollection || loadingSummary}>
          {loadingSummary ? "Building Issue..." : "Build Newsletter"}
        </button>
      </section>

      {loadingCollections && <p className="status">Loading collections...</p>}
      {error && <p className="status error">{error}</p>}

      {items.length > 0 && (
        <section className="issue">
          <header className="issue-header">
            <div>
              <p className="issue-label">Issue Date</p>
              <p className="issue-date">{generatedAt}</p>
            </div>
            <div>
              <p className="issue-label">Folder</p>
              <p className="issue-count">{selectedLabel}</p>
            </div>
            <div>
              <p className="issue-label">Stories</p>
              <p className="issue-count">{items.length}</p>
            </div>
            <div>
              <p className="issue-label">Limit</p>
              <p className="issue-count">{maxItems}</p>
            </div>
          </header>

          {groupedSections.map((section) => (
            <section className="issue-section" key={section.type}>
              <div className="section-heading">
                <h2>{section.title}</h2>
                <p>{section.items.length} items</p>
              </div>
              <ol className="entry-list">
                {section.items.map((item) => (
                  <li className="entry" key={item.id}>
                    <article>
                      <p className="entry-meta">
                        <span className="entry-type">{toneLabels[item.summary.contentType]}</span>
                        <span>{item.domain}</span>
                        <span>Confidence {Math.round(item.summary.confidence * 100)}%</span>
                        <span>{wordCount(item.summary.summary)} words</span>
                        {item.summary.fallbackUsed && (
                          <details className="fallback-note">
                            <summary>Fallback summary</summary>
                            <div className="fallback-popover" role="note">
                              <p>AI LLM did not produce the final summary for this item.</p>
                              <p>{item.summary.fallbackReason || item.summary.rationale}</p>
                            </div>
                          </details>
                        )}
                      </p>

                      <h3>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.title}
                        </a>
                      </h3>

                      <p className="entry-link">
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.url}
                        </a>
                      </p>

                      <p className="entry-summary">{item.summary.summary}</p>

                      {item.summary.bullets.length > 0 && (
                        <ul>
                          {item.summary.bullets.map((bullet, index) => (
                            <li key={`${item.id}-${index}`}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </section>
      )}
    </main>
  );
}
