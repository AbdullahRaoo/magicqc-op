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
    sizes: Array<{ size: string; value: number }>
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
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 20000) // 20s timeout

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
                throw new Error(`GraphQL Error: ${messages}`)
            }

            return result
        } catch (error: any) {
            if (error.name === 'AbortError') {
                throw new Error('GraphQL request timed out (20s). Server may be unreachable.')
            }
            throw error
        } finally {
            clearTimeout(timeout)
        }
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
        const { data } = await this.query<{
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

        // Filter sizes to the requested size and flatten into spec format
        return (data?.measurements || []).map(m => {
            const sizeEntry = m.sizes.find(s => s.size === size)
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
                size,
                sizes: m.sizes,
            }
        }).filter(spec => {
            // Only return specs that have a value for the requested size
            const sizeEntry = spec.sizes.find(s => s.size === size)
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

    async verifyPin(pin: string, employeeId?: string): Promise<{
        success: boolean
        operator?: OperatorInfo
        message?: string
    }> {
        // If employee_id provided, use it; otherwise search by pin only
        const args = employeeId
            ? `employee_id: "${employeeId}", pin: "${pin}"`
            : `pin: "${pin}"`

        const { data } = await this.query<{
            verifyPin: {
                success: boolean
                message: string
                operator: { id: string; full_name: string; employee_id: string; department: string } | null
            }
        }>(`
            mutation {
                verifyPin(${args}) {
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
        return { success: false, message: result?.message || 'Invalid PIN' }
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
