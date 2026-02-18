# API Gap Analysis — What Exists vs What's Missing

## ✅ Already Exists on `magicqc.online`

| # | Endpoint | What It Does | Used By |
|---|----------|-------------|---------|
| 1 | `GET /api/camera/ping` | Test connectivity | Health check |
| 2 | `GET /api/camera/articles` | List all articles | Diagnostics only |
| 3 | `GET /api/camera/articles/{id}/images` | Article images | Not used by operator panel |
| 4 | `POST /api/camera/upload` | Upload camera image | Not used currently |
| 5 | `DELETE /api/camera/images/{id}` | Delete image | Not used currently |
| 6 | `GET /api/annotations` | List camera annotations | Not used currently |
| 7 | `GET /api/annotations/{style}/{size}` | Get annotation | Not used currently |
| 8 | `POST /api/annotations/sync` | Sync annotation | Not used currently |
| 9 | `GET /api/uploaded-annotations` | List uploaded annotations | Not used currently |
| 10 | `GET /api/uploaded-annotations/{style}/{size}/{side}` | Get single annotation | Partially usable |
| 11 | `GET /api/uploaded-annotations/.../image` | Get reference image | Partially usable |
| 12 | `GET /api/uploaded-annotations/.../image-base64` | Get image as base64 | Used via IPC |
| 13 | `GET /api/uploaded-annotations/operator-fetch` ⭐ | Annotation + image in one call | **Can replace 4 SQL queries** |

---

## ❌ Missing — Needs to Be Built on Laravel Server

| # | Needed Endpoint | Purpose | App Function That Needs It | SQL it Replaces |
|---|----------------|---------|---------------------------|-----------------|
| 1 | `GET /api/camera/brands` | Brands with active POs | `fetchBrands()` | `SELECT b.id, b.name FROM brands JOIN purchase_orders...` |
| 2 | `GET /api/camera/article-types?brand_id=X` | Article types for a brand | `fetchArticleTypes()` | `SELECT at.id, at.name FROM article_types JOIN articles...` |
| 3 | `GET /api/camera/articles?brand_id=X&type_id=Y` | Articles filtered by brand + type | `fetchArticles()` | `SELECT a.*, b.name, at.name FROM articles...` |
| 4 | `GET /api/camera/purchase-orders?brand_id=X` | Active POs for a brand | `fetchPurchaseOrders()` | `SELECT po.id, po.po_number FROM purchase_orders...` |
| 5 | `GET /api/camera/po-articles?po_id=X` | Articles in a purchase order | `fetchPOArticles()` | `SELECT poa.*, po.po_number FROM purchase_order_articles...` |
| 6 | `GET /api/camera/measurement-specs?article_id=X&size=Y` | Measurement specs (with 2-strategy lookup) | `fetchMeasurementSpecs()` | 2× complex JOIN queries |
| 7 | `GET /api/camera/available-sizes?article_id=X` | Available sizes for article | `fetchAvailableSizes()` | `SELECT DISTINCT ms.size FROM measurement_sizes...` |
| 8 | `GET /api/camera/measurement-results?po_article_id=X&size=Y` | Load existing results | `loadExistingMeasurements()` | `SELECT mr.* FROM measurement_results...` |
| 9 | `POST /api/camera/measurement-results` | Save/upsert results (bulk) | `saveMeasurements()` | `INSERT INTO measurement_results ... ON DUPLICATE KEY UPDATE` |
| 10 | `POST /api/camera/measurement-results-detailed` | Save detailed results with side | `saveMeasurementsWithSide()` | `DELETE` + `INSERT INTO measurement_results_detailed` |
| 11 | `POST /api/camera/measurement-sessions` | Save QC session record | `handleNextArticle()` | `INSERT INTO measurement_sessions ... ON DUPLICATE KEY UPDATE` |
| 12 | `POST /api/camera/verify-pin` | Operator PIN verification | `verifyPin()` | `SELECT FROM operators` + bcrypt compare |

---

## Summary

| Category | Exists | Missing |
|----------|--------|---------|
| **Connection/Health** | 1 ✅ | 0 |
| **Articles & Brands** | 1 (basic list only) | 3 (filtered + brands + types) |
| **Purchase Orders** | 0 | 2 (POs + PO articles) |
| **Measurements/Specs** | 0 | 3 (specs + sizes + results) |
| **Measurement Save/Load** | 0 | 3 (results + detailed + sessions) |
| **Annotations** | 5 ✅ (including `operator-fetch` ⭐) | 0 |
| **Authentication** | 0 | 1 (PIN verify) |
| **Total** | **13 exist** | **12 need to be built** |

> [!NOTE]
> The existing `operator-fetch` endpoint can replace the current 4-tier annotation SQL lookup — so annotations are fully covered. The gap is entirely in: **brands/articles/POs, measurement data, and authentication.**
