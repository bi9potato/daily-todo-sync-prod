import AsyncStorage from "@react-native-async-storage/async-storage";

import { searchPlaces } from "./api";
import type { PlaceSearchResult } from "@/types";

const CACHE_KEY = "daily-todo-sync.nominatim-place-search.v1";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 50;
const MIN_REQUEST_INTERVAL_MS = 1_100;

type CacheEntry = {
  cachedAt: number;
  results: PlaceSearchResult[];
};

type SearchCache = Record<string, CacheEntry>;

let memoryCache: SearchCache | null = null;
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function normalizedQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

async function readCache() {
  if (memoryCache) {
    return memoryCache;
  }
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as SearchCache) : {};
    memoryCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function writeCache(query: string, results: PlaceSearchResult[]) {
  const cache = await readCache();
  cache[query] = { cachedAt: Date.now(), results };
  const trimmed = Object.fromEntries(
    Object.entries(cache)
      .sort((left, right) => right[1].cachedAt - left[1].cachedAt)
      .slice(0, MAX_CACHE_ENTRIES),
  );
  memoryCache = trimmed;
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(trimmed)).catch(
    () => undefined,
  );
}

function runRateLimited<T>(operation: () => Promise<T>) {
  const run = requestQueue.then(async () => {
    const waitMs = Math.max(
      0,
      MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt),
    );
    if (waitMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();
    return operation();
  });
  requestQueue = run.catch(() => undefined);
  return run;
}

export async function searchNominatimPlaces(
  value: string,
): Promise<PlaceSearchResult[]> {
  const query = normalizedQuery(value);
  if (!query) {
    return [];
  }

  const cache = await readCache();
  const cached = cache[query];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.results;
  }

  return runRateLimited(async () => {
    const results = await searchPlaces(value.trim());
    await writeCache(query, results);
    return results;
  });
}
