# MagicQC — Complete API Integration Guide

> **For:** Desktop / Electron App Developers  
> **Version:** 1.0 — February 2026  
> **Server:** `https://magicqc.online`

---

## Quick Start

```bash
# 1. Test connection (no auth needed)
curl https://magicqc.online/api/camera/ping

# 2. Test with API key
curl -H "X-API-Key: YOUR_KEY_HERE" https://magicqc.online/api/camera/ping

# 3. Fetch all articles
curl -H "X-API-Key: YOUR_KEY_HERE" https://magicqc.online/api/camera/articles
```

---

## 1. Base URL & Configuration

| Setting | Value |
|---------|-------|
| **Base URL** | `https://magicqc.online` |
| **Protocol** | HTTPS (TLS) |
| **Content-Type** | `application/json` |
| **CORS** | Fully open — all origins allowed (`*`) |

### Connection Example (TypeScript)

```typescript
const API_BASE = 'https://magicqc.online';
const API_KEY  = 'YOUR_API_KEY_HERE'; // Provided by MagicQC admin

// Standard request helper
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return response.json();
}
```

---

## 2. Authentication

### API Key Header

Most endpoints require an API key sent via the `X-API-Key` HTTP header.

| Header | Value |
|--------|-------|
| `X-API-Key` | Your 64-character API key |

**Unauthenticated Response (401):**
```json
{
  "success": false,
  "message": "Invalid or missing API key."
}
```

> **Note:** The `uploaded-annotations` endpoints do **NOT** require an API key (for backward compatibility with existing Electron apps). The `camera` and `annotations` endpoints **DO** require it.

### Getting Your API Key

Ask the MagicQC administrator to generate a key. Keys are managed in the database and can be created via the Laravel console:

```bash
php artisan tinker
>>> App\Models\ApiKey::createWithKey('electron-app')->key
# Returns: "aB3d...64chars...xYz"
```

---

## 3. API Endpoints — Full Reference

### 3.1 Camera APIs

All camera endpoints require `X-API-Key` header.
Prefix: `/api/camera`

---

#### `GET /api/camera/ping`

Test API connectivity. Works with or without an API key.

**Response:**
```json
{
  "success": true,
  "message": "API connection successful!",
  "authenticated": true,
  "server_time": "2026-02-17T16:00:00.000000Z"
}
```

---

#### `GET /api/camera/articles`

Get all registered articles (garment styles).

**Headers:** `X-API-Key: YOUR_KEY`

**Response:**
```json
{
  "success": true,
  "articles": [
    {
      "id": 1,
      "article_style": "ABC123",
      "brand_name": "Brand X",
      "description": "Men's T-Shirt"
    },
    {
      "id": 2,
      "article_style": "DEF456",
      "brand_name": "Brand Y",
      "description": "Women's Dress"
    }
  ]
}
```

---

#### `GET /api/camera/articles/{articleId}/images`

Get all captured images for a specific article.

**Headers:** `X-API-Key: YOUR_KEY`

**Response:**
```json
{
  "success": true,
  "article": {
    "id": 1,
    "article_style": "ABC123"
  },
  "images": [
    {
      "id": 10,
      "size": "M",
      "image_path": "article-images/1/camera_20260217_120000_abcd1234.jpg",
      "image_url": "https://magicqc.online/storage/article-images/1/camera_20260217_120000_abcd1234.jpg",
      "image_name": "capture.jpg",
      "created_at": "2026-02-17T12:00:00.000000Z"
    }
  ]
}
```

---

#### `POST /api/camera/upload`

Upload a captured image.

**Headers:** `X-API-Key: YOUR_KEY`  
**Content-Type:** `multipart/form-data`

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `article_id` | int | ✅ | ID of the article |
| `size` | string | ✅ | Size: `S`, `M`, `L`, `XL`, `XXL` |
| `image` | file | ✅ | Image file (max 20MB) |

**Response (201):**
```json
{
  "success": true,
  "message": "Image uploaded successfully from camera.",
  "image": {
    "id": 11,
    "article_id": 1,
    "article_style": "ABC123",
    "size": "M",
    "image_path": "article-images/1/camera_20260217_120500_efgh5678.jpg",
    "image_url": "https://magicqc.online/storage/article-images/1/camera_20260217_120500_efgh5678.jpg",
    "created_at": "2026-02-17T12:05:00.000000Z"
  }
}
```

**TypeScript Example:**
```typescript
async function uploadImage(articleId: number, size: string, imageFile: File | Buffer) {
  const formData = new FormData();
  formData.append('article_id', articleId.toString());
  formData.append('size', size);
  formData.append('image', imageFile);

  const response = await fetch(`${API_BASE}/api/camera/upload`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },
    body: formData,
  });
  return response.json();
}
```

---

#### `DELETE /api/camera/images/{imageId}`

Delete a specific image.

**Headers:** `X-API-Key: YOUR_KEY`

**Response:**
```json
{
  "success": true,
  "message": "Image deleted successfully."
}
```

---

### 3.2 Annotations APIs (Camera-Captured)

Annotations created from camera capture and in-browser annotation.
Prefix: `/api/annotations`
All endpoints require `X-API-Key` header.

---

#### `GET /api/annotations`

List all camera-captured annotations.

**Response:**
```json
{
  "success": true,
  "annotations": [
    {
      "id": 1,
      "article_style": "ABC123",
      "size": "M",
      "name": "Annotation for ABC123 - M",
      "reference_image_path": "annotations/ABC123/ABC123_M.jpg",
      "json_file_path": "annotations/ABC123/ABC123_M.json",
      "created_at": "2026-02-17T10:00:00.000000Z",
      "updated_at": "2026-02-17T10:00:00.000000Z"
    }
  ],
  "total": 1
}
```

---

#### `GET /api/annotations/{articleStyle}/{size}`

Get a specific annotation by article style and size.

**Response:**
```json
{
  "success": true,
  "annotation": {
    "id": 1,
    "article_style": "ABC123",
    "size": "M",
    "name": "Annotation for ABC123 - M",
    "annotations": { ... },
    "reference_image_path": "annotations/ABC123/ABC123_M.jpg",
    "json_file_path": "annotations/ABC123/ABC123_M.json",
    "created_at": "2026-02-17T10:00:00.000000Z",
    "updated_at": "2026-02-17T10:00:00.000000Z"
  }
}
```

---

#### `POST /api/annotations/sync`

Sync annotation data from an external script (e.g., Python) to the database.

**Headers:** `X-API-Key: YOUR_KEY`  
**Content-Type:** `application/json`

**Body:**
```json
{
  "article_style": "ABC123",
  "size": "M",
  "name": "Front panel annotation",
  "annotations": {
    "keypoints": [...],
    "target_distances": {...}
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Annotation synced successfully.",
  "annotation": {
    "id": 1,
    "article_style": "ABC123",
    "size": "M",
    "json_file_path": "annotations/ABC123/ABC123_M.json",
    "reference_image_path": "annotations/ABC123/ABC123_M.jpg"
  }
}
```

---

### 3.3 Uploaded Annotations APIs (Admin-Curated)

These are manually uploaded reference annotations with images.  
**⚠️ No API key required** for these endpoints.

Prefix: `/api/uploaded-annotations`

---

#### `GET /api/uploaded-annotations`

List all uploaded annotations.

**Response:**
```json
{
  "success": true,
  "annotations": [
    {
      "id": 1,
      "article_style": "ABC123",
      "size": "M",
      "side": "front",
      "color": "red",
      "name": "Front panel",
      "annotation_data": {
        "keypoints": [
          { "x": 100, "y": 200, "label": "Point 1" }
        ],
        "target_distances": { "0-1": 45.5 },
        "placement_box": { "x": 50, "y": 50, "width": 400, "height": 600 }
      },
      "reference_image_url": "/api/uploaded-annotations/ABC123/M/front/image",
      "image_width": 1920,
      "image_height": 1080,
      "annotation_date": "2026-01-15T10:30:00Z",
      "created_at": "2026-01-15T10:30:00Z",
      "updated_at": "2026-01-15T10:30:00Z"
    }
  ]
}
```

---

#### `GET /api/uploaded-annotations/{articleStyle}/{size}/{side}`

Get a single annotation. `side` is optional (defaults to `front`).

**Optional Query Params:** `?color=red`

**Response:**
```json
{
  "success": true,
  "annotation": {
    "id": 1,
    "article_style": "ABC123",
    "size": "M",
    "side": "front",
    "color": "red",
    "color_suffix": "_red",
    "standardized_name": "ABC123_M_front_red",
    "name": "Front panel",
    "annotation_data": {
      "keypoints": [...],
      "target_distances": {...},
      "placement_box": {...}
    },
    "reference_image_url": "/api/uploaded-annotations/ABC123/M/front/image",
    "image_width": 1920,
    "image_height": 1080,
    "annotation_date": "2026-01-15T10:30:00Z",
    "created_at": "2026-01-15T10:30:00Z",
    "updated_at": "2026-01-15T10:30:00Z"
  }
}
```

---

#### `GET /api/uploaded-annotations/{articleStyle}/{size}/{side}/image`

Get the reference image as a binary file.

**Optional Query Params:** `?color=red`  
**Returns:** Binary image (`Content-Type: image/jpeg`)

```typescript
// Display directly in an <img> tag
<img src={`${API_BASE}/api/uploaded-annotations/ABC123/M/front/image`} />
```

---

#### `GET /api/uploaded-annotations/{articleStyle}/{size}/{side}/image-base64`

Get the reference image as base64 JSON.

**Response:**
```json
{
  "success": true,
  "image": {
    "data": "/9j/4AAQSkZJRg...",
    "mime_type": "image/jpeg",
    "data_url": "data:image/jpeg;base64,/9j/4AAQ...",
    "width": 1920,
    "height": 1080
  }
}
```

---

#### `GET /api/uploaded-annotations/fetch-image-base64`

Same as above but uses **query parameters** (avoids URL encoding issues with slashes in size values).

**Query Params:** `?article_style=ABC123&size=M&side=front`

---

#### `GET /api/uploaded-annotations/operator-fetch` ⭐ (Recommended)

**The primary endpoint for the Operator Panel.** Returns both annotation data AND reference image in a single request.

**Query Params:**

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `article_style` | ✅ | — | Article style code |
| `size` | ✅ | — | Size designation |
| `side` | ❌ | `front` | `front` or `back` |
| `color` | ❌ | — | Color variant |

**Fetch Priority:**
1. **Uploaded annotations** (manually curated, highest quality)
2. **Article annotations** (camera-captured, fallback)

**Response:**
```json
{
  "success": true,
  "source": "uploaded_annotation",
  "annotation": {
    "id": 1,
    "article_style": "ABC123",
    "size": "M",
    "side": "front",
    "color": "red",
    "color_suffix": "_red",
    "standardized_name": "ABC123_M_front_red",
    "name": "Front panel",
    "annotation_data": {
      "keypoints": [
        { "x": 100, "y": 200, "label": "Shoulder Left" },
        { "x": 300, "y": 200, "label": "Shoulder Right" }
      ],
      "target_distances": {
        "0-1": 45.5,
        "1-2": 32.0
      },
      "placement_box": {
        "x": 50, "y": 50, "width": 400, "height": 600
      }
    },
    "image_width": 1920,
    "image_height": 1080,
    "annotation_date": "2026-01-15T10:30:00Z"
  },
  "reference_image": {
    "data": "/9j/4AAQSkZJRg...",
    "mime_type": "image/jpeg",
    "data_url": "data:image/jpeg;base64,/9j/4AAQ...",
    "width": 1920,
    "height": 1080
  }
}
```

---

## 4. Complete TypeScript Integration Module

Copy this into your Electron app as `api/magicqc.ts`:

```typescript
// ============================================================
// MagicQC API Client for Electron
// ============================================================

const API_BASE = 'https://magicqc.online';
const API_KEY  = 'YOUR_API_KEY_HERE';

// ---------- Types ----------

interface Article {
  id: number;
  article_style: string;
  brand_name: string;
  description: string;
}

interface Keypoint {
  x: number;
  y: number;
  label: string;
}

interface AnnotationData {
  keypoints: Keypoint[];
  target_distances: Record<string, number>;
  placement_box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface Annotation {
  id: number;
  article_style: string;
  size: string;
  side: string;
  color: string | null;
  color_suffix: string | null;
  standardized_name: string;
  name: string;
  annotation_data: AnnotationData;
  image_width: number;
  image_height: number;
  annotation_date: string | null;
  created_at: string;
  updated_at: string;
}

interface ReferenceImage {
  data: string;        // base64 string
  mime_type: string;
  data_url: string;    // ready-to-use "data:image/jpeg;base64,..."
  width: number;
  height: number;
}

interface OperatorFetchResult {
  success: boolean;
  source: 'uploaded_annotation' | 'article_annotation';
  annotation: Annotation;
  reference_image: ReferenceImage | null;
}

interface ArticleImage {
  id: number;
  size: string;
  image_path: string;
  image_url: string;
  image_name: string;
  created_at: string;
}

// ---------- API Client ----------

class MagicQCClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string = API_BASE, apiKey: string = API_KEY) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ------ Connection ------

  async ping(): Promise<{ success: boolean; authenticated: boolean; server_time: string }> {
    return this.request('/api/camera/ping');
  }

  // ------ Articles ------

  async getArticles(): Promise<Article[]> {
    const data = await this.request('/api/camera/articles');
    return data.articles;
  }

  async getArticleImages(articleId: number): Promise<ArticleImage[]> {
    const data = await this.request(`/api/camera/articles/${articleId}/images`);
    return data.images;
  }

  // ------ Image Upload ------

  async uploadImage(articleId: number, size: string, imageFile: File | Blob): Promise<any> {
    const formData = new FormData();
    formData.append('article_id', articleId.toString());
    formData.append('size', size);
    formData.append('image', imageFile);

    return this.request('/api/camera/upload', {
      method: 'POST',
      body: formData,
      headers: { 'X-API-Key': this.apiKey },  // Don't set Content-Type, let browser handle it
    });
  }

  async deleteImage(imageId: number): Promise<void> {
    await this.request(`/api/camera/images/${imageId}`, { method: 'DELETE' });
  }

  // ------ Annotations (Camera-Captured) ------

  async listAnnotations(): Promise<any[]> {
    const data = await this.request('/api/annotations');
    return data.annotations;
  }

  async getAnnotation(articleStyle: string, size: string): Promise<any | null> {
    const data = await this.request(
      `/api/annotations/${encodeURIComponent(articleStyle)}/${encodeURIComponent(size)}`
    );
    return data.annotation;
  }

  async syncAnnotation(articleStyle: string, size: string, annotations: any, name?: string): Promise<any> {
    return this.request('/api/annotations/sync', {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ article_style: articleStyle, size, annotations, name }),
    });
  }

  // ------ Uploaded Annotations (Admin-Curated) ------
  // NOTE: These endpoints do NOT require API key

  async getUploadedAnnotations(): Promise<Annotation[]> {
    const data = await this.request('/api/uploaded-annotations');
    return data.annotations;
  }

  async getUploadedAnnotation(
    articleStyle: string,
    size: string,
    side: string = 'front',
    color?: string
  ): Promise<Annotation | null> {
    let url = `/api/uploaded-annotations/${encodeURIComponent(articleStyle)}/${encodeURIComponent(size)}/${side}`;
    if (color) url += `?color=${encodeURIComponent(color)}`;

    const data = await this.request(url);
    return data.annotation;
  }

  async getImageBase64(
    articleStyle: string,
    size: string,
    side: string = 'front'
  ): Promise<ReferenceImage | null> {
    const data = await this.request(
      `/api/uploaded-annotations/fetch-image-base64?article_style=${encodeURIComponent(articleStyle)}&size=${encodeURIComponent(size)}&side=${side}`
    );
    return data.image;
  }

  /**
   * ⭐ RECOMMENDED — Single call to get annotation + reference image.
   * Uses smart priority: uploaded_annotations > article_annotations.
   */
  async operatorFetch(
    articleStyle: string,
    size: string,
    side: string = 'front',
    color?: string
  ): Promise<OperatorFetchResult> {
    const params = new URLSearchParams({ article_style: articleStyle, size, side });
    if (color) params.append('color', color);
    return this.request(`/api/uploaded-annotations/operator-fetch?${params}`);
  }
}

// ------ Export ------

export const magicQC = new MagicQCClient();
export { MagicQCClient };
export type { Article, Annotation, AnnotationData, Keypoint, ReferenceImage, OperatorFetchResult, ArticleImage };
```

---

## 5. Usage Examples

### Test Connection

```typescript
import { magicQC } from './api/magicqc';

const status = await magicQC.ping();
console.log('Connected:', status.success);
console.log('Authenticated:', status.authenticated);
```

### Load Annotation for QC Measurement

```typescript
// ⭐ Best approach — single request, gets everything
const result = await magicQC.operatorFetch('ABC123', 'M', 'front', 'red');

if (result.success) {
  console.log('Source:', result.source);  // "uploaded_annotation" or "article_annotation"

  // Annotation data
  const keypoints = result.annotation.annotation_data.keypoints;
  const distances = result.annotation.annotation_data.target_distances;
  const box = result.annotation.annotation_data.placement_box;

  // Display reference image
  if (result.reference_image) {
    const imgElement = document.getElementById('reference-img') as HTMLImageElement;
    imgElement.src = result.reference_image.data_url;  // "data:image/jpeg;base64,..."
  }
}
```

### Upload a Camera Capture

```typescript
// From file input
const fileInput = document.getElementById('camera-file') as HTMLInputElement;
const file = fileInput.files[0];

const result = await magicQC.uploadImage(1, 'M', file);
console.log('Uploaded:', result.image.image_url);
```

### List All Articles and Their Images

```typescript
const articles = await magicQC.getArticles();
for (const article of articles) {
  console.log(`${article.article_style} — ${article.brand_name}`);
  const images = await magicQC.getArticleImages(article.id);
  console.log(`  Images: ${images.length}`);
}
```

---

## 6. Error Handling

All endpoints return consistent error responses:

| HTTP Status | Meaning | Example |
|-------------|---------|---------|
| `200` | Success | Normal response |
| `201` | Created | Image uploaded successfully |
| `400` | Bad Request | Missing required parameters |
| `401` | Unauthorized | Invalid or missing API key |
| `404` | Not Found | Annotation/image doesn't exist |
| `422` | Validation Error | Invalid field values |
| `500` | Server Error | Internal server error |

**Error response format:**
```json
{
  "success": false,
  "message": "Description of the error"
}
```

**Robust error handling example:**
```typescript
try {
  const result = await magicQC.operatorFetch('ABC123', 'M');
  if (!result.success) {
    console.error('API error:', result.message);
    return;
  }
  // Use result...
} catch (error) {
  if (error.message.includes('401')) {
    console.error('Invalid API key — contact admin for a new key');
  } else if (error.message.includes('Failed to fetch')) {
    console.error('Server unreachable — check internet connection');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

---

## 7. Endpoint Summary Table

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/camera/ping` | Optional | Test connection |
| `GET` | `/api/camera/articles` | ✅ Key | List all articles |
| `GET` | `/api/camera/articles/{id}/images` | ✅ Key | Get article images |
| `POST` | `/api/camera/upload` | ✅ Key | Upload camera image |
| `DELETE` | `/api/camera/images/{id}` | ✅ Key | Delete an image |
| `GET` | `/api/annotations` | ✅ Key | List camera annotations |
| `GET` | `/api/annotations/{style}/{size}` | ✅ Key | Get annotation |
| `POST` | `/api/annotations/sync` | ✅ Key | Sync annotation from script |
| `GET` | `/api/uploaded-annotations` | ❌ None | List uploaded annotations |
| `GET` | `/api/uploaded-annotations/{style}/{size}/{side}` | ❌ None | Get single annotation |
| `GET` | `/api/uploaded-annotations/{style}/{size}/{side}/image` | ❌ None | Get reference image (file) |
| `GET` | `/api/uploaded-annotations/{style}/{size}/{side}/image-base64` | ❌ None | Get image (base64) |
| `GET` | `/api/uploaded-annotations/fetch-image-base64` | ❌ None | Get image via query params |
| `GET` | `/api/uploaded-annotations/operator-fetch` | ❌ None | ⭐ Get annotation + image |

---

## 8. Notes & Best Practices

1. **CORS is fully open** — the Electron app can call any endpoint without restrictions.
2. **Use `operator-fetch`** as the primary endpoint for the measurement operator panel — it resolves the correct annotation with the right priority in a single request.
3. **Use `fetch-image-base64`** (query params) instead of the path-based image endpoint if your size values contain slashes (e.g., `1/2`).
4. **Images are cached** — the image endpoints return `Cache-Control: public, max-age=31536000`. Your app can cache reference images locally.
5. **File size limits**: Camera images max 20MB, annotation JSON max 10MB, uploaded annotation images max 50MB.
6. **All timestamps** are in ISO 8601 format (UTC).
7. **The API key** is a 64-character random string. Keep it secret and do not commit it to source control. Use environment variables:
   ```typescript
   const API_KEY = process.env.MAGICQC_API_KEY;
   ```

---

## 9. Troubleshooting

| Problem | Solution |
|---------|----------|
| `Failed to fetch` | Check internet connection and that `https://magicqc.online` is reachable |
| `401 Unauthorized` | Verify your API key is correct. Contact admin for a new key |
| `404 Not Found` | The article/annotation doesn't exist. Check style and size values |
| `CORS error in browser` | This shouldn't happen (CORS is open). Check if you're hitting the right URL |
| `SSL certificate error` | Ensure you're using `https://` not `http://` |
| `Empty reference image` | The annotation has no uploaded image yet. Ask admin to upload via dashboard |
| `Timeout on image endpoints` | Large images may take time. Consider using base64 endpoints and caching locally |
