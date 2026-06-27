import { getAuthenticatedMediaBlob } from "./api";

type CachedMediaSource = {
  uri: string;
};

const mediaDownloads = new Map<string, Promise<CachedMediaSource>>();

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

async function downloadAuthenticatedMedia(contentUrl: string) {
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
