const MAX_ATTACHMENT_CHARS = 3500;
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json']);

export interface TextAttachment {
  name: string;
  content: string;
}

function extension(name: string): string {
  return name.toLowerCase().split('.').pop() ?? '';
}

export function normalizeTextAttachment(name: unknown, content: unknown): TextAttachment | null {
  if (typeof name !== 'string' || typeof content !== 'string') return null;
  const trimmedName = name.trim().replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 96);
  const trimmedContent = content.trim();
  if (!trimmedName || !ALLOWED_ATTACHMENT_EXTENSIONS.has(extension(trimmedName)) || !trimmedContent) return null;
  if (trimmedContent.length > MAX_ATTACHMENT_CHARS) return null;
  return { name: trimmedName, content: trimmedContent };
}

export const MAX_TEXT_ATTACHMENT_CHARS = MAX_ATTACHMENT_CHARS;
