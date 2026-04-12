/** Upload a reference image to local storage via /api/upload */
export async function uploadReferenceImage(file: File, name: string, tags: string[]) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('tags', JSON.stringify(tags));

    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error ?? 'Upload failed');
    }

    const data = await res.json() as { id: string; name: string; url: string; tags: string[] };
    return { success: true, id: data.id, name: data.name, url: data.url, tags: data.tags };
  } catch (err) {
    console.error('[uploadAsset]', err);
    return { success: false };
  }
}
