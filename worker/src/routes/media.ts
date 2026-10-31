import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { newId } from '../lib/id';

const media = new Hono<{ Bindings: Env; Variables: Variables }>();

function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

// POST /media/upload — multipart/form-data with a "file" field.
// Replaces supabase.storage.from('chat-media').upload(...)
media.post('/upload', requireAuth, async (c) => {
  const userId = c.get('userId');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'file is required (multipart/form-data)' }, 400);

  const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
  const key = `${userId}/${newId()}${ext ? `.${ext}` : ''}`;

  await c.env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  const id = newId();
  const media_type = mediaTypeFromMime(file.type || '');
  await c.env.DB.prepare(
    `INSERT INTO media_attachments (id, uploader_id, file_path, file_name, file_size, mime_type, media_type)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, key, file.name, file.size, file.type, media_type)
    .run();

  const url = `${c.env.PUBLIC_API_URL}/media/file/${key}`;
  return c.json({ id, url, key, media_type, file_name: file.name, file_size: file.size }, 201);
});

// GET /media/file/:key — public read (replaces a public Supabase Storage bucket).
// If you need private media, add requireAuth + an ownership check here instead.
media.get('/file/*', async (c) => {
  const key = c.req.path.replace(/^\/media\/file\//, '');
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: 'Not found' }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
});

media.delete('/file/*', requireAuth, async (c) => {
  const userId = c.get('userId');
  const key = c.req.path.replace(/^\/media\/file\//, '');
  const owned = await c.env.DB.prepare('SELECT id FROM media_attachments WHERE file_path = ? AND uploader_id = ?')
    .bind(key, userId)
    .first();
  if (!owned) return c.json({ error: 'Not found' }, 404);
  await c.env.MEDIA.delete(key);
  await c.env.DB.prepare('DELETE FROM media_attachments WHERE file_path = ?').bind(key).run();
  return c.json({ success: true });
});

export default media;
