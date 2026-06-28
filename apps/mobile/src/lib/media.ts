import * as FileSystem from "expo-file-system/legacy";

import {
  getAuthenticatedMediaBlob,
  getAuthenticatedMediaSource,
} from "./api";

type CachedMediaSource = {
  uri: string;
  headers?: Record<string, string>;
};

const mediaDownloads = new Map<string, Promise<CachedMediaSource>>();
const mediaCacheDirectory = `${FileSystem.cacheDirectory ?? ""}task-attachments/`;
let mediaCacheDirectoryPromise: Promise<void> | null = null;

function blobToDataUri(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片数据读取失败。"));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("图片数据格式无效。"));
    reader.readAsDataURL(blob);
  });
}

function cacheKeyForUrl(contentUrl: string) {
  let hash = 0;
  for (let index = 0; index < contentUrl.length; index += 1) {
    hash = (hash * 31 + contentUrl.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(16)}.jpg`;
}

async function ensureMediaCacheDirectory() {
  if (!FileSystem.cacheDirectory) {
    throw new Error("图片缓存目录不可用。");
  }
  mediaCacheDirectoryPromise ??= FileSystem.makeDirectoryAsync(mediaCacheDirectory, {
    intermediates: true,
  });
  await mediaCacheDirectoryPromise;
}

async function downloadToFile(contentUrl: string) {
  await ensureMediaCacheDirectory();
  const fileUri = `${mediaCacheDirectory}${cacheKeyForUrl(contentUrl)}`;
  const existing = await FileSystem.getInfoAsync(fileUri);
  if (existing.exists) {
    return { uri: fileUri };
  }

  let source = await getAuthenticatedMediaSource(contentUrl);
  let result = await FileSystem.downloadAsync(source.uri, fileUri, {
    cache: true,
    headers: source.headers,
  });

  if (result.status === 401) {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
    await getAuthenticatedMediaBlob(contentUrl);
    source = await getAuthenticatedMediaSource(contentUrl);
    result = await FileSystem.downloadAsync(source.uri, fileUri, {
      cache: true,
      headers: source.headers,
    });
  }

  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
    throw new Error(`图片下载失败（${result.status}）。`);
  }

  return { uri: result.uri };
}

async function downloadAuthenticatedMedia(contentUrl: string) {
  try {
    return await downloadToFile(contentUrl);
  } catch {
    try {
      return await getCachedAuthenticatedMediaDataUri(contentUrl);
    } catch {
      return getAuthenticatedMediaSource(contentUrl);
    }
  }
}

export async function getCachedAuthenticatedMediaDataUri(contentUrl: string) {
  return { uri: await blobToDataUri(await getAuthenticatedMediaBlob(contentUrl)) };
}

export function getCachedAuthenticatedMediaUri(contentUrl: string) {
  const existing = mediaDownloads.get(contentUrl);
  if (existing) {
    return existing;
  }

  const download = downloadAuthenticatedMedia(contentUrl).catch((error) => {
    mediaDownloads.delete(contentUrl);
    throw error;
  });
  mediaDownloads.set(contentUrl, download);
  return download;
}
