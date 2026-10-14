import { DOCUMENTS_API } from "@/constants/routes";
import { api } from "@/lib/api";
import type { ApiEnvelope } from "@/types/api";

/** Uploads a PDF for indexing and resolves with the backend documentId. */
export async function uploadDocument(
  file: File,
  onProgress: (progress: number) => void,
): Promise<string> {
  const res = await api.postForm<ApiEnvelope<{ documentId: string }>>(
    DOCUMENTS_API,
    { file },
    { onUploadProgress: (event) => onProgress(Math.round((event.progress ?? 0) * 100)) },
  );
  return res.data.data.documentId;
}
