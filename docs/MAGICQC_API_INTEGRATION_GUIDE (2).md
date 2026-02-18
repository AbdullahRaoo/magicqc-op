# MagicQC — GraphQL API Integration Guide

> **For:** Electron App Developers  
> **Version:** 3.0 — February 2026  
> **Server:** `https://magicqc.online`  
> **Endpoint:** `POST /graphql`

---

## 1. Quick Start

### Single Endpoint, Single Auth Header

Every query and mutation goes through **one endpoint**:

```
POST https://magicqc.online/graphql
Headers:
  Content-Type: application/json
  X-API-Key: <your-64-char-api-key>
```

### First Request

```typescript
const response = await fetch('https://magicqc.online/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.MAGICQC_API_KEY,
  },
  body: JSON.stringify({
    query: `{ brands { id name } }`
  }),
});
const { data, errors } = await response.json();
console.log(data.brands); // [{ id: "1", name: "Nike" }, ...]
```

---

## 2. Authentication

All GraphQL operations require the `X-API-Key` header. Without it, you get:

```json
{
  "errors": [{
    "message": "Unauthenticated.",
    "extensions": { "category": "authentication" }
  }]
}
```

Store the key in your Electron app's `.env`:
```env
MAGICQC_API_KEY=p7K2IY2aJYLGQ5rG8Fjiqpo...64chars
MAGICQC_API_URL=https://magicqc.online/graphql
```

---

## 3. Available Types

Every type maps to a database table. You can request **any combination of fields** — only what you need.

### Brand
```graphql
type Brand {
  id: ID!
  name: String!
  purchaseOrders: [PurchaseOrder!]!  # nested relationship
  created_at: DateTime
  updated_at: DateTime
}
```

### ArticleType
```graphql
type ArticleType {
  id: ID!
  name: String!
  articles: [Article!]!
}
```

### Article
```graphql
type Article {
  id: ID!
  brand_id: Int
  article_type_id: Int
  article_style: String
  description: String
  brand: Brand                 # parent
  articleType: ArticleType     # parent
  measurements: [Measurement!]!
  images: [ArticleImage!]!
}
```

### PurchaseOrder
```graphql
type PurchaseOrder {
  id: ID!
  po_number: String
  date: Date                   # "2026-02-18"
  brand_id: Int
  country: String
  status: String               # "Active", "Pending", "Completed"
  brand: Brand
  articles: [PurchaseOrderArticle!]!
  clientReferences: [PurchaseOrderClientReference!]!
}
```

### PurchaseOrderArticle
```graphql
type PurchaseOrderArticle {
  id: ID!
  purchase_order_id: Int
  article_id: Int
  article_color: String
  order_quantity: Int
  purchaseOrder: PurchaseOrder
}
```

### Measurement
```graphql
type Measurement {
  id: ID!
  article_id: Int
  code: String                 # "A", "B", "C"
  measurement: String          # "Chest Width"
  tol_plus: Float
  tol_minus: Float
  side: String                 # "front", "back"
  article: Article
  sizes: [MeasurementSize!]!   # size-specific values
}
```

### MeasurementSize
```graphql
type MeasurementSize {
  id: ID!
  measurement_id: Int
  size: String                 # "S", "M", "L"
  value: Float                 # the expected value for this size
}
```

### Operator
```graphql
type Operator {
  id: ID!
  full_name: String
  employee_id: String
  department: String
  contact_number: String
  # login_pin is NEVER exposed
}
```

### Other Types
`ArticleImage`, `UploadedAnnotation`, `ArticleAnnotation`, `InspectionRecord`, `PurchaseOrderClientReference` — all queryable with relationships.

---

## 4. Queries (Read Data)

### 4.1 Get All Brands

```graphql
{
  brands {
    id
    name
  }
}
```

### 4.2 Get Brands with Active Purchase Orders (Nested)

```graphql
{
  brands {
    id
    name
    purchaseOrders {
      id
      po_number
      status
    }
  }
}
```

### 4.3 Get Purchase Orders (with Filters)

```graphql
{
  purchaseOrders(status: "Active", brand_id: 1) {
    id
    po_number
    date
    country
    brand {
      name
    }
    articles {
      id
      article_color
      order_quantity
    }
  }
}
```

### 4.4 Get Articles (with Filters)

```graphql
{
  articles(brand_id: 1, article_type_id: 2) {
    id
    article_style
    description
    brand { name }
    articleType { name }
  }
}
```

### 4.5 Get Article Types

```graphql
{
  articleTypes {
    id
    name
  }
}
```

### 4.6 Get Measurements with Size-Specific Values

```graphql
{
  measurements(article_id: 5) {
    id
    code
    measurement
    tol_plus
    tol_minus
    side
    sizes {
      size
      value
    }
  }
}
```

### 4.7 Get Measurement Sizes (Filtered)

```graphql
{
  measurementSizes(measurement_id: 10, size: "M") {
    id
    size
    value
  }
}
```

### 4.8 Get All Operators

```graphql
{
  operators {
    id
    full_name
    employee_id
    department
  }
}
```

### 4.9 Get Purchase Order Articles

```graphql
{
  purchaseOrderArticles(purchase_order_id: 1) {
    id
    article_color
    order_quantity
    purchaseOrder {
      po_number
    }
  }
}
```

### 4.10 Find a Single Record by ID

```graphql
{
  article(id: 5) {
    id
    article_style
    description
    brand { name }
    measurements {
      code
      measurement
      sizes { size value }
    }
  }
}
```

### 4.11 Get Everything in One Call

```graphql
{
  brands { id name }
  articleTypes { id name }
  operators { id full_name employee_id department }
  purchaseOrders(status: "Active") {
    id po_number
    brand { name }
    articles { article_color order_quantity }
  }
}
```

---

## 5. Mutations (Write Data)

### 5.1 Verify Operator PIN

```graphql
mutation {
  verifyPin(employee_id: "EMP001", pin: "1234") {
    success
    message
    operator {
      id
      full_name
      employee_id
      department
    }
  }
}
```

**Response (success):**
```json
{
  "data": {
    "verifyPin": {
      "success": true,
      "message": "PIN verified successfully.",
      "operator": {
        "id": "3",
        "full_name": "John Doe",
        "employee_id": "EMP001",
        "department": "QC"
      }
    }
  }
}
```

**Response (failure):**
```json
{
  "data": {
    "verifyPin": {
      "success": false,
      "message": "Invalid PIN.",
      "operator": null
    }
  }
}
```

### 5.2 Save Measurement Results (Bulk Upsert)

```graphql
mutation {
  upsertMeasurementResults(results: [
    {
      purchase_order_article_id: 1
      measurement_id: 10
      size: "M"
      article_style: "ABC123"
      measured_value: 52.8
      expected_value: 52.5
      tol_plus: 1.0
      tol_minus: 1.0
      status: "PASS"
      operator_id: 3
    },
    {
      purchase_order_article_id: 1
      measurement_id: 11
      size: "M"
      measured_value: 45.2
      expected_value: 45.0
      tol_plus: 0.5
      tol_minus: 0.5
      status: "FAIL"
      operator_id: 3
    }
  ]) {
    success
    message
    count
  }
}
```

### 5.3 Save Detailed Results (Per-Side)

```graphql
mutation {
  upsertMeasurementResultsDetailed(
    purchase_order_article_id: 1
    size: "M"
    side: "front"
    results: [
      {
        measurement_id: 10
        article_style: "ABC123"
        measured_value: 52.8
        expected_value: 52.5
        tol_plus: 1.0
        tol_minus: 1.0
        status: "PASS"
        operator_id: 3
      }
    ]
  ) {
    success
    message
    count
  }
}
```

### 5.4 Save QC Session

```graphql
mutation {
  upsertMeasurementSession(
    purchase_order_article_id: 1
    size: "M"
    article_style: "ABC123"
    article_id: 5
    purchase_order_id: 1
    operator_id: 3
    status: "in_progress"
    front_side_complete: true
    back_side_complete: false
    front_qc_result: "PASS"
    back_qc_result: null
  ) {
    success
    message
  }
}
```

### 5.5 Upload Image

Image upload uses `multipart/form-data` (not JSON). Follow the [GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec):

```typescript
const formData = new FormData();

// 1. operations
formData.append('operations', JSON.stringify({
  query: `mutation ($file: Upload!) {
    uploadImage(file: $file, name: "front-view", folder: "brand-x/article-123") {
      success
      message
      path
      url
    }
  }`,
  variables: { file: null }
}));

// 2. map
formData.append('map', JSON.stringify({ '0': ['variables.file'] }));

// 3. file
formData.append('0', fileBlob, 'photo.jpg');

const response = await fetch('https://magicqc.online/graphql', {
  method: 'POST',
  headers: { 'X-API-Key': API_KEY },
  body: formData,
});
```

**Constraints:** jpg/jpeg/png only, max 10MB.  
**Storage:** Files saved to `storage/app/public/uploads/{folder}/{name}.{ext}`  
**URL returned:** `https://magicqc.online/storage/uploads/{folder}/{name}.{ext}`

---

## 6. Complete TypeScript Client

Copy this into your Electron app as `api/magicqc-graphql.ts`:

```typescript
interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string; extensions?: any }>;
}

class MagicQCGraphQL {
  private url: string;
  private apiKey: string;

  constructor(url: string, apiKey: string) {
    this.url = url;
    this.apiKey = apiKey;
  }

  // ── Core query method ──────────────────────────────────────────
  async query<T = any>(
    graphqlQuery: string,
    variables?: Record<string, any>
  ): Promise<GraphQLResponse<T>> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ query: graphqlQuery, variables }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  // ── Convenience methods ────────────────────────────────────────

  async getBrands() {
    return this.query<{ brands: Array<{ id: string; name: string }> }>(`
      { brands { id name } }
    `);
  }

  async getArticleTypes() {
    return this.query<{ articleTypes: Array<{ id: string; name: string }> }>(`
      { articleTypes { id name } }
    `);
  }

  async getArticles(brandId?: number, typeId?: number) {
    const filters: string[] = [];
    if (brandId) filters.push(`brand_id: ${brandId}`);
    if (typeId) filters.push(`article_type_id: ${typeId}`);
    const args = filters.length ? `(${filters.join(', ')})` : '';

    return this.query(`{
      articles${args} {
        id article_style description
        brand { id name }
        articleType { id name }
      }
    }`);
  }

  async getPurchaseOrders(status?: string, brandId?: number) {
    const filters: string[] = [];
    if (status) filters.push(`status: "${status}"`);
    if (brandId) filters.push(`brand_id: ${brandId}`);
    const args = filters.length ? `(${filters.join(', ')})` : '';

    return this.query(`{
      purchaseOrders${args} {
        id po_number date country status
        brand { id name }
        articles { id article_color order_quantity }
      }
    }`);
  }

  async getPOArticles(poId: number) {
    return this.query(`{
      purchaseOrderArticles(purchase_order_id: ${poId}) {
        id article_color order_quantity
        purchaseOrder { po_number }
      }
    }`);
  }

  async getMeasurements(articleId: number) {
    return this.query(`{
      measurements(article_id: ${articleId}) {
        id code measurement tol_plus tol_minus side
        sizes { size value }
      }
    }`);
  }

  async getMeasurementSizes(measurementId: number, size?: string) {
    const filters: string[] = [`measurement_id: ${measurementId}`];
    if (size) filters.push(`size: "${size}"`);

    return this.query(`{
      measurementSizes(${filters.join(', ')}) {
        id size value
      }
    }`);
  }

  async getOperators() {
    return this.query(`{
      operators { id full_name employee_id department contact_number }
    }`);
  }

  async verifyPin(employeeId: string, pin: string) {
    return this.query(`
      mutation {
        verifyPin(employee_id: "${employeeId}", pin: "${pin}") {
          success message
          operator { id full_name employee_id department }
        }
      }
    `);
  }

  async saveMeasurementResults(results: any[]) {
    const resultsStr = JSON.stringify(results)
      .replace(/"(\w+)":/g, '$1:');  // Convert to GraphQL format

    return this.query(`
      mutation {
        upsertMeasurementResults(results: ${resultsStr}) {
          success message count
        }
      }
    `);
  }

  async saveDetailedResults(
    poArticleId: number, size: string, side: string, results: any[]
  ) {
    const resultsStr = JSON.stringify(results)
      .replace(/"(\w+)":/g, '$1:');

    return this.query(`
      mutation {
        upsertMeasurementResultsDetailed(
          purchase_order_article_id: ${poArticleId}
          size: "${size}"
          side: "${side}"
          results: ${resultsStr}
        ) { success message count }
      }
    `);
  }

  async saveSession(session: {
    purchase_order_article_id: number;
    size: string;
    article_style?: string;
    article_id?: number;
    purchase_order_id?: number;
    operator_id?: number;
    status?: string;
    front_side_complete?: boolean;
    back_side_complete?: boolean;
    front_qc_result?: string;
    back_qc_result?: string;
  }) {
    const args = Object.entries(session)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => typeof v === 'string' ? `${k}: "${v}"` : `${k}: ${v}`)
      .join('\n      ');

    return this.query(`
      mutation {
        upsertMeasurementSession(
          ${args}
        ) { success message }
      }
    `);
  }

  // ── Image upload ───────────────────────────────────────────────
  async uploadImage(file: File | Blob, name: string, folder?: string) {
    const formData = new FormData();

    const query = `mutation ($file: Upload!) {
      uploadImage(file: $file, name: "${name}", folder: "${folder || ''}") {
        success message path url
      }
    }`;

    formData.append('operations', JSON.stringify({
      query,
      variables: { file: null },
    }));
    formData.append('map', JSON.stringify({ '0': ['variables.file'] }));
    formData.append('0', file);

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey },
      body: formData,
    });

    return response.json();
  }
}

// ── Usage ──────────────────────────────────────────────────────
export const magicQC = new MagicQCGraphQL(
  process.env.MAGICQC_API_URL || 'https://magicqc.online/graphql',
  process.env.MAGICQC_API_KEY || ''
);
```

---

## 7. Migration from REST Endpoints

If you were using the old REST endpoints, here's the mapping:

| Old REST Endpoint | GraphQL Equivalent |
|---|---|
| `GET /api/camera/brands` | `{ brands { id name } }` |
| `GET /api/camera/article-types?brand_id=X` | `{ articleTypes { id name } }` |
| `GET /api/camera/articles-filtered?brand_id=X&type_id=Y` | `{ articles(brand_id: X, article_type_id: Y) { ... } }` |
| `GET /api/camera/purchase-orders?brand_id=X` | `{ purchaseOrders(brand_id: X, status: "Active") { ... } }` |
| `GET /api/camera/purchase-orders-all?status=X` | `{ purchaseOrders(status: "X") { ... } }` |
| `GET /api/camera/po-articles?po_id=X` | `{ purchaseOrderArticles(purchase_order_id: X) { ... } }` |
| `GET /api/camera/measurement-specs?article_id=X&size=Y` | `{ measurements(article_id: X) { ... sizes(size: "Y") { ... } } }` |
| `GET /api/camera/available-sizes?article_id=X` | `{ measurements(article_id: X) { sizes { size } } }` — get distinct sizes |
| `GET /api/camera/measurement-results?po_article_id=X` | ⚠️ Use raw query (not in GraphQL schema — table may not exist) |
| `POST /api/camera/measurement-results` | `mutation { upsertMeasurementResults(results: [...]) { ... } }` |
| `POST /api/camera/measurement-results-detailed` | `mutation { upsertMeasurementResultsDetailed(...) { ... } }` |
| `POST /api/camera/measurement-sessions` | `mutation { upsertMeasurementSession(...) { ... } }` |
| `POST /api/camera/verify-pin` | `mutation { verifyPin(employee_id: "...", pin: "...") { ... } }` |
| `GET /api/camera/operators` | `{ operators { id full_name employee_id department } }` |

---

## 8. Error Handling

GraphQL errors are returned in the `errors` array alongside `data`:

```json
{
  "data": null,
  "errors": [
    {
      "message": "Unauthenticated.",
      "extensions": { "category": "authentication" }
    }
  ]
}
```

**TypeScript error handling:**
```typescript
const { data, errors } = await magicQC.query('{ brands { id name } }');

if (errors) {
  const isAuthError = errors.some(e => e.extensions?.category === 'authentication');
  if (isAuthError) {
    console.error('Invalid API key — contact admin');
  } else {
    console.error('GraphQL errors:', errors.map(e => e.message));
  }
  return;
}

// Use data safely
console.log(data.brands);
```

---

## 9. Remaining REST Endpoints (Still Active)

These REST endpoints are **NOT** part of GraphQL — use them directly:

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| `GET` | `/api/camera/ping` | Optional | Health check |
| `GET` | `/api/camera/articles` | ✅ Key | List articles (camera view) |
| `GET` | `/api/camera/articles/{id}/images` | ✅ Key | Get article images |
| `POST` | `/api/camera/upload` | ✅ Key | Upload camera image |
| `DELETE` | `/api/camera/images/{id}` | ✅ Key | Delete an image |
| `GET` | `/api/annotations/...` | ✅ Key | Camera annotations |
| `GET` | `/api/uploaded-annotations/...` | ❌ None | Uploaded annotations |

---

## 10. Tips & Best Practices

1. **Request only fields you need** — GraphQL won't fetch data you don't ask for, making responses faster.
2. **Batch queries** — You can request `brands`, `purchaseOrders`, and `operators` in a single call.
3. **Nested relationships** — Access related data without extra calls: `purchaseOrders { brand { name } articles { ... } }`.
4. **CORS is fully open** — No restrictions from the Electron app.
5. **The API key** is a 64-character string. Store in `.env`, never hardcode.
6. **Image uploads** use `multipart/form-data`, not JSON. See Section 5.5.
7. **All IDs** are returned as strings in GraphQL. Cast to number if needed: `parseInt(id)`.
