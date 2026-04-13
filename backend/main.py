import asyncio
import os
from typing import Literal, TypedDict, cast

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from readability import Document

RAINDROP_API_BASE = "https://api.raindrop.io/rest/v1"
UNSORTED_COLLECTION_ID = -1
MIN_SUMMARY_WORDS = 80
MAX_SUMMARY_WORDS = 200
MAX_CONCURRENCY = 5
REQUEST_TIMEOUT_SECONDS = 20
USER_AGENT = "Mozilla/5.0 (compatible; RaindropSummarizer/0.1; +https://example.local)"

app = FastAPI(title="Raindrop Summarizer Backend")

SummaryModel = str
LLMProvider = Literal["openai", "gemini"]

class ModelConfig(TypedDict):
    provider: LLMProvider
    env_var: str


PROVIDER_CONFIG: dict[LLMProvider, ModelConfig] = {
    "openai": {"provider": "openai", "env_var": "OPENAI_API_KEY"},
    "gemini": {"provider": "gemini", "env_var": "GEMINI_API_KEY"},
}


class CollectionRecord(BaseModel):
    id: int
    title: str
    count: int
    path: str


class CollectionResponse(BaseModel):
    collections: list[CollectionRecord]


class SummarizeRequest(BaseModel):
    collectionId: int
    maxItems: int = Field(default=20, ge=1, le=500)
    model: SummaryModel | None = None


class SummaryResult(BaseModel):
    contentType: Literal["tech_article", "non_tech_article", "action_item", "other"]
    confidence: float = Field(ge=0, le=1)
    summary: str
    bullets: list[str]
    rationale: str
    fallbackUsed: bool = False
    fallbackReason: str | None = None


class SummarizedItem(BaseModel):
    id: int
    title: str
    url: str
    domain: str
    raindropType: str
    summary: SummaryResult


class SummaryResponse(BaseModel):
    total: int
    items: list[SummarizedItem]


class ExtractedContent(BaseModel):
    url: str
    title: str
    text: str
    byline: str | None = None
    siteName: str | None = None


class RaindropCollection(BaseModel):
    id: int = Field(alias="_id")
    title: str
    count: int | None = None
    parent: dict | None = None


class RaindropItem(BaseModel):
    id: int = Field(alias="_id")
    title: str
    excerpt: str | None = None
    note: str | None = None
    type: str
    link: str
    domain: str | None = None


def get_raindrop_token() -> str:
    token = os.getenv("RAINDROP_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="Missing RAINDROP_TOKEN")
    return token


def get_configured_provider() -> LLMProvider:
    raw = os.getenv("LLM_PROVIDER")
    if not raw:
        raise HTTPException(
            status_code=500,
            detail="Missing LLM_PROVIDER. Set LLM_PROVIDER in .env.local to `openai` or `gemini`.",
        )

    provider = raw.strip().lower()
    if provider not in PROVIDER_CONFIG:
        raise HTTPException(
            status_code=500,
            detail="Invalid LLM_PROVIDER. Set LLM_PROVIDER in .env.local to `openai` or `gemini`.",
        )
    return cast(LLMProvider, provider)


def get_configured_model() -> SummaryModel:
    model = os.getenv("LLM_MODEL", "").strip()
    if not model:
        raise HTTPException(
            status_code=500,
            detail="Missing LLM_MODEL. Set LLM_MODEL in .env.local to the model for your configured provider.",
        )
    return model


def resolve_summary_model(model: SummaryModel | None) -> SummaryModel:
    configured_model = get_configured_model()
    if model is None:
        return configured_model

    if model != configured_model:
        raise HTTPException(
            status_code=400,
            detail=f"Model `{model}` does not match configured LLM_MODEL `{configured_model}`.",
        )
    return model


def get_provider_key(model: SummaryModel) -> str:
    env_var = PROVIDER_CONFIG[get_model_provider(model)]["env_var"]
    token = os.getenv(env_var)
    if not token:
        raise HTTPException(status_code=500, detail=f"Missing {env_var}")
    return token


def get_model_provider(model: SummaryModel) -> LLMProvider:
    del model
    return get_configured_provider()


def build_llm(model: SummaryModel, temperature: float):
    provider = get_model_provider(model)
    api_key = get_provider_key(model)
    if provider == "gemini":
        return ChatGoogleGenerativeAI(
            model=model,
            google_api_key=api_key,
            temperature=temperature,
        )
    return ChatOpenAI(
        model=model,
        openai_api_key=api_key,
        temperature=temperature,
    )


def count_words(text: str) -> int:
    return len([word for word in text.strip().split() if word])


def normalize_summary_length(text: str, min_words: int, max_words: int) -> str:
    words = [word for word in text.strip().split() if word]
    if len(words) > max_words:
        return " ".join(words[:max_words])

    if len(words) >= min_words:
        return " ".join(words)

    filler = (
        "Additional context from the source is limited, but this fallback summary preserves "
        "the main ideas, supporting details, and practical implications that were available "
        "from the extracted text so the reader can still understand the link without opening it."
    )
    filler_words = filler.split()
    merged = list(words)
    while len(merged) < min_words:
        merged.extend(filler_words)
    return " ".join(merged[:max_words])


def sentence_split(text: str) -> list[str]:
    normalized = " ".join(text.split())
    if not normalized:
        return []
    raw = normalized.replace("!", ".").replace("?", ".").split(".")
    return [part.strip() for part in raw if part.strip()]


def local_summary(content: ExtractedContent, error: Exception) -> SummaryResult:
    sentences = sentence_split(content.text)
    assembled: list[str] = []
    for sentence in sentences:
        assembled.append(sentence.rstrip(".") + ".")
        if count_words(" ".join(assembled)) >= min(MAX_SUMMARY_WORDS, MIN_SUMMARY_WORDS + 30):
            break

    summary = normalize_summary_length(
        " ".join(assembled) or content.text or content.title,
        MIN_SUMMARY_WORDS,
        MAX_SUMMARY_WORDS,
    )
    bullets = [(sentence.rstrip(".") + ".") for sentence in sentences[len(assembled) : len(assembled) + 4]]
    return SummaryResult(
        contentType="other",
        confidence=0.8,
        summary=summary,
        bullets=bullets,
        rationale=f"Local fallback summary generated because the selected LLM failed: {error}",
        fallbackUsed=True,
        fallbackReason=str(error),
    )


async def raindrop_fetch(path: str, token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.get(f"{RAINDROP_API_BASE}{path}", headers=headers)
    if response.status_code >= 400:
        raise HTTPException(
            status_code=500,
            detail=f"Raindrop API error {response.status_code}: {response.text}",
        )
    return response.json()


async def get_unsorted_count(token: str) -> int:
    payload = await raindrop_fetch("/raindrops/-1?page=0&perpage=1", token)
    return int(payload.get("count", 0))


async def get_collections(token: str) -> list[CollectionRecord]:
    roots_payload, children_payload, unsorted_count = await asyncio.gather(
        raindrop_fetch("/collections", token),
        raindrop_fetch("/collections/childrens", token),
        get_unsorted_count(token),
    )

    raw_collections = [
        RaindropCollection.model_validate(item)
        for item in [*roots_payload.get("items", []), *children_payload.get("items", [])]
    ]

    deduped: dict[int, RaindropCollection] = {}
    for collection in raw_collections:
        deduped[collection.id] = collection

    by_id = deduped
    options: list[CollectionRecord] = []
    for collection in deduped.values():
        parts = [collection.title]
        current_parent = collection.parent.get("$id") if collection.parent else None

        while current_parent:
            parent = by_id.get(current_parent)
            if not parent:
                break
            parts.insert(0, parent.title)
            current_parent = parent.parent.get("$id") if parent.parent else None

        options.append(
            CollectionRecord(
                id=collection.id,
                title=collection.title,
                count=collection.count or 0,
                path=" / ".join(parts),
            )
        )

    options.append(
        CollectionRecord(
            id=UNSORTED_COLLECTION_ID,
            title="Unsorted",
            count=unsorted_count,
            path="Unsorted",
        )
    )

    options.sort(key=lambda collection: collection.path.lower())
    return options


async def get_all_raindrops(collection_id: int, token: str) -> list[RaindropItem]:
    items: list[RaindropItem] = []
    page = 0
    while True:
        payload = await raindrop_fetch(f"/raindrops/{collection_id}?page={page}&perpage=50", token)
        batch = [RaindropItem.model_validate(item) for item in payload.get("items", [])]
        items.extend(batch)
        if len(batch) < 50:
            break
        page += 1
    return items


async def extract_content(url: str, fallback_title: str, fallback_text: str | None) -> ExtractedContent:
    try:
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT_SECONDS,
            follow_redirects=True,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        ) as client:
            response = await client.get(url)
        response.raise_for_status()

        html = response.text
        readable = Document(html)
        summary_html = readable.summary(html_partial=True)
        title = readable.short_title() or fallback_title

        soup = BeautifulSoup(summary_html, "html.parser")
        extracted_text = " ".join(soup.get_text(" ", strip=True).split())

        page_soup = BeautifulSoup(html, "html.parser")
        meta_description = ""
        meta_tag = page_soup.find("meta", attrs={"name": "description"})
        if meta_tag and meta_tag.get("content"):
            meta_description = str(meta_tag.get("content")).strip()

        body_text = ""
        if page_soup.body:
            body_text = " ".join(page_soup.body.get_text(" ", strip=True).split())

        final_text = extracted_text or meta_description or body_text or (fallback_text or "")
        if not final_text:
            raise ValueError("No readable text extracted")

        return ExtractedContent(
            url=url,
            title=title,
            text=final_text[:24000],
        )
    except Exception:
        return ExtractedContent(
            url=url,
            title=fallback_title,
            text=(fallback_text or fallback_title)[:12000],
        )


def build_summary_chain(model: SummaryModel) -> tuple:
    llm = build_llm(model, temperature=0.8)

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                (
                    "You classify and summarize saved reading-list links. "
                    "Use the webpage content itself to determine the type. "
                    "Return structured data only."
                ),
            ),
            (
                "human",
                (
                    "Classify the content into exactly one of: "
                    "`tech_article`, `non_tech_article`, `action_item`, or `other`.\n"
                    "Rules:\n"
                    "- Determine type from the webpage content, not heuristics.\n"
                    "- If it is an action item, write a detailed narrative summary and actionable bullets.\n"
                    f"- If it is an article, write a detailed summary between {MIN_SUMMARY_WORDS} and {MAX_SUMMARY_WORDS} words and 3 to 5 bullets.\n"
                    f"- Keep all summaries between {MIN_SUMMARY_WORDS} and {MAX_SUMMARY_WORDS} words.\n"
                    "- Keep bullets concise.\n"
                    "- Explain the decision briefly in rationale.\n\n"
                    "Title: {title}\n"
                    "URL: {url}\n"
                    "Site: {site_name}\n"
                    "Byline: {byline}\n\n"
                    "Content:\n{content}"
                ),
            ),
        ]
    )
    return prompt, llm.with_structured_output(SummaryResult)


async def expand_summary(content: ExtractedContent, summary: str, model: SummaryModel) -> str:
    llm = build_llm(model, temperature=0.75)
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "Rewrite summaries to be fuller and more detailed while preserving meaning.",
            ),
            (
                "human",
                (
                    f"Rewrite this summary as one detailed paragraph between {MIN_SUMMARY_WORDS} and {MAX_SUMMARY_WORDS} words.\n\n"
                    "Existing summary:\n{summary}\n\n"
                    "Source title: {title}\n"
                    "Source URL: {url}\n"
                    "Source content:\n{content}"
                ),
            ),
        ]
    )
    chain = prompt | llm
    response = await chain.ainvoke(
        {
            "summary": summary,
            "title": content.title,
            "url": content.url,
            "content": content.text,
        }
    )
    text = response.content if isinstance(response.content, str) else "".join(part.get("text", "") for part in response.content)
    return text.strip() or summary


async def summarize_content(content: ExtractedContent, model: SummaryModel) -> SummaryResult:
    prompt, chain = build_summary_chain(model)
    result = await (prompt | chain).ainvoke(
        {
            "title": content.title,
            "url": content.url,
            "site_name": content.siteName or "unknown",
            "byline": content.byline or "unknown",
            "content": content.text,
        }
    )

    if count_words(result.summary) < MIN_SUMMARY_WORDS:
        result.summary = await expand_summary(content, result.summary, model)
    result.summary = normalize_summary_length(
        result.summary,
        MIN_SUMMARY_WORDS,
        MAX_SUMMARY_WORDS,
    )
    return result


async def summarize_item(
    item: RaindropItem, semaphore: asyncio.Semaphore, model: SummaryModel
) -> SummarizedItem:
    async with semaphore:
        content = await extract_content(item.link, item.title, item.excerpt or item.note)
        try:
            summary = await summarize_content(content, model)
        except Exception as error:
            summary = local_summary(content, error)

        return SummarizedItem(
            id=item.id,
            title=item.title,
            url=item.link,
            domain=item.domain or httpx.URL(item.link).host or "",
            raindropType=item.type,
            summary=summary,
        )


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.get("/api/collections", response_model=CollectionResponse)
async def api_collections() -> CollectionResponse:
    collections = await get_collections(get_raindrop_token())
    return CollectionResponse(collections=collections)


@app.post("/api/summarize", response_model=SummaryResponse)
async def api_summarize(payload: SummarizeRequest) -> SummaryResponse:
    model = resolve_summary_model(payload.model)
    raindrops = await get_all_raindrops(payload.collectionId, get_raindrop_token())
    link_items = [item for item in raindrops if item.link][: payload.maxItems]
    concurrency = max(1, min(MAX_CONCURRENCY, int(os.getenv("SUMMARIZE_CONCURRENCY", "2"))))
    semaphore = asyncio.Semaphore(concurrency)
    items = await asyncio.gather(
        *(summarize_item(item, semaphore, model) for item in link_items)
    )

    order = {"action_item": 0, "tech_article": 1, "non_tech_article": 2, "other": 3}
    items.sort(key=lambda item: order.get(item.summary.contentType, 99))
    return SummaryResponse(total=len(items), items=items)
