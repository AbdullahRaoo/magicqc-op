# MagicQC Operator Panel — Complete API Requirements

> **Audit Date:** 2026-02-18  
> **Server:** `https://magicqc.online` (Laravel)  
> **Local:** `http://127.0.0.1:5000` (Python measurement API)

---

## 📋 WHAT WE NEED (All Endpoints Required)

The operator panel requires **17 Laravel API endpoints** and **10 Python local API endpoints** to run smoothly.

### A. Laravel API Endpoints (Remote Server — `magicqc.online`)

| # | Endpoint | Method | Purpose | Used By |
|---|----------|--------|---------|---------|
| 1 | `/api/camera/ping` | GET | Server health check | `runDiagnostics()` |
| 2 | `/api/camera/brands` | GET | List brands with active POs | `fetchBrands()` |
| 3 | `/api/camera/article-types?brand_id=` | GET | Article types for a brand | `fetchArticleTypes()` |
| 4 | `/api/camera/articles-filtered?brand_id=&type_id=` | GET | Articles filtered by brand & type | `fetchArticles()` |
| 5 | `/api/camera/purchase-orders?brand_id=` | GET | POs for a brand | `fetchPurchaseOrders()` |
| 6 | `/api/camera/po-articles?po_id=` | GET | Articles inside a PO | `fetchPOArticles()` |
| 7 | `/api/camera/measurement-specs?article_id=&size=` | GET | Measurement specs for article+size | `fetchMeasurementSpecs()` |
| 8 | `/api/camera/available-sizes?article_id=` | GET | Available sizes for article | `fetchAvailableSizes()` |
| 9 | `/api/camera/measurement-results?po_article_id=&size=` | GET | Load saved results | `loadExistingMeasurements()` |
| 10 | `/api/camera/measurement-results` | POST | Save measurement results (bulk) | `saveMeasurements()` |
| 11 | `/api/camera/measurement-results-detailed` | POST | Save detailed results with side | `saveMeasurementsWithSide()` |
| 12 | `/api/camera/measurement-sessions` | POST | Save session analytics | `handleNextArticle()` |
| 13 | `/api/camera/verify-pin` | POST | Operator PIN login | `AuthContext.login()` |
| 14 | `/api/uploaded-annotations/operator-fetch?article_style=&size=&side=&color=` | GET | Fetch annotation + reference image | Annotation lookup |
| 15 | `/api/uploaded-annotations/fetch-image-base64?article_style=&size=&side=` | GET | Fetch reference image only | Test image fallback |
| 16 | `/api/camera/purchase-orders-all?status=` | GET | **List ALL POs (admin view)** | `PurchaseOrdersList.tsx` |
| 17 | `/api/camera/operators` | GET | **List all operators** | `OperatorsList.tsx` |

### B. Python Local API Endpoints (Local machine — `127.0.0.1:5000`)

These talk to the locally-running Python measurement server. **No Laravel server changes needed.**

| # | Endpoint | Method | Purpose | Used By |
|---|----------|--------|---------|---------|
| 1 | `/api/measurement/start` | POST | Start camera measurement | `window.measurement.start()` |
| 2 | `/api/measurement/stop` | POST | Stop measurement | `window.measurement.stop()` |
| 3 | `/api/measurement/status` | GET | Measurement status | `window.measurement.getStatus()` |
| 4 | `/api/results/live` | GET | Live results polling | `window.measurement.getLiveResults()` |
| 5 | `/api/calibration/start` | POST | Start camera calibration | `window.measurement.startCalibration()` |
| 6 | `/api/calibration/status` | GET | Calibration status | `window.measurement.getCalibrationStatus()` |
| 7 | `/api/calibration/cancel` | POST | Cancel calibration | `window.measurement.cancelCalibration()` |
| 8 | `/api/calibration/upload` | POST | Upload calibration data | `window.measurement.uploadCalibration()` |
| 9 | Local file read | — | Load test image from disk | `window.measurement.loadTestImage()` |
| 10 | Local file write | — | Save temp annotation/image files | `window.measurement.saveTempFiles()` |

---

## ✅ WHAT WE HAVE (Working Endpoints)

### Laravel Endpoints — 15 of 17 ✅

| # | Endpoint | Status | Migrated In |
|---|----------|--------|-------------|
| 1 | `/api/camera/ping` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 2 | `/api/camera/brands` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 3 | `/api/camera/article-types` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 4 | `/api/camera/articles-filtered` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 5 | `/api/camera/purchase-orders` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 6 | `/api/camera/po-articles` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 7 | `/api/camera/measurement-specs` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 8 | `/api/camera/available-sizes` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 9 | `/api/camera/measurement-results` (GET) | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 10 | `/api/camera/measurement-results` (POST) | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 11 | `/api/camera/measurement-results-detailed` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 12 | `/api/camera/measurement-sessions` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 13 | `/api/camera/verify-pin` | ✅ Working | `api-client.ts` → `main.ts` → `AuthContext.tsx` |
| 14 | `/api/uploaded-annotations/operator-fetch` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |
| 15 | `/api/uploaded-annotations/fetch-image-base64` | ✅ Working | `api-client.ts` → `main.ts` → `ArticlesList.tsx` |

### Python Local Endpoints — 10 of 10 ✅

All Python local endpoints are working. No changes needed.

---

## ❌ WHAT IS NOT THERE (Missing — Needs Laravel Server Work)

### Missing Endpoint 1: List All Purchase Orders

```
GET /api/camera/purchase-orders-all?status=Active
```

**Why needed:** `PurchaseOrdersList.tsx` shows ALL purchase orders across ALL brands, with optional status filter. The existing `/api/camera/purchase-orders?brand_id=` requires a `brand_id` — it cannot list globally.

**Current SQL being used:**
```sql
SELECT po.*, b.name as brand_name, b.description as brand_description
FROM purchase_orders po
LEFT JOIN brands b ON po.brand_id = b.id
WHERE po.status = ?
ORDER BY po.date DESC, po.po_number DESC
LIMIT 50
```

**Expected Response:**
```json
{
  "success": true,
  "purchase_orders": [
    {
      "id": 1,
      "po_number": "PO-2026-001",
      "date": "2026-02-18",
      "brand_id": 1,
      "brand_name": "BrandX",
      "brand_description": "Brand description",
      "country": "Pakistan",
      "status": "Active"
    }
  ]
}
```

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | No | Filter: `Active`, `Pending`, `Completed`, or omit for all |

---

### Missing Endpoint 2: List All Operators

```
GET /api/camera/operators
```

**Why needed:** `OperatorsList.tsx` shows all operators in the system.

**Current SQL being used:**
```sql
SELECT * FROM operators ORDER BY full_name
```

**Expected Response:**
```json
{
  "success": true,
  "operators": [
    {
      "id": 1,
      "full_name": "John Doe",
      "employee_id": "EMP001",
      "department": "QC"
    }
  ]
}
```

> ⚠️ **Security:** Do NOT return `login_pin` field in the response.

---

## 📊 Final Summary

| Category | Count | Status |
|----------|-------|--------|
| ✅ Laravel — Migrated & Working | 15 | Done |
| ✅ Python Local — All Working | 10 | Done (no changes needed) |
| ❌ Laravel — Missing | 2 | Need server-side implementation |
| **Total Required** | **27** | **25/27 complete (93%)** |

### What Blocks Full Migration

```
Missing 2 Laravel endpoints
    ↓
PurchaseOrdersList.tsx and OperatorsList.tsx still use raw SQL
    ↓
Cannot remove electron/database.ts
    ↓
Cannot remove mysql2 npm package
    ↓
Direct DB credentials still needed in .env
```

### Fastest Path to 100%

| Option | Effort | Result |
|--------|--------|--------|
| **A. Add 2 endpoints to Laravel** | ~30 min server work | Full migration, remove mysql2 |
| **B. Remove 2 admin components** | ~5 min delete | Full migration, lose admin views |
| **C. Keep as-is** | None | 93% done, keep mysql2 dependency |
