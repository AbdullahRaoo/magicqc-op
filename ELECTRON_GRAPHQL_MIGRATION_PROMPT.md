# MagicQC Electron App — GraphQL Migration Prompt

> **Give this prompt to your AI coding assistant along with your codebase.**

---

## Context

The MagicQC Laravel backend has been fully migrated to **GraphQL** using Lighthouse PHP. All data access goes through a single endpoint. Your Electron app needs to be updated to use this new API.

## Server Details

```
Endpoint:    POST https://magicqc.online/graphql
API Key:     QGsiGUxtcN4TjZWuPpUgTFYp5MYdFMKk4qudgxMJmA2cmUZZRJfnLqGhUyG1wtRP
Auth Header: X-API-Key: QGsiGUxtcN4TjZWuPpUgTFYp5MYdFMKk4qudgxMJmA2cmUZZRJfnLqGhUyG1wtRP
```

## What Changed Server-Side

1. **All operator panel REST endpoints have been removed** — `GET /api/camera/brands`, `/article-types`, `/purchase-orders`, `/po-articles`, `/measurement-specs`, `/available-sizes`, `/measurement-results`, `/operators`, `/purchase-orders-all`, `POST /verify-pin`, `/measurement-results`, `/measurement-results-detailed`, `/measurement-sessions` — **all deleted**.

2. **One GraphQL endpoint replaces everything** — `POST /graphql` handles all queries and mutations.

3. **REST endpoints still alive** (do NOT migrate these):
   - `GET /api/camera/ping` — health check
   - `GET /api/camera/articles` — camera article list
   - `GET /api/camera/articles/{id}/images` — camera images
   - `POST /api/camera/upload` — camera image upload
   - `DELETE /api/camera/images/{id}` — delete image
   - `GET/POST /api/annotations/*` — annotation CRUD
   - `GET /api/uploaded-annotations/*` — uploaded annotations (no auth required)

## Your Task

Migrate the Electron app's `MagicQCApiClient` (or equivalent API layer) to use GraphQL for all data operations. Here's the full schema the server supports:

### Queries (Read Data)

```graphql
# Brands

{ brands { id name } }

# Article types
{ articleTypes { id name } }

# Articles (with optional filters)
{ articles(brand_id: 1, article_type_id: 2) {
    id article_style description
    brand { id name }
    articleType { id name }
    measurements { id code measurement tol_plus tol_minus side
      sizes { size value }
    }
    images { id image_path }
  }
}

# Purchase orders (with optional filters)
{ purchaseOrders(brand_id: 1, status: "Active") {
    id po_number date country status
    brand { id name }
    articles { id article_color order_quantity }
    clientReferences { reference_name reference_value }
  }
}

# Single purchase order
{ purchaseOrder(id: 5) {
    id po_number status
    articles { id article_color order_quantity }
  }
}

# PO articles
{ purchaseOrderArticles(purchase_order_id: 1) {
    id article_color order_quantity
  }
}

# Measurements for an article (includes size-specific values)
{ measurements(article_id: 5) {
    id code measurement tol_plus tol_minus side
    sizes { size value }
  }
}

# Measurement sizes (filtered)
{ measurementSizes(measurement_id: 10, size: "M") {
    id size value
  }
}

# All operators (login_pin is never exposed)
{ operators { id full_name employee_id department contact_number } }

# Single operator
{ operator(id: 3) { id full_name employee_id department } }

# Article images
{ articleImages(article_id: 5) { id image_path } }

# Uploaded annotations
{ uploadedAnnotations(article_style: "ABC", size: "M", side: "front") {
    id article_style size side annotation_data reference_image_path
  }
}

# Article annotations
{ articleAnnotations(article_style: "ABC", size: "M") {
    id article_style size annotation_data
  }
}

# Saved measurement results (from QC sessions)
{ measurementResults(purchase_order_article_id: 1, size: "M") {
    id purchase_order_article_id measurement_id size article_style
    measured_value expected_value tol_plus tol_minus status operator_id
  }
}

# Saved detailed results (per-side)
{ measurementResultsDetailed(purchase_order_article_id: 1, size: "M", side: "front") {
    id measurement_id size side article_style
    measured_value expected_value tol_plus tol_minus status operator_id
  }
}

# Saved measurement sessions
{ measurementSessions(purchase_order_article_id: 1, size: "M") {
    id purchase_order_article_id size article_style article_id
    purchase_order_id operator_id status
    front_side_complete back_side_complete front_qc_result back_qc_result
  }
}

# Inspection records
{ inspectionRecords(article_id: 5, purchase_order_id: 1) {
    id status notes
    article { article_style }
    operator { full_name }
  }
}
```

### Mutations (Write Data)

```graphql
# Verify operator PIN
mutation {
  verifyPin(employee_id: "EMP001", pin: "1234") {
    success message
    operator { id full_name employee_id department }
  }
}

# Save measurement results (bulk upsert)
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
    }
  ]) {
    success message count
  }
}

# Save detailed results (per-side, DELETE+INSERT)
mutation {
  upsertMeasurementResultsDetailed(
    purchase_order_article_id: 1
    size: "M"
    side: "front"
    results: [
      {
        measurement_id: 10
        measured_value: 52.8
        expected_value: 52.5
        tol_plus: 1.0
        tol_minus: 1.0
        status: "PASS"
        operator_id: 3
      }
    ]
  ) {
    success message count
  }
}

# Save QC session
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
    success message
  }
}

# Upload image (multipart/form-data — see below)
mutation ($file: Upload!) {
  uploadImage(file: $file, name: "front-view", folder: "brand-x/po-123") {
    success message path url
  }
}
```

### Image Upload (Multipart)

Image upload does NOT use JSON. It follows the [GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec):

```typescript
async function uploadImage(file: File | Blob, name: string, folder?: string) {
  const formData = new FormData();
  
  formData.append('operations', JSON.stringify({
    query: `mutation ($file: Upload!) {
      uploadImage(file: $file, name: "${name}", folder: "${folder || ''}") {
        success message path url
      }
    }`,
    variables: { file: null },
  }));
  formData.append('map', JSON.stringify({ '0': ['variables.file'] }));
  formData.append('0', file);

  const response = await fetch('https://magicqc.online/graphql', {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY },  // NO Content-Type header — FormData sets it
    body: formData,
  });

  return response.json();
}
```

Constraints: jpg/jpeg/png only, max 10MB.

## Key Implementation Notes

1. **All GraphQL IDs are strings** — `id: "5"` not `id: 5`. Cast with `parseInt()` if your app expects numbers.

2. **Nested data replaces multiple calls** — Instead of fetching brands, then POs for each brand, do:
   ```graphql
   { brands { id name purchaseOrders { id po_number status } } }
   ```

3. **GraphQL returns `brand: { name }` not `brand_name`** — Your response transformers need to handle nested objects.

4. **Error format** — Errors come in `errors[]` array alongside `data`:
   ```json
   { "data": null, "errors": [{ "message": "Unauthenticated." }] }
   ```

5. **The `X-API-Key` header must be sent on every GraphQL request** — Missing it returns `Unauthenticated.`

6. **Batch everything** — You can fetch brands + operators + active POs in one call:
   ```graphql
   {
     brands { id name }
     operators { id full_name employee_id department }
     purchaseOrders(status: "Active") { id po_number brand { name } }
   }
   ```

7. **No REST fallback needed for measurement results anymore** — `measurementResults`, `measurementResultsDetailed`, and `measurementSessions` queries are all available via GraphQL now.

## Suggested TypeScript API Client

```typescript
class MagicQCApiClient {
  private url = 'https://magicqc.online/graphql';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async query<T = any>(gql: string, variables?: Record<string, any>): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ query: gql, variables }),
    });

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`GraphQL Error: ${json.errors[0].message}`);
    }
    return json.data;
  }

  // ── Queries ──
  getBrands = () => this.query('{ brands { id name } }');
  getArticleTypes = () => this.query('{ articleTypes { id name } }');
  getOperators = () => this.query('{ operators { id full_name employee_id department } }');
  
  getArticles = (brandId?: number, typeId?: number) => {
    const args = [
      brandId ? `brand_id: ${brandId}` : '',
      typeId ? `article_type_id: ${typeId}` : '',
    ].filter(Boolean).join(', ');
    return this.query(`{ articles${args ? `(${args})` : ''} { id article_style description brand { id name } articleType { id name } } }`);
  };

  getPurchaseOrders = (brandId?: number, status?: string) => {
    const args = [
      brandId ? `brand_id: ${brandId}` : '',
      status ? `status: "${status}"` : '',
    ].filter(Boolean).join(', ');
    return this.query(`{ purchaseOrders${args ? `(${args})` : ''} { id po_number date country status brand { id name } articles { id article_color order_quantity } } }`);
  };

  getMeasurements = (articleId: number) =>
    this.query(`{ measurements(article_id: ${articleId}) { id code measurement tol_plus tol_minus side sizes { size value } } }`);

  getMeasurementResults = (poArticleId: number, size?: string) => {
    const args = [`purchase_order_article_id: ${poArticleId}`, size ? `size: "${size}"` : ''].filter(Boolean).join(', ');
    return this.query(`{ measurementResults(${args}) { id measurement_id size measured_value expected_value tol_plus tol_minus status operator_id } }`);
  };

  verifyPin = (employeeId: string, pin: string) =>
    this.query(`mutation { verifyPin(employee_id: "${employeeId}", pin: "${pin}") { success message operator { id full_name employee_id department } } }`);
}
```

## Testing

After migration, verify these work:

```bash
# Health check (REST — still works)
curl https://magicqc.online/api/camera/ping

# GraphQL — get brands
curl -X POST https://magicqc.online/graphql \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_KEY>" \
  -d '{"query":"{ brands { id name } }"}'

# GraphQL — nested query
curl -X POST https://magicqc.online/graphql \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_KEY>" \
  -d '{"query":"{ purchaseOrders(status: \"Active\") { id po_number brand { name } articles { article_color } } }"}'
```
