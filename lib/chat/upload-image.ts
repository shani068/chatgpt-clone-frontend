import { IMAGES_API } from "@/constants/routes";
import { api } from "@/lib/api";
import type { ApiEnvelope } from "@/types/api";

/** Uploads an image for the vision model and resolves with the backend imageId. */
export async function uploadImage(
  file: File,
  onProgress: (progress: number) => void,
): Promise<string> {
  const res = await api.postForm<ApiEnvelope<{ imageId: string }>>(
    IMAGES_API,
    { file },
    { onUploadProgress: (event) => onProgress(Math.round((event.progress ?? 0) * 100)) },
  );
  return res.data.data.imageId;
}
