export async function readApiJson<T>(response: Response, label: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const looksJson = isJsonContentType(contentType) || /^[\s]*[\[{]/.test(text);

  if (!looksJson) {
    const preview = previewResponseText(text);
    const suffix = preview ? `: ${preview}` : contentType ? ` (${contentType})` : "";
    throw new Error(
      response.ok
        ? `${label} returned a non-JSON response${suffix}`
        : `${label} failed with HTTP ${response.status}${suffix}`
    );
  }

  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const preview = previewResponseText(text);
    throw new Error(`${label} returned invalid JSON${preview ? `: ${preview}` : ""}`);
  }

  if (!response.ok) {
    const error = errorFromPayload(payload);
    throw new Error(error ?? `${label} failed with HTTP ${response.status}`);
  }

  return payload as T;
}

function errorFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : null;
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

function previewResponseText(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}
