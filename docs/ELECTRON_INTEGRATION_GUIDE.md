# Electron App Integration Guide for MagicQC Measurement System

## Overview
This guide explains how the Electron desktop app should:
1. Connect to VPS MySQL database
2. Fetch annotation data and reference images
3. Write annotation files for Python measurement system (measurment2.py)

---

## Database Connection (MySQL on VPS)

```javascript
const mysql = require('mysql2/promise');

// Create connection to VPS MySQL
const connection = await mysql.createConnection({
  host: 'your-vps-ip',      // Your VPS IP address
  user: 'magicqc_user',     // MySQL user
  password: 'your_password', // MySQL password
  database: 'magicqc'       // Database name
});
```

---

## Fetching Annotation Data

### 1. Get All Available Annotations

```javascript
async function getAllAnnotations() {
  const [rows] = await connection.query(`
    SELECT 
      id,
      article_style,
      size,
      name,
      keypoints_pixels,
      target_distances,
      placement_box,
      image_width,
      image_height,
      image_data,
      image_mime_type,
      created_at,
      updated_at
    FROM article_annotations
    ORDER BY article_style, size
  `);
  
  return rows;
}
```

### 2. Get Specific Annotation by Article Style and Size

```javascript
async function getAnnotation(articleStyle, size) {
  const [rows] = await connection.query(`
    SELECT 
      id,
      article_style,
      size,
      name,
      keypoints_pixels,
      target_distances,
      placement_box,
      image_width,
      image_height,
      image_data,
      image_mime_type,
      created_at,
      updated_at
    FROM article_annotations
    WHERE article_style = ? AND size = ?
    LIMIT 1
  `, [articleStyle, size]);
  
  return rows[0] || null;
}
```

---

## Writing Annotation Files for Python System

The Python measurement system (`measurment2.py`) expects annotation files in this exact format:

### Expected JSON Format:
```json
{
    "keypoints": [
        [1741, 1386],
        [1666, 2085],
        [3348, 1386]
    ],
    "target_distances": {
        "1": 37.64317350838128,
        "2": 36.60339138534189,
        "3": 11.536302812910455
    },
    "placement_box": [],
    "annotation_date": "2026-02-02T09:41:32"
}
```

### Electron App: Write Annotation File

```javascript
const fs = require('fs').promises;
const path = require('path');

async function writeAnnotationFile(annotation, outputPath) {
  try {
    // Parse JSON columns (they're stored as strings in MySQL)
    const keypoints = JSON.parse(annotation.keypoints_pixels || '[]');
    const targetDistances = JSON.parse(annotation.target_distances || '{}');
    const placementBox = JSON.parse(annotation.placement_box || '[]');
    
    // IMPORTANT: Ensure target_distances has integer keys
    const targetDistancesFormatted = {};
    for (const [key, value] of Object.entries(targetDistances)) {
      targetDistancesFormatted[parseInt(key)] = parseFloat(value);
    }
    
    // Create annotation data in exact format Python expects
    const annotationData = {
      keypoints: keypoints,                          // [[x,y], [x,y], ...]
      target_distances: targetDistancesFormatted,    // {1: value, 2: value}
      placement_box: placementBox,                   // [x1, y1, x2, y2]
      annotation_date: annotation.updated_at || new Date().toISOString()
    };
    
    // Write to annotation_data.json
    const annotationFilePath = path.join(outputPath, 'annotation_data.json');
    await fs.writeFile(
      annotationFilePath,
      JSON.stringify(annotationData, null, 4),
      'utf8'
    );
    
    console.log(`✓ Annotation file written: ${annotationFilePath}`);
    return annotationFilePath;
  } catch (error) {
    console.error('Error writing annotation file:', error);
    throw error;
  }
}
```

### Electron App: Write Reference Image

```javascript
async function writeReferenceImage(annotation, outputPath) {
  try {
    // Decode Base64 image data
    const imageBuffer = Buffer.from(annotation.image_data, 'base64');
    
    // Determine file extension from MIME type
    const mimeToExt = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp'
    };
    const extension = mimeToExt[annotation.image_mime_type] || '.jpg';
    
    // Write reference image
    const imageFilePath = path.join(outputPath, `reference_image${extension}`);
    await fs.writeFile(imageFilePath, imageBuffer);
    
    console.log(`✓ Reference image written: ${imageFilePath}`);
    console.log(`  Image dimensions: ${annotation.image_width}x${annotation.image_height}`);
    
    return imageFilePath;
  } catch (error) {
    console.error('Error writing reference image:', error);
    throw error;
  }
}
```

---

## Complete Workflow Example

```javascript
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

async function setupMeasurementForArticle(articleStyle, size) {
  let connection;
  
  try {
    // 1. Connect to VPS MySQL
    connection = await mysql.createConnection({
      host: 'your-vps-ip',
      user: 'magicqc_user',
      password: 'your_password',
      database: 'magicqc'
    });
    
    console.log('✓ Connected to VPS MySQL');
    
    // 2. Fetch annotation from database
    const [rows] = await connection.query(`
      SELECT 
        id,
        article_style,
        size,
        name,
        keypoints_pixels,
        target_distances,
        placement_box,
        image_width,
        image_height,
        image_data,
        image_mime_type,
        updated_at
      FROM article_annotations
      WHERE article_style = ? AND size = ?
      LIMIT 1
    `, [articleStyle, size]);
    
    if (!rows || rows.length === 0) {
      throw new Error(`No annotation found for ${articleStyle} - ${size}`);
    }
    
    const annotation = rows[0];
    console.log(`✓ Found annotation: ${annotation.name}`);
    console.log(`  Keypoints: ${JSON.parse(annotation.keypoints_pixels).length}`);
    console.log(`  Image: ${annotation.image_width}x${annotation.image_height}`);
    
    // 3. Create output directory
    const outputPath = path.join(__dirname, 'measurement_data', articleStyle, size);
    await fs.mkdir(outputPath, { recursive: true });
    
    // 4. Write annotation JSON file
    await writeAnnotationFile(annotation, outputPath);
    
    // 5. Write reference image
    await writeReferenceImage(annotation, outputPath);
    
    // 6. Create calibration file if needed
    // Note: Calibration should be done separately and saved
    
    console.log('\n✓ Setup complete! Ready for Python measurement system.');
    console.log(`  Working directory: ${outputPath}`);
    console.log('  Files created:');
    console.log('    - annotation_data.json');
    console.log('    - reference_image.jpg');
    console.log('\nYou can now run: python measurment2.py');
    
    return {
      success: true,
      outputPath,
      annotation
    };
    
  } catch (error) {
    console.error('Setup failed:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Helper function implementations
async function writeAnnotationFile(annotation, outputPath) {
  const keypoints = JSON.parse(annotation.keypoints_pixels || '[]');
  const targetDistances = JSON.parse(annotation.target_distances || '{}');
  const placementBox = JSON.parse(annotation.placement_box || '[]');
  
  // Ensure integer keys for target_distances
  const targetDistancesFormatted = {};
  for (const [key, value] of Object.entries(targetDistances)) {
    targetDistancesFormatted[parseInt(key)] = parseFloat(value);
  }
  
  const annotationData = {
    keypoints: keypoints,
    target_distances: targetDistancesFormatted,
    placement_box: placementBox,
    annotation_date: annotation.updated_at || new Date().toISOString()
  };
  
  const filePath = path.join(outputPath, 'annotation_data.json');
  await fs.writeFile(filePath, JSON.stringify(annotationData, null, 4), 'utf8');
  
  return filePath;
}

async function writeReferenceImage(annotation, outputPath) {
  const imageBuffer = Buffer.from(annotation.image_data, 'base64');
  
  const mimeToExt = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };
  const extension = mimeToExt[annotation.image_mime_type] || '.jpg';
  
  const filePath = path.join(outputPath, `reference_image${extension}`);
  await fs.writeFile(filePath, imageBuffer);
  
  return filePath;
}

// Usage example
(async () => {
  try {
    await setupMeasurementForArticle('NKE-TS-001', 'XXL');
  } catch (error) {
    console.error('Error:', error);
  }
})();
```

---

## Data Structure Reference

### Database Table: `article_annotations`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INT | Primary key |
| `article_style` | VARCHAR | Article style code (e.g., 'NKE-TS-001') |
| `size` | VARCHAR | Size (e.g., 'XXL', 'L', 'M') |
| `name` | VARCHAR | Annotation name |
| `keypoints_pixels` | JSON | Keypoint coordinates: `[[x,y], [x,y], ...]` |
| `target_distances` | JSON | Target measurements: `{"1": value, "2": value}` |
| `placement_box` | JSON | Placement guide: `[x1, y1, x2, y2]` |
| `image_width` | INT | Reference image width in pixels |
| `image_height` | INT | Reference image height in pixels |
| `image_data` | LONGTEXT | Base64-encoded reference image (~700KB) |
| `image_mime_type` | VARCHAR | Image MIME type (e.g., 'image/jpeg') |

---

## Important Notes

### 1. Target Distances
- Initially empty `{}` when annotation is first created
- Updated after first measurements in Python system
- Must have **integer keys** for Python: `{1: 37.64, 2: 36.60}`
- NOT string keys: `{"1": 37.64, "2": 36.60}` ❌

### 2. Keypoints Format
- Must be array of `[x, y]` integer arrays
- Example: `[[1741, 1386], [1666, 2085], [3348, 1386]]`
- These are **pixel coordinates**, not percentages

### 3. Placement Box (Optional)
- Format: `[x1, y1, x2, y2]` where (x1,y1) is top-left, (x2,y2) is bottom-right
- Can be empty array `[]` if not set
- Used to guide shirt placement during measurement

### 4. Image Data
- Stored as Base64 in `image_data` column
- Size: ~700KB per image
- Decoded to binary for saving as `.jpg` file

---

## Testing Your Integration

```javascript
// Test script to verify annotation format
async function testAnnotationFormat(articleStyle, size) {
  const connection = await mysql.createConnection({
    host: 'your-vps-ip',
    user: 'magicqc_user',
    password: 'your_password',
    database: 'magicqc'
  });
  
  const [rows] = await connection.query(
    'SELECT * FROM article_annotations WHERE article_style = ? AND size = ?',
    [articleStyle, size]
  );
  
  const annotation = rows[0];
  
  // Parse and validate format
  const keypoints = JSON.parse(annotation.keypoints_pixels);
  const targetDistances = JSON.parse(annotation.target_distances);
  const placementBox = JSON.parse(annotation.placement_box);
  
  console.log('Annotation Validation:');
  console.log('✓ Keypoints format:', Array.isArray(keypoints) && keypoints.every(p => Array.isArray(p) && p.length === 2));
  console.log('✓ Keypoints count:', keypoints.length);
  console.log('✓ Target distances:', Object.keys(targetDistances).length);
  console.log('✓ Placement box:', placementBox);
  console.log('✓ Image dimensions:', annotation.image_width, 'x', annotation.image_height);
  console.log('✓ Image size (Base64):', (annotation.image_data.length * 0.75 / 1024).toFixed(2), 'KB');
  
  await connection.end();
}
```

---

## Troubleshooting

### Issue: Python system can't read keypoints
**Solution**: Ensure `keypoints` is an array of `[x, y]` arrays, not objects

### Issue: Target distances not working
**Solution**: Ensure keys are integers, not strings. Use `parseInt(key)` when formatting.

### Issue: Image not loading
**Solution**: Verify Base64 decoding and file extension match MIME type.

### Issue: Placement box not showing
**Solution**: Check if `placement_box` has exactly 4 values: `[x1, y1, x2, y2]`

---

## Summary

1. **Electron app** connects to **VPS MySQL**
2. Fetches annotation data including **Base64 image**
3. Writes **annotation_data.json** in Python format
4. Writes **reference_image.jpg** from Base64
5. Python measurement system uses these files for live measurements
6. After first measurement, **target_distances** are populated
7. All data centralized in MySQL - no need for network file sharing!

This approach eliminates the need for file sharing and ensures data consistency across all operator workstations.
