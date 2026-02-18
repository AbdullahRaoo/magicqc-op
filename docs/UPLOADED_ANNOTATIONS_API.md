# Uploaded Annotations API Documentation

This document describes how to integrate your Electron app with the Uploaded Annotations API to fetch pre-configured annotations and reference images.

## Overview

The Uploaded Annotations system allows administrators to upload annotation JSON files and reference images through the web dashboard. These can then be fetched by Electron applications via the API endpoints.

Annotations are linked to Articles in the system and are uniquely identified by the combination of `article_id` + `size`.

## Base URL

```
http://your-server-ip:port
```

## API Endpoints

### 1. List All Annotations

**Endpoint:** `GET /api/uploaded-annotations`

**Description:** Returns a list of all uploaded annotations with metadata.

**Response:**
```json
{
  "success": true,
  "annotations": [
    {
      "id": 1,
      "article_id": 5,
      "article_style": "ABC123",
      "brand_name": "Brand X",
      "size": "M",
      "name": "Front panel annotation",
      "annotation_data": {
        "keypoints": [
          { "x": 100, "y": 200, "label": "Point 1" },
          { "x": 150, "y": 250, "label": "Point 2" }
        ],
        "target_distances": {
          "0-1": 45.5,
          "1-2": 32.0
        },
        "placement_box": {
          "x": 50,
          "y": 50,
          "width": 400,
          "height": 600
        }
      },
      "reference_image_url": "/api/uploaded-annotations/ABC123/M/image",
      "image_width": 1920,
      "image_height": 1080,
      "annotation_date": "2024-01-15T10:30:00Z",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### 2. Get Single Annotation

**Endpoint:** `GET /api/uploaded-annotations/{articleStyle}/{size}`

**Description:** Returns a single annotation with full data including keypoints, target distances, and placement box.

**Parameters:**
- `articleStyle` (path) - The article style code (e.g., "ABC123")
- `size` (path) - The size (e.g., "M", "L", "XL", "42")

**Response:**
```json
{
  "success": true,
  "annotation": {
    "id": 1,
    "article_id": 5,
    "article_style": "ABC123",
    "brand_name": "Brand X",
    "size": "M",
    "name": "Front panel annotation",
    "annotation_data": {
      "keypoints": [
        { "x": 100, "y": 200, "label": "Point 1" },
        { "x": 150, "y": 250, "label": "Point 2" },
        { "x": 200, "y": 300, "label": "Point 3" }
      ],
      "target_distances": {
        "0-1": 45.5,
        "1-2": 32.0,
        "2-3": 28.5
      },
      "placement_box": {
        "x": 50,
        "y": 50,
        "width": 400,
        "height": 600
      }
    },
    "reference_image_url": "/api/uploaded-annotations/ABC123/M/image",
    "image_width": 1920,
    "image_height": 1080,
    "annotation_date": "2024-01-15T10:30:00Z",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Annotation not found."
}
```

---

### 3. Get Reference Image (File)

**Endpoint:** `GET /api/uploaded-annotations/{articleStyle}/{size}/image`

**Description:** Returns the reference image as a binary file with appropriate content-type headers.

**Parameters:**
- `articleStyle` (path) - The article style code
- `size` (path) - The size

**Response:** Binary image data with headers:
- `Content-Type`: image/jpeg, image/png, etc.
- `Content-Disposition`: inline; filename="ABC123_M.jpg"

**Use Case:** Use this endpoint when you want to display the image directly in an `<img>` tag or download it.

```typescript
// Example: Display in img element
const imageUrl = `${API_BASE}/api/uploaded-annotations/ABC123/M/image`;
<img src={imageUrl} alt="Reference" />
```

---

### 4. Get Reference Image (Base64)

**Endpoint:** `GET /api/uploaded-annotations/{articleStyle}/{size}/image-base64`

**Description:** Returns the reference image as a base64 encoded string, useful when you can't make direct HTTP requests for images.

**Response:**
```json
{
  "success": true,
  "image": {
    "data": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...",
    "mime_type": "image/jpeg",
    "width": 1920,
    "height": 1080,
    "filename": "ABC123_M.jpg"
  }
}
```

**Use Case:** Use this endpoint when loading images in contexts where direct HTTP image loading isn't available.

```typescript
// Example: Use base64 data
const response = await fetch(`${API_BASE}/api/uploaded-annotations/ABC123/M/image-base64`);
const data = await response.json();
<img src={data.image.data} alt="Reference" />
```

---

## Database Schema

The `uploaded_annotations` table stores all uploaded annotation data:

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigint | Primary key |
| `article_id` | bigint | Foreign key to `articles` table (nullable, indexed) |
| `article_style` | string | Article style code (indexed, denormalized for API convenience) |
| `size` | string | Size designation (indexed) |
| `name` | string | Optional descriptive name |
| `annotation_data` | JSON | Full annotation JSON (keypoints, target_distances, placement_box, etc.) |
| `reference_image_path` | string | Path to stored image |
| `reference_image_filename` | string | Original filename |
| `reference_image_mime_type` | string | MIME type (image/jpeg, etc.) |
| `reference_image_size` | int | File size in bytes |
| `image_width` | int | Image width in pixels |
| `image_height` | int | Image height in pixels |
| `original_json_filename` | string | Original JSON filename |
| `api_image_url` | string | Generated API URL for image |
| `upload_source` | string | 'manual' for admin uploads |
| `annotation_date` | timestamp | Date from JSON or upload date |
| `created_at` | timestamp | Record creation time |
| `updated_at` | timestamp | Last update time |

**Relationships:**
- `article_id` → `articles.id` (foreign key, nullOnDelete)

**Unique Constraint:** `article_id` + `size` combination must be unique.

---

## Electron Integration Example

### TypeScript/JavaScript

```typescript
const API_BASE = 'http://192.168.1.100:8000'; // Your server URL

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
  article_id: number;
  article_style: string;
  brand_name: string | null;
  size: string;
  name: string;
  annotation_data: AnnotationData;
  reference_image_url: string;
  image_width: number;
  image_height: number;
  annotation_date: string | null;
  created_at: string;
  updated_at: string;
}

// Fetch all annotations
async function getAllAnnotations(): Promise<Annotation[]> {
  const response = await fetch(`${API_BASE}/api/uploaded-annotations`);
  const data = await response.json();
  
  if (!data.success) {
    throw new Error('Failed to fetch annotations');
  }
  
  return data.annotations;
}

// Fetch single annotation
async function getAnnotation(articleStyle: string, size: string): Promise<Annotation | null> {
  const response = await fetch(
    `${API_BASE}/api/uploaded-annotations/${encodeURIComponent(articleStyle)}/${encodeURIComponent(size)}`
  );
  
  if (response.status === 404) {
    return null;
  }
  
  const data = await response.json();
  return data.annotation;
}

// Get image as base64 for use in Electron
async function getImageBase64(articleStyle: string, size: string): Promise<string | null> {
  const response = await fetch(
    `${API_BASE}/api/uploaded-annotations/${encodeURIComponent(articleStyle)}/${encodeURIComponent(size)}/image-base64`
  );
  
  if (!response.ok) {
    return null;
  }
  
  const data = await response.json();
  return data.image.data; // Returns "data:image/jpeg;base64,..."
}

// Example usage
async function loadAnnotationForQC(articleStyle: string, size: string) {
  const annotation = await getAnnotation(articleStyle, size);
  
  if (!annotation) {
    console.error('No annotation found for', articleStyle, size);
    return;
  }
  
  // Load the reference image
  const imageBase64 = await getImageBase64(articleStyle, size);
  
  // Use the data - access annotation_data for keypoints
  console.log('Keypoints:', annotation.annotation_data.keypoints);
  console.log('Target distances:', annotation.annotation_data.target_distances);
  console.log('Image:', imageBase64);
  
  return {
    annotation,
    imageData: imageBase64
  };
}
```

---

## Expected JSON Format

When uploading annotations, the JSON file should follow this structure:

```json
{
  "keypoints": [
    { "x": 100, "y": 200, "label": "Shoulder Left" },
    { "x": 300, "y": 200, "label": "Shoulder Right" },
    { "x": 200, "y": 400, "label": "Waist Center" },
    { "x": 100, "y": 600, "label": "Hip Left" },
    { "x": 300, "y": 600, "label": "Hip Right" }
  ],
  "target_distances": {
    "0-1": 45.5,
    "0-3": 52.0,
    "1-4": 52.0,
    "2-3": 25.0,
    "2-4": 25.0
  },
  "placement_box": {
    "x": 50,
    "y": 50,
    "width": 400,
    "height": 700
  },
  "annotation_date": "2024-01-15T10:30:00Z"
}
```

**Required Fields:**
- `keypoints`: Array of point objects with `x`, `y`, and `label`

**Optional Fields:**
- `target_distances`: Object mapping point pairs (e.g., "0-1") to distances in cm
- `placement_box`: Object defining the bounding box for garment placement
- `annotation_date`: ISO 8601 date string

---

## Notes

1. **CORS**: The API endpoints support cross-origin requests for Electron apps.
2. **No Authentication Required**: These API endpoints do not require authentication tokens.
3. **Image Storage**: Images are stored in `storage/app/public/uploaded-annotations/`.
4. **Overwriting**: Uploading a new annotation for the same article_style + size combination will overwrite the existing one.
5. **File Size Limits**: JSON files max 10MB, Images max 50MB.6. **PHP Requirements**: The `fileinfo` extension must be enabled in `php.ini` for file uploads to work.

---

## Web Dashboard Upload Interface

### Accessing the Upload Page

Navigate to `/annotation-upload` in the web dashboard. This page requires:
1. **User Authentication**: You must be logged in to access the page.
2. **Password Protection**: An additional password is required (shared with Article Registration settings).

### Upload Form Features

The upload form includes:

| Field | Type | Description |
|-------|------|-------------|
| **Article Style** | Dropdown | Select from registered articles in the system |
| **Size** | Dropdown | Select from available sizes for the chosen article (populated from MeasurementSize table) |
| **JSON File** | File Upload | Annotation JSON file (.json or .txt, max 10MB) |
| **Reference Image** | File Upload | Reference image (.jpg, .jpeg, .png, .gif, .webp, max 50MB) |

### Workflow

1. Enter the access password
2. Select an **Article Style** from the dropdown
3. Once an article is selected, the **Size** dropdown populates with available sizes
4. Upload the JSON annotation file
5. Upload the reference image
6. Click "Upload Annotation"

### Cascading Dropdowns

The size dropdown is dynamically populated based on the selected article:
- **API Endpoint**: `GET /annotation-upload/articles/{articleId}/sizes`
- **Response**: Returns sizes from `MeasurementSize` records associated with the article's measurements

### Managing Uploaded Annotations

The page displays a list of all uploaded annotations with:
- Article style and size badges
- Keypoint and target distance counts
- Image dimensions
- Last updated date
- Actions: View image, Delete