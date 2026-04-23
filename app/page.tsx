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

type ThemeMode = "light" | "dark";

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

const folderTooltip = "Choose the Raindrop folder you want to summarize.";
const modelTooltip =
  "To change the model used here, update the configuration file and check the README for more details.";
const itemsTooltip = "Set how many saved links to include in this newsletter build.";
const buildTooltip = "Build a newsletter-style summary for the selected folder and item count.";

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function HomePage() {
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<SummaryModel>("");
  const [maxItems, setMaxItems] = useState<string>("20");
  const [items, setItems] = useState<SummarizedItem[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState<string>("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("raindrop-digest-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setThemeMode(storedTheme);
      return;
    }

    const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    setThemeMode(preferredTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem("raindrop-digest-theme", themeMode);
  }, [themeMode]);

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

      setSelectedModel(configData.defaultModel || configData.availableModels?.[0] || "");
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

  async function copyEntryUrl(url: string) {
    try {
      await copyTextToClipboard(url);
    } catch {
      // Ignore clipboard failures. The button remains non-blocking.
    }
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
        <div className="masthead-row">
          <div>
            <p className="kicker">RAINDROP DIGEST</p>
            <h1>Your Bookmarks Summarized</h1>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
            aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {themeMode === "dark" ? (
              <svg
                className="theme-toggle-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2.5v2.25" />
                <path d="M12 19.25v2.25" />
                <path d="M21.5 12h-2.25" />
                <path d="M4.75 12H2.5" />
                <path d="m18.72 5.28-1.59 1.59" />
                <path d="m6.87 17.13-1.59 1.59" />
                <path d="m18.72 18.72-1.59-1.59" />
                <path d="M6.87 6.87 5.28 5.28" />
              </svg>
            ) : (
              <svg
                className="theme-toggle-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />
              </svg>
            )}
          </button>
        </div>
        <p className="lede">
          A newsletter-style issue generated from one Raindrop folder. Every item is classified,
          linked, and summarized in long-form.
        </p>
      </section>

      <section className="toolbar" aria-label="Digest controls">
        <div className="field">
          <label htmlFor="collection" title={folderTooltip}>Folder</label>
          <select
            id="collection"
            title={folderTooltip}
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

        <div className="field field-compact">
          <label htmlFor="max-items" title={itemsTooltip}>Items</label>
          <input
            id="max-items"
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            title={itemsTooltip}
            value={maxItems}
            onChange={(event) => setMaxItems(event.target.value)}
            disabled={loadingCollections || loadingSummary}
          />
        </div>

        <button
          className="build-button"
          title={buildTooltip}
          onClick={summarizeCollection}
          disabled={!selectedCollection || loadingSummary}
        >
          Build Newsletter
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
            <div>
              <p className="issue-label">Model</p>
              <p className="issue-model">{selectedModel}</p>
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
                        <button
                          type="button"
                          className="entry-copy-button"
                          title="Copy this URL"
                          aria-label="Copy this URL"
                          onClick={() => void copyEntryUrl(item.url)}
                        >
                          <svg
                            className="entry-copy-icon"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M9 4.75H7.75A2.75 2.75 0 0 0 5 7.5v10.75A2.75 2.75 0 0 0 7.75 21h8.5A2.75 2.75 0 0 0 19 18.25V17" />
                            <path d="M10.75 3h5.5A2.75 2.75 0 0 1 19 5.75v7.5A2.75 2.75 0 0 1 16.25 16h-5.5A2.75 2.75 0 0 1 8 13.25v-7.5A2.75 2.75 0 0 1 10.75 3Z" />
                          </svg>
                        </button>
                      </p>

                      <p className="entry-summary">{item.summary.summary}</p>

                      {item.summary.tags.length > 0 && (
                        <div className="entry-tags" aria-label="Content tags">
                          {item.summary.tags.map((tag) => (
                            <span className="entry-tag" key={`${item.id}-${tag}`}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

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
