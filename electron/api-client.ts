/**
 * MagicQC GraphQL API Client — Single-endpoint client for the Laravel GraphQL API.
 *
 * Replaces the old REST api-client.ts.
 * Every query and mutation goes through POST /graphql.
 * Remaining REST endpoints (ping, annotations) use the base URL directly.
 *
 * Reads MAGICQC_API_URL (graphql), MAGICQC_API_BASE (rest), MAGICQC_API_KEY from apiConfig.ts.
 */

import { MAGICQC_API_URL, MAGICQC_API_BASE, MAGICQC_API_KEY } from './apiConfig'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Brand {
    id: number
    name: string
}

export interface ArticleType {
    id: number
    name: string
}

export interface ArticleFiltered {
    id: number
    article_style: string
    description?: string
    brand_id?: number
    article_type_id?: number
    brand?: { id: number; name: string }
    articleType?: { id: number; name: string }
}

export interface PurchaseOrder {
    id: number
    po_number: string
    date?: string
    country?: string
    status?: string
    brand?: { id: number; name: string }
    articles?: PurchaseOrderArticleNested[]
}

export interface PurchaseOrderArticleNested {
    id: number
    article_color?: string
    order_quantity?: number
}

export interface POArticle {
    id: number
    article_color?: string
    order_quantity?: number
    purchaseOrder?: { po_number: string }
}

export interface MeasurementSpec {
    id: number
    code: string
    measurement: string
    tol_plus: number
    tol_minus: number
    side?: string
    article_id?: number
    unit?: string
    sizes: Array<{ size: string; value: number; unit?: string }>
}

export interface MeasurementResult {
    id?: number
    purchase_order_article_id: number
    measurement_id: number
    size: string
    article_style?: string
    measured_value: number | null
    expected_value?: number
    status: string
    operator_id?: number | null
    tol_plus?: number
    tol_minus?: number
}

export interface OperatorInfo {
    id: number
    full_name: string
    employee_id: string
    department: string
    contact_number?: string
}

export interface AnnotationResult {
    success: boolean
    source?: string
    message?: string
    error?: string
    annotation?: {
        id: number
        article_style: string
        size: string
        side: string
        color?: string
        annotation_data: any
        image_width: number
        image_height: number
        reference_image_data?: string
        reference_image_mime_type?: string
    }
    reference_image?: {
        data: string
        mime_type: string
        data_url: string
        width: number
        height: number
    } | null
}

interface GraphQLResponse<T = any> {
    data?: T
    errors?: Array<{ message: string; extensions?: any }>
}

// ─── GraphQL API Client ───────────────────────────────────────────────────────

class MagicQCApiClient {
    private graphqlUrl: string
    private baseUrl: string
    private apiKey: string

    constructor(graphqlUrl?: string, baseUrl?: string, apiKey?: string) {
        this.graphqlUrl = graphqlUrl || MAGICQC_API_URL
        this.baseUrl = baseUrl || MAGICQC_API_BASE
        this.apiKey = apiKey || MAGICQC_API_KEY
    }

    // ──── Core GraphQL method ────────────────────────────────────────────────

    private async query<T = any>(
        graphqlQuery: string,
        variables?: Record<string, any>
    ): Promise<GraphQLResponse<T>> {
        const MAX_RETRIES = 2
        const RETRY_DELAYS = [2000, 5000] // ms
        let lastError: Error | null = null

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout (increased for slow networks)

            try {
                const response = await fetch(this.graphqlUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': this.apiKey,
                    },
                    body: JSON.stringify({ query: graphqlQuery, variables }),
                    signal: controller.signal,
                })

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
                }

                const result: GraphQLResponse<T> = await response.json()

                if (result.errors && result.errors.length > 0) {
                    const messages = result.errors.map(e => e.message).join('; ')
                    // GraphQL schema/validation errors — do NOT retry (won't resolve)
                    throw new Error(`GraphQL Error: ${messages}`)
                }

                return result
            } catch (error: any) {
                clearTimeout(timeout)

                // GraphQL errors are not retryable (schema/validation issues)
                if (error.message?.startsWith('GraphQL Error:')) {
                    throw error
                }

                lastError = error

                // Network errors — retry with backoff
                const isNetworkError =
                    error.name === 'AbortError' ||
                    error.message?.includes('ECONNREFUSED') ||
                    error.message?.includes('ETIMEDOUT') ||
                    error.message?.includes('fetch failed') ||
                    error.message?.includes('network')

                if (isNetworkError && attempt < MAX_RETRIES) {
                    const delay = RETRY_DELAYS[attempt] || 5000
                    console.log(`[API] ⚠️ Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error.message}. Retrying in ${delay / 1000}s...`)
                    await new Promise(resolve => setTimeout(resolve, delay))
                    continue
                }

                if (error.name === 'AbortError') {
                    throw new Error('GraphQL request timed out (30s). Server may be unreachable.')
                }
                throw error
            } finally {
                clearTimeout(timeout)
            }
        }

        throw lastError || new Error('All retry attempts failed')
    }

    // ──── Core REST method (for endpoints that remain REST) ──────────────────

    private async restRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`
        const headers: Record<string, string> = {
            'X-API-Key': this.apiKey,
            'Accept': 'application/json',
        }

        if (options.body && typeof options.body === 'string') {
            headers['Content-Type'] = 'application/json'
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout for REST (annotation payloads can be large)

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...headers,
                    ...(options.headers as Record<string, string> || {}),
                },
                signal: controller.signal,
            })

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: response.statusText }))
                throw new Error(error.message || `HTTP ${response.status}`)
            }

            return response.json()
        } catch (error: any) {
            if (error.name === 'AbortError') {
                throw new Error(`REST request timed out (30s): ${endpoint}`)
            }
            throw error
        } finally {
            clearTimeout(timeout)
        }
    }

    // ──── Connection (REST — stays as REST per guide §9) ─────────────────────

    async ping(): Promise<{ success: boolean; authenticated?: boolean; server_time?: string }> {
        return this.restRequest('/api/camera/ping')
    }

    // ──── Brands (GraphQL) ───────────────────────────────────────────────────

    async getBrands(): Promise<Brand[]> {
        // Only return brands that have at least one Active purchase order
        const { data } = await this.query<{
            purchaseOrders: Array<{ id: string; status: string; brand: { id: string; name: string } }>
        }>(`{
            purchaseOrders {
                id status brand { id name }
            }
        }`)

        const activePOs = (data?.purchaseOrders || []).filter(po => po.status === 'Active')

        // Deduplicate brands by ID
        const brandMap = new Map<number, Brand>()
        for (const po of activePOs) {
            const brandId = parseInt(po.brand.id)
            if (!brandMap.has(brandId)) {
                brandMap.set(brandId, { id: brandId, name: po.brand.name })
            }
        }

        return Array.from(brandMap.values())
    }

    // ──── Article Types (GraphQL) ────────────────────────────────────────────

    async getArticleTypes(brandId?: number): Promise<ArticleType[]> {
        if (!brandId) {
            // No brand selected — return all article types
            const { data } = await this.query<{ articleTypes: Array<{ id: string; name: string }> }>(`
                { articleTypes { id name } }
            `)
            return (data?.articleTypes || []).map(t => ({ id: parseInt(t.id), name: t.name }))
        }

        // GraphQL articleTypes has no brand filter, so we derive types
        // from the articles that belong to this brand
        const { data } = await this.query<{
            articles: Array<{
                articleType?: { id: string; name: string } | null
            }>
        }>(`{
            articles(brand_id: ${brandId}) {
                articleType { id name }
            }
        }`)

        // Extract unique article types
        const typeMap = new Map<number, ArticleType>()
        for (const article of data?.articles || []) {
            if (article.articleType) {
                const id = parseInt(article.articleType.id)
                if (!typeMap.has(id)) {
                    typeMap.set(id, { id, name: article.articleType.name })
                }
            }
        }
        return Array.from(typeMap.values())
    }

    // ──── Articles (GraphQL) ─────────────────────────────────────────────────

    async getArticlesFiltered(brandId: number, typeId?: number | null): Promise<ArticleFiltered[]> {
        const filters: string[] = [`brand_id: ${brandId}`]
        if (typeId) filters.push(`article_type_id: ${typeId}`)
        const args = `(${filters.join(', ')})`

        const { data } = await this.query<{
            articles: Array<{
                id: string; article_style: string; description?: string
                brand?: { id: string; name: string }
                articleType?: { id: string; name: string }
            }>
        }>(`{
            articles${args} {
                id article_style description
                brand { id name }
                articleType { id name }
            }
        }`)

        return (data?.articles || []).map(a => ({
            id: parseInt(a.id),
            article_style: a.article_style,
            description: a.description,
            brand_id: a.brand ? parseInt(a.brand.id) : 0,
            article_type_id: a.articleType ? parseInt(a.articleType.id) : 0,
            brand: a.brand ? { id: parseInt(a.brand.id), name: a.brand.name } : undefined,
            articleType: a.articleType ? { id: parseInt(a.articleType.id), name: a.articleType.name } : undefined,
        }))
    }

    // ──── Purchase Orders (GraphQL) ──────────────────────────────────────────

    async getPurchaseOrders(brandId: number): Promise<PurchaseOrder[]> {
        const { data } = await this.query<{
            purchaseOrders: Array<{
                id: string; po_number: string; date?: string; country?: string; status?: string
                brand?: { id: string; name: string }
                articles?: Array<{ id: string; article_color?: string; order_quantity?: number }>
            }>
        }>(`{
            purchaseOrders(brand_id: ${brandId}) {
                id po_number date country status
                brand { id name }
                articles { id article_color order_quantity }
            }
        }`)

        return (data?.purchaseOrders || []).map(po => ({
            id: parseInt(po.id),
            po_number: po.po_number,
            date: po.date,
            country: po.country,
            status: po.status,
            brand: po.brand ? { id: parseInt(po.brand.id), name: po.brand.name } : undefined,
            articles: (po.articles || []).map(a => ({
                id: parseInt(a.id),
                article_color: a.article_color,
                order_quantity: a.order_quantity,
            })),
        }))
    }

    // ──── All Purchase Orders — no brand filter (GraphQL) ────────────────────

    async getAllPurchaseOrders(status?: string): Promise<PurchaseOrder[]> {
        const filters: string[] = []
        if (status && status !== 'All') filters.push(`status: "${status}"`)
        const args = filters.length ? `(${filters.join(', ')})` : ''

        const { data } = await this.query<{
            purchaseOrders: Array<{
                id: string; po_number: string; date?: string; country?: string; status?: string
                brand?: { id: string; name: string }
            }>
        }>(`{
            purchaseOrders${args} {
                id po_number date country status
                brand { id name }
            }
        }`)

        return (data?.purchaseOrders || []).map(po => ({
            id: parseInt(po.id),
            po_number: po.po_number,
            date: po.date,
            country: po.country,
            status: po.status,
            brand: po.brand ? { id: parseInt(po.brand.id), name: po.brand.name } : undefined,
        }))
    }

    // ──── PO Articles (GraphQL) ──────────────────────────────────────────────

    async getPOArticles(poId: number): Promise<POArticle[]> {
        const { data } = await this.query<{
            purchaseOrderArticles: Array<{
                id: string; article_color?: string; order_quantity?: number
            }>
        }>(`{
            purchaseOrderArticles(purchase_order_id: ${poId}) {
                id article_color order_quantity
            }
        }`)

        return (data?.purchaseOrderArticles || []).map(a => ({
            id: parseInt(a.id),
            article_color: a.article_color,
            order_quantity: a.order_quantity,
        }))
    }

    // ──── Measurement Specs (GraphQL) ────────────────────────────────────────

    async getMeasurementSpecs(articleId: number, size: string): Promise<MeasurementSpec[]> {
        // Try fetching with unit field first; if schema doesn't have it, retry without
        let data: any = null
        let hasUnitField = true

        try {
            const result = await this.query<{
                measurements: Array<{
                    id: string; code: string; measurement: string
                    tol_plus: number; tol_minus: number; side?: string; unit?: string
                    sizes: Array<{ size: string; value: number; unit?: string }>
                }>
            }>(`{
                measurements(article_id: ${articleId}) {
                    id code measurement tol_plus tol_minus side unit
                    sizes { size value unit }
                }
            }`)
            data = result.data
        } catch (err: any) {
            // If GraphQL rejects 'unit' field, retry without it
            if (err?.message?.includes('unit')) {
                console.log('[SPECS] "unit" field not in GraphQL schema — retrying without it')
                hasUnitField = false
                const result = await this.query<{
                    measurements: Array<{
                        id: string; code: string; measurement: string
                        tol_plus: number; tol_minus: number; side?: string
                        sizes: Array<{ size: string; value: number }>
                    }>
                }>(`{
                    measurements(article_id: ${articleId}) {
                        id code measurement tol_plus tol_minus side
                        sizes { size value }
                    }
                }`)
                data = result.data
            } else {
                throw err
            }
        }

        console.log(`[SPECS] getMeasurementSpecs(article=${articleId}, size=${size}) → ${(data?.measurements || []).length} measurements, unitField=${hasUnitField}`)
        if (data?.measurements?.[0]) {
            console.log('[SPECS] Sample measurement keys:', Object.keys(data.measurements[0]).join(', '))
            console.log('[SPECS] Sample measurement unit:', (data.measurements[0] as any).unit ?? '(not present)')
            if (data.measurements[0].sizes?.[0]) {
                console.log('[SPECS] Sample size keys:', Object.keys(data.measurements[0].sizes[0]).join(', '))
                console.log('[SPECS] Sample size unit:', (data.measurements[0].sizes[0] as any).unit ?? '(not present)')
            }
        }

        // Filter sizes to the requested size and flatten into spec format
        return (data?.measurements || []).map((m: any) => {
            const sizeEntry = m.sizes.find((s: any) => s.size === size)
            // Unit priority: measurement-level unit → size-level unit → undefined (show no label)
            const resolvedUnit = m.unit || sizeEntry?.unit || undefined
            return {
                id: parseInt(m.id),
                measurement_id: parseInt(m.id),
                code: m.code,
                measurement: m.measurement,
                expected_value: sizeEntry?.value ?? 0,
                tol_plus: m.tol_plus,
                tol_minus: m.tol_minus,
                side: m.side,
                article_id: articleId,
                unit: resolvedUnit,
                size,
                sizes: m.sizes,
            }
        }).filter((spec: any) => {
            // Only return specs that have a value for the requested size
            const sizeEntry = spec.sizes.find((s: any) => s.size === size)
            return sizeEntry !== undefined
        })
    }

    // ──── Available Sizes (GraphQL) ──────────────────────────────────────────

    async getAvailableSizes(articleId: number): Promise<string[]> {
        const { data } = await this.query<{
            measurements: Array<{
                sizes: Array<{ size: string }>
            }>
        }>(`{
            measurements(article_id: ${articleId}) {
                sizes { size }
            }
        }`)

        // Collect all unique sizes across all measurements
        const sizeSet = new Set<string>()
        for (const m of data?.measurements || []) {
            for (const s of m.sizes) {
                sizeSet.add(s.size)
            }
        }
        return Array.from(sizeSet)
    }

    // ──── Measurement Results — Load (GraphQL) ─────────────────────────────────

    async getMeasurementResults(poArticleId: number, size: string): Promise<MeasurementResult[]> {
        // Note: measurementResults query may not exist on all server versions.
        // Gracefully return empty if the query fails.
        try {
            const { data } = await this.query<{
                measurementResults: Array<{
                    id: string; purchase_order_article_id: string; measurement_id: string
                    size: string; article_style?: string
                    measured_value: number | null; expected_value?: number
                    tol_plus?: number; tol_minus?: number; status: string
                    operator_id?: string | null
                }>
            }>(`{
                measurementResults(purchase_order_article_id: ${poArticleId}, size: "${size}") {
                    id purchase_order_article_id measurement_id size article_style
                    measured_value expected_value tol_plus tol_minus status operator_id
                }
            }`)

            return (data?.measurementResults || []).map(r => ({
                id: parseInt(r.id),
                purchase_order_article_id: parseInt(r.purchase_order_article_id),
                measurement_id: parseInt(r.measurement_id),
                size: r.size,
                article_style: r.article_style,
                measured_value: r.measured_value,
                expected_value: r.expected_value,
                tol_plus: r.tol_plus,
                tol_minus: r.tol_minus,
                status: r.status,
                operator_id: r.operator_id ? parseInt(r.operator_id) : null,
            }))
        } catch (error) {
            console.warn('[API] measurementResults query failed (may not exist on server), returning empty:', error)
            return []
        }
    }

    // ──── Measurement Results — Save (GraphQL mutation) ──────────────────────

    async saveMeasurementResults(results: Array<{
        purchase_order_article_id: number
        measurement_id: number
        size: string
        article_style?: string
        measured_value: number | null
        expected_value?: number
        tol_plus?: number
        tol_minus?: number
        status: string
        operator_id: number | null
    }>): Promise<{ success: boolean; message?: string; count: number }> {
        const resultsStr = JSON.stringify(results)
            .replace(/"(\w+)":/g, '$1:')  // Convert to GraphQL input format

        const { data } = await this.query<{
            upsertMeasurementResults: { success: boolean; message: string; count: number }
        }>(`
            mutation {
                upsertMeasurementResults(results: ${resultsStr}) {
                    success message count
                }
            }
        `)

        return data?.upsertMeasurementResults || { success: false, count: 0 }
    }

    // ──── Measurement Results Detailed — Save with side (GraphQL mutation) ───

    async saveMeasurementResultsDetailed(input: {
        purchase_order_article_id: number
        size: string
        side: string
        results: Array<{
            measurement_id: number
            article_style?: string
            measured_value: number
            expected_value: number
            tol_plus: number
            tol_minus: number
            status: string
            operator_id: number | null
            // Extra fields from frontend are stripped before sending
            [key: string]: any
        }>
    }): Promise<{ success: boolean; message?: string; count?: number }> {
        // Strip fields that are top-level args, not part of DetailedResultInput
        const cleanResults = input.results.map(r => ({
            measurement_id: r.measurement_id,
            article_style: r.article_style,
            measured_value: r.measured_value,
            expected_value: r.expected_value,
            tol_plus: r.tol_plus,
            tol_minus: r.tol_minus,
            status: r.status,
            operator_id: r.operator_id,
        }))

        const resultsStr = JSON.stringify(cleanResults)
            .replace(/"(\w+)":/g, '$1:')

        const { data } = await this.query<{
            upsertMeasurementResultsDetailed: { success: boolean; message: string; count: number }
        }>(`
            mutation {
                upsertMeasurementResultsDetailed(
                    purchase_order_article_id: ${input.purchase_order_article_id}
                    size: "${input.size}"
                    side: "${input.side}"
                    results: ${resultsStr}
                ) { success message count }
            }
        `)

        return data?.upsertMeasurementResultsDetailed || { success: false }
    }

    // ──── Measurement Sessions (GraphQL mutation) ────────────────────────────

    async saveMeasurementSession(session: {
        purchase_order_article_id: number
        size: string
        article_style?: string
        article_id?: number
        purchase_order_id?: number
        operator_id?: number
        status?: string
        front_side_complete?: boolean
        back_side_complete?: boolean
        front_qc_result?: string | null
        back_qc_result?: string | null
    }): Promise<{ success: boolean; message?: string }> {
        const args = Object.entries(session)
            .filter(([_, v]) => v !== undefined && v !== null)
            .map(([k, v]) => typeof v === 'string' ? `${k}: "${v}"` : `${k}: ${v}`)
            .join('\n            ')

        const { data } = await this.query<{
            upsertMeasurementSession: { success: boolean; message: string }
        }>(`
            mutation {
                upsertMeasurementSession(
                    ${args}
                ) { success message }
            }
        `)

        return data?.upsertMeasurementSession || { success: false }
    }

    // ──── Operator PIN Verification (GraphQL mutation) ───────────────────────
    //
    // The backend verifyPin mutation requires TWO separate fields:
    //   employee_id  — the operator's DB employee_id (e.g. "2691")
    //   pin          — the 4-digit PIN set in Admin Panel (e.g. "0002")
    //
    // The login screen only collects the PIN, so we:
    //   1. Fetch all operators to get their employee_ids
    //   2. Try verifyPin(employee_id, pin) for each until one succeeds
    //   3. This matches the PIN against the correct operator in real-time

    async verifyPin(pin: string): Promise<{
        success: boolean
        operator?: OperatorInfo
        message?: string
    }> {
        console.log(`[AUTH] verifyPin called with pin: ****`)
        console.log(`[AUTH] GraphQL endpoint: ${this.graphqlUrl}`)

        // Step 1: Fetch all operators to get their employee_ids
        let operators: OperatorInfo[] = []
        try {
            operators = await this.getOperators()
            console.log(`[AUTH] Fetched ${operators.length} operators: ${operators.map(o => `${o.full_name}(${o.employee_id})`).join(', ')}`)
        } catch (err) {
            console.error('[AUTH] Failed to fetch operators list:', err)
        }

        // Step 2: Try verifyPin for each operator's employee_id with the entered PIN
        for (const op of operators) {
            console.log(`[AUTH] Trying verifyPin(employee_id: "${op.employee_id}", pin: "****") for ${op.full_name}...`)
            try {
                const { data } = await this.query<{
                    verifyPin: {
                        success: boolean
                        message: string
                        operator: { id: string; full_name: string; employee_id: string; department: string } | null
                    }
                }>(`
                    mutation {
                        verifyPin(employee_id: "${op.employee_id}", pin: "${pin}") {
                            success message
                            operator { id full_name employee_id department }
                        }
                    }
                `)

                const result = data?.verifyPin
                console.log(`[AUTH] verifyPin response for ${op.employee_id}:`, JSON.stringify(result, null, 2))

                if (result?.success && result.operator) {
                    console.log(`[AUTH] ✅ PIN matched operator: ${result.operator.full_name}`)
                    return {
                        success: true,
                        message: result.message,
                        operator: {
                            id: parseInt(result.operator.id),
                            full_name: result.operator.full_name,
                            employee_id: result.operator.employee_id,
                            department: result.operator.department,
                        },
                    }
                }
            } catch (err) {
                console.error(`[AUTH] Error verifying against ${op.employee_id}:`, err)
            }
        }

        // Step 3: If no operator matched, try the PIN directly as employee_id (legacy fallback)
        if (operators.length === 0) {
            console.log(`[AUTH] No operators fetched — trying PIN as employee_id directly...`)
            try {
                const { data } = await this.query<{
                    verifyPin: {
                        success: boolean
                        message: string
                        operator: { id: string; full_name: string; employee_id: string; department: string } | null
                    }
                }>(`
                    mutation {
                        verifyPin(employee_id: "${pin}", pin: "${pin}") {
                            success message
                            operator { id full_name employee_id department }
                        }
                    }
                `)

                const result = data?.verifyPin
                if (result?.success && result.operator) {
                    return {
                        success: true,
                        message: result.message,
                        operator: {
                            id: parseInt(result.operator.id),
                            full_name: result.operator.full_name,
                            employee_id: result.operator.employee_id,
                            department: result.operator.department,
                        },
                    }
                }
            } catch (err) {
                console.error('[AUTH] Direct PIN-as-employee_id attempt failed:', err)
            }
        }

        console.log(`[AUTH] ❌ No operator matched PIN across ${operators.length} operators`)
        return { success: false, message: 'Invalid PIN. Please try again.' }
    }

    // ──── Operators List (GraphQL) ───────────────────────────────────────────

    async getOperators(): Promise<OperatorInfo[]> {
        const { data } = await this.query<{
            operators: Array<{
                id: string; full_name: string; employee_id: string; department: string; contact_number?: string
            }>
        }>(`{
            operators { id full_name employee_id department contact_number }
        }`)

        return (data?.operators || []).map(o => ({
            id: parseInt(o.id),
            full_name: o.full_name,
            employee_id: o.employee_id,
            department: o.department,
            contact_number: o.contact_number,
        }))
    }

    // ──── Annotations (REST — stays REST per guide §9) ──────────────────────

    async operatorFetch(
        articleStyle: string,
        size: string,
        side: string = 'front',
        color?: string
    ): Promise<AnnotationResult> {
        const params = new URLSearchParams({
            article_style: articleStyle,
            size,
            side,
        })
        if (color) params.append('color', color)
        return this.restRequest(`/api/uploaded-annotations/operator-fetch?${params}`)
    }

    // ──── Image fetch base64 (REST — stays REST per guide §9) ────────────────

    async fetchImageBase64(
        articleStyle: string,
        size: string,
        side: string = 'front'
    ): Promise<{ success: boolean; image?: { data: string; mime_type: string; width: number; height: number } }> {
        return this.restRequest(
            `/api/uploaded-annotations/fetch-image-base64?article_style=${encodeURIComponent(articleStyle)}&size=${encodeURIComponent(size)}&side=${side}`
        )
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const apiClient = new MagicQCApiClient()
export { MagicQCApiClient }
