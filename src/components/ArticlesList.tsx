import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import type {
  ArticleWithRelations,
  MeasurementSpec,
  JobCardSummary,
  PurchaseOrderArticle,
  Brand
} from '../types/database'

interface ArticleType {
  id: number
  name: string
}

interface PurchaseOrder {
  id: number
  po_number: string
  brand_id: number
  country: string
}

interface POArticle extends PurchaseOrderArticle {
  po_number: string
  brand_name: string
  article_type_name: string
  country: string
}

export function ArticlesList() {
  // Basic states
  const [error, setError] = useState<string | null>(null)

  // Article color selection state
  const [selectedColor, setSelectedColor] = useState<'white' | 'other' | 'black' | null>(null)

  // Unit display toggle: 'cm' (default) or 'inch' — purely visual, all internal values stay in cm
  const [displayUnit, setDisplayUnit] = useState<'cm' | 'inch'>('cm')
  const CM_TO_INCH = 0.393701
  /** Convert a cm numeric value to the active display unit, rounded to 2 decimals */
  const toDisplayUnit = (cmValue: number): string => {
    if (displayUnit === 'inch') return (cmValue * CM_TO_INCH).toFixed(2)
    return cmValue.toFixed(2)
  }
  /** Display label for tolerance: ±val in current unit */
  const tolDisplay = (cmValue: number): string => {
    if (displayUnit === 'inch') return (cmValue * CM_TO_INCH).toFixed(2)
    return cmValue.toFixed(2)
  }

  // Auto-dismiss error after 6 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 6000)
      return () => clearTimeout(timer)
    }
  }, [error])

  // Selection states
  const [brands, setBrands] = useState<Brand[]>([])
  const [failedLogos, setFailedLogos] = useState<Set<number>>(new Set())
  const [articleTypes, setArticleTypes] = useState<ArticleType[]>([])
  const [articles, setArticles] = useState<ArticleWithRelations[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [poArticles, setPOArticles] = useState<POArticle[]>([])

  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null)
  const [selectedArticleTypeId, setSelectedArticleTypeId] = useState<number | null>(null)
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null)
  const [selectedPOId, setSelectedPOId] = useState<number | null>(null)
  const [selectedPOArticleId, setSelectedPOArticleId] = useState<number | null>(null)
  const [selectedSize, setSelectedSize] = useState<string | null>(null) // Nothing selected initially

  // Available sizes - loaded dynamically from database based on article
  const [availableSizes, setAvailableSizes] = useState<string[]>([])

  // Job Card Summary
  const [jobCardSummary, setJobCardSummary] = useState<JobCardSummary | null>(null)

  // Measurement states
  const [measurementSpecs, setMeasurementSpecs] = useState<MeasurementSpec[]>([])
  const [measuredValues, setMeasuredValues] = useState<Record<number, string>>({})
  const [isMeasurementEnabled, setIsMeasurementEnabled] = useState(false)

  // Live measurement lifecycle states
  const [isPollingActive, setIsPollingActive] = useState(false)
  const [measurementComplete, setMeasurementComplete] = useState(false)
  const [editableTols, setEditableTols] = useState<Record<number, { tol_plus: string; tol_minus: string }>>({})

  // Measurement tick selection - tracks which measurements are selected for live camera measurement
  const [selectedMeasurementIds, setSelectedMeasurementIds] = useState<Set<number>>(new Set())
  const selectedMeasurementIdsRef = useRef<Set<number>>(new Set())

  // Auto-shift lock: true = measurement mode active, rows are sorted (selected first)
  const [isShiftLocked, setIsShiftLocked] = useState(false)

  // Current PO articles for navigation
  const [currentPOArticleIndex, setCurrentPOArticleIndex] = useState(0)

  // Saving state
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingNextArticle, setIsSavingNextArticle] = useState(false)

  // Calibration state
  const [calibrationStatus, setCalibrationStatus] = useState<{
    calibrated: boolean
    pixels_per_cm?: number
    calibration_date?: string
  } | null>(null)
  const [isCalibrating, setIsCalibrating] = useState(false)

  // QC Result popup state
  const [showQCResult, setShowQCResult] = useState(false)
  const [qcPassed, setQcPassed] = useState(true)
  const [failedMeasurements, setFailedMeasurements] = useState<{ code: string, measurement: string, expected: number, actual: number }[]>([])

  // Front/Back side measurement tracking
  const [currentMeasurementSide, setCurrentMeasurementSide] = useState<'front' | 'back' | null>(null)
  const [frontMeasuredValues, setFrontMeasuredValues] = useState<Record<number, string>>({})
  const [backMeasuredValues, setBackMeasuredValues] = useState<Record<number, string>>({})
  const [frontSideComplete, setFrontSideComplete] = useState(false)
  const [backSideComplete, setBackSideComplete] = useState(false)

  // Per-side snapshot of which POM IDs were checked at measurement time
  const [frontSelectedIds, setFrontSelectedIds] = useState<Set<number>>(new Set())
  const [backSelectedIds, setBackSelectedIds] = useState<Set<number>>(new Set())
  
  // QC check tracking for each side
  const [frontQCChecked, setFrontQCChecked] = useState(false)
  const [backQCChecked, setBackQCChecked] = useState(false)
  const [lastQCSide, setLastQCSide] = useState<'front' | 'back' | null>(null)

  const { operator } = useAuth()

  // Fetch brands on mount
  useEffect(() => {
    fetchBrands()
    // Don't fetch article types on mount - wait for brand selection

    // DIAGNOSTIC: Check database state on mount
    const runDiagnostics = async () => {
      console.log('====== DATABASE DIAGNOSTICS ======')

      // Check articles
      const articlesResult = await window.database.query<any>(
        `SELECT a.id, a.article_style, a.brand_id, a.article_type_id, b.name as brand, at.name as article_type
         FROM articles a
         LEFT JOIN brands b ON a.brand_id = b.id
         LEFT JOIN article_types at ON a.article_type_id = at.id`
      )
      console.log('[DIAG] Articles:', articlesResult.data)

      // Check measurements
      const measurementsResult = await window.database.query<any>(
        `SELECT m.id, m.code, m.measurement, m.article_id, a.article_style
         FROM measurements m
         LEFT JOIN articles a ON m.article_id = a.id`
      )
      console.log('[DIAG] Measurements:', measurementsResult.data)

      // Check measurement sizes
      const sizesResult = await window.database.query<any>(
        `SELECT ms.measurement_id, ms.size, ms.value, m.code
         FROM measurement_sizes ms
         LEFT JOIN measurements m ON ms.measurement_id = m.id
         LIMIT 30`
      )
      console.log('[DIAG] Measurement Sizes (first 30):', sizesResult.data)

      // Check purchase orders
      const posResult = await window.database.query<any>(
        `SELECT po.id, po.po_number, po.brand_id, b.name as brand
         FROM purchase_orders po
         LEFT JOIN brands b ON po.brand_id = b.id`
      )
      console.log('[DIAG] Purchase Orders:', posResult.data)

      // Check PO articles
      const poArticlesResult = await window.database.query<any>(
        `SELECT poa.id, poa.purchase_order_id, poa.article_style, poa.article_type_id, at.name as article_type
         FROM purchase_order_articles poa
         LEFT JOIN article_types at ON poa.article_type_id = at.id`
      )
      console.log('[DIAG] PO Articles:', poArticlesResult.data)

      console.log('====== END DIAGNOSTICS ======')
    }

    runDiagnostics()
  }, [])

  // Fetch article types when brand changes
  useEffect(() => {
    if (selectedBrandId) {
      fetchArticleTypes() // Filtered by brand
    } else {
      setArticleTypes([])
      setArticles([])
    }
  }, [selectedBrandId])

  // Fetch articles when brand or article type changes
  useEffect(() => {
    if (selectedBrandId) {
      fetchArticles() // Filtered by brand AND article type if selected
    } else {
      setArticles([])
    }
  }, [selectedBrandId, selectedArticleTypeId])

  // Fetch POs when article is selected - filter to POs that contain this article style
  useEffect(() => {
    if (selectedBrandId && selectedArticleId) {
      fetchPurchaseOrdersForArticle()
    } else if (selectedBrandId) {
      // If no article selected, show all POs for brand
      fetchPurchaseOrders()
    } else {
      setPurchaseOrders([])
    }
  }, [selectedBrandId, selectedArticleId])

  // Update job card summary when selections change
  useEffect(() => {
    updateJobCardSummary()
  }, [selectedPOId, selectedBrandId, selectedArticleId, selectedArticleTypeId])

  // Load PO articles when PO is selected
  useEffect(() => {
    if (selectedPOId) {
      fetchPOArticles()

    } else {
      setPOArticles([])

      setIsMeasurementEnabled(false)
    }
  }, [selectedPOId])

  // Load measurement specs when article and size change (direct article selection)
  useEffect(() => {
    // Only run if we have a selected article and size, but no PO article yet
    // This allows measurements to show as soon as article + size is selected
    if (selectedArticleId && selectedSize && !selectedPOArticleId) {
      console.log('[EFFECT] Article + Size changed, loading measurements directly')
      loadMeasurementsDirectlyFromArticle(selectedArticleId, selectedSize)
    }
  }, [selectedArticleId, selectedSize])

  // Load measurement specs when PO article and size change (PO-based selection)
  useEffect(() => {
    if (selectedPOArticleId && selectedSize) {
      // If we have selectedArticleId, use it directly (more reliable)
      if (selectedArticleId) {
        console.log('[EFFECT] PO Article selected but using direct article ID for measurements')
        loadMeasurementsDirectlyFromArticle(selectedArticleId, selectedSize)
      } else {
        console.log('[EFFECT] PO Article selected, using fetchMeasurementSpecs')
        fetchMeasurementSpecs()
      }
    } else if (!selectedArticleId) {
      // Only clear if we don't have a direct article selection
      setMeasurementSpecs([])
      setMeasuredValues({})
    }
  }, [selectedPOArticleId, selectedSize])

  // Auto-save logic during live measurement (Industry 4.0 Persistence)
  useEffect(() => {
    if (isPollingActive && Object.keys(measuredValues).length > 0) {
      const handler = setTimeout(() => {
        saveMeasurements()
      }, 2000) // Debounce save every 2 seconds during live flow
      return () => clearTimeout(handler)
    }
  }, [measuredValues, isPollingActive])

  // Auto-select all measurements when specs change
  useEffect(() => {
    if (measurementSpecs.length > 0) {
      const allIds = new Set(measurementSpecs.map(s => s.id))
      setSelectedMeasurementIds(allIds)
      selectedMeasurementIdsRef.current = allIds
    } else {
      setSelectedMeasurementIds(new Set())
      selectedMeasurementIdsRef.current = new Set()
    }
  }, [measurementSpecs])

  // Keep ref in sync with state for use in polling interval
  useEffect(() => {
    selectedMeasurementIdsRef.current = selectedMeasurementIds
  }, [selectedMeasurementIds])

  // Poll for live results when polling is active
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>

    if (isPollingActive && measurementSpecs.length > 0) {
      console.log('[POLLING] Starting live measurement polling...')
      console.log('[POLLING] Measurement specs:', measurementSpecs.map((s, idx) => ({
        index: idx,
        specId: s.id,
        code: s.code
      })))

      intervalId = setInterval(async () => {
        try {
          const result = await window.measurement.getLiveResults()

          if (result.status === 'success' && result.data && result.data.measurements) {
            const liveData = result.data.measurements as Array<{
              id: number
              name: string
              actual_cm: number
              qc_passed: boolean
              spec_id?: number
              spec_code?: string
            }>

            console.log('[POLLING] Received', liveData.length, 'live measurements, is_live:', result.data.is_live)

            setMeasuredValues(prev => {
              const newValues = { ...prev }
              let updated = false

              liveData.forEach((liveMeasurement) => {
                let spec: typeof measurementSpecs[0] | undefined

                // PRIMARY MATCH: by spec_id (database ID) - most reliable
                if (liveMeasurement.spec_id) {
                  spec = measurementSpecs.find(s => s.id === liveMeasurement.spec_id)
                }

                // SECONDARY MATCH: by spec_code (e.g., 'A', 'B')
                if (!spec && liveMeasurement.spec_code) {
                  spec = measurementSpecs.find(s => s.code === liveMeasurement.spec_code)
                }

                // FALLBACK MATCH: by pair position (id - 1 as index into specs)
                if (!spec) {
                  const specIndex = liveMeasurement.id - 1
                  if (specIndex >= 0 && specIndex < measurementSpecs.length) {
                    spec = measurementSpecs[specIndex]
                  }
                }

                if (spec) {
                  // Only update selected (ticked) measurements with live camera values
                  if (!selectedMeasurementIdsRef.current.has(spec.id)) return

                  const newValue = liveMeasurement.actual_cm.toFixed(2)

                  if (newValues[spec.id] !== newValue) {
                    console.log(`[POLLING] ${spec.code} "${spec.measurement}" (id=${spec.id}): ${prev[spec.id] || 'empty'} -> ${newValue} cm`)
                    newValues[spec.id] = newValue
                    updated = true
                  }
                }
              })

              if (updated) {
                console.log('[POLLING] Updated values:', Object.keys(newValues).length, 'measurements')
              }
              return updated ? newValues : prev
            })
          } else if (result.status === 'success' && !result.data) {
            console.log('[POLLING] No live measurements available yet')
          } else {
            console.log('[POLLING] API returned:', result.status, result.message)
          }
        } catch (err) {
          console.error('[POLLING] Error:', err)
        }
      }, 500) // Poll every 500ms for smooth updates
    }

    return () => {
      if (intervalId) {
        console.log('[POLLING] Stopping live measurement polling')
        clearInterval(intervalId)
      }
    }
  }, [isPollingActive, measurementSpecs])

  const fetchBrands = async () => {
    try {
      // Only show brands that have active purchase orders
      const result = await window.database.query<Brand>(
        `SELECT DISTINCT b.id, b.name 
         FROM brands b
         JOIN purchase_orders po ON po.brand_id = b.id
         WHERE po.status = 'Active'
         ORDER BY b.name`
      )
      if (result.success && result.data) {
        setBrands(result.data)
        console.log('[BRANDS] Loaded', result.data.length, 'brands with active purchase orders')
      }
    } catch (err) {
      console.error('Failed to fetch brands:', err)
    }
  }

  const fetchArticleTypes = async () => {
    if (!selectedBrandId) {
      setArticleTypes([])
      return
    }
    try {
      // Only fetch article types that have articles for the selected brand
      const sql = `
        SELECT DISTINCT at.id, at.name
        FROM article_types at
        JOIN articles a ON a.article_type_id = at.id
        WHERE a.brand_id = ?
        ORDER BY at.name
      `
      const result = await window.database.query<ArticleType>(sql, [selectedBrandId])
      if (result.success && result.data) {
        setArticleTypes(result.data)
      }
    } catch (err) {
      console.error('Failed to fetch article types:', err)
    }
  }

  const fetchArticles = async () => {
    try {
      // Filter by both brand AND article type if article type is selected
      let sql: string
      let params: any[]

      if (selectedArticleTypeId) {
        sql = `
          SELECT 
            a.*,
            b.name as brand_name,
            at.name as article_type_name
          FROM articles a
          LEFT JOIN brands b ON a.brand_id = b.id
          LEFT JOIN article_types at ON a.article_type_id = at.id
          WHERE a.brand_id = ? AND a.article_type_id = ?
          ORDER BY a.article_style
        `
        params = [selectedBrandId, selectedArticleTypeId]
      } else {
        sql = `
          SELECT 
            a.*,
            b.name as brand_name,
            at.name as article_type_name
          FROM articles a
          LEFT JOIN brands b ON a.brand_id = b.id
          LEFT JOIN article_types at ON a.article_type_id = at.id
          WHERE a.brand_id = ?
          ORDER BY a.article_style
        `
        params = [selectedBrandId]
      }

      const result = await window.database.query<ArticleWithRelations>(sql, params)
      if (result.success && result.data) {
        setArticles(result.data)
        console.log('[ARTICLES] Loaded', result.data.length, 'articles for brand:', selectedBrandId, 'type:', selectedArticleTypeId)
      }
    } catch (err) {
      console.error('Failed to fetch articles:', err)
    }
  }

  const fetchPurchaseOrders = async () => {
    try {
      const sql = `
        SELECT DISTINCT po.id, po.po_number, po.brand_id, po.country
        FROM purchase_orders po
        WHERE po.brand_id = ? AND po.status = 'Active'
        ORDER BY po.po_number
      `
      const result = await window.database.query<PurchaseOrder>(sql, [selectedBrandId])
      if (result.success && result.data) {
        setPurchaseOrders(result.data)
        console.log('[PO] Loaded', result.data.length, 'POs for brand:', selectedBrandId)
      }
    } catch (err) {
      console.error('Failed to fetch purchase orders:', err)
    }
  }

  // Fetch POs that are linked to the selected article via purchase_order_articles
  const fetchPurchaseOrdersForArticle = async () => {
    if (!selectedArticleId || !selectedBrandId) return

    try {
      // Get the selected article's details
      const article = articles.find(a => a.id === selectedArticleId)
      if (!article) {
        console.log('[PO_ARTICLE] Article not found in state:', selectedArticleId)
        return
      }

      console.log('[PO_ARTICLE] Finding POs for article:', article.article_style, 'type:', article.article_type_id)

      // Find POs that have this article style and type in their purchase_order_articles
      const sql = `
        SELECT DISTINCT po.id, po.po_number, po.brand_id, po.country
        FROM purchase_orders po
        JOIN purchase_order_articles poa ON poa.purchase_order_id = po.id
        WHERE po.brand_id = ? 
          AND po.status = 'Active'
          AND poa.article_type_id = ?
          AND poa.article_style = ?
        ORDER BY po.po_number
      `
      const result = await window.database.query<PurchaseOrder>(sql, [
        selectedBrandId,
        article.article_type_id,
        article.article_style
      ])

      if (result.success && result.data) {
        console.log('[PO_ARTICLE] Found', result.data.length, 'POs linked to article:', article.article_style)
        setPurchaseOrders(result.data)

        // Auto-select if only one PO exists for this article
        if (result.data.length === 1) {
          console.log('[PO_ARTICLE] Auto-selecting single PO:', result.data[0].po_number)
          setSelectedPOId(result.data[0].id)
        } else if (result.data.length === 0) {
          // Fallback: show all POs for the brand if none linked to specific article
          console.log('[PO_ARTICLE] No POs linked to article, falling back to brand POs')
          fetchPurchaseOrders()
        }
      }
    } catch (err) {
      console.error('Failed to fetch purchase orders for article:', err)
      // Fallback to brand-level POs
      fetchPurchaseOrders()
    }
  }

  // Fetch available sizes for the current article from measurement_sizes table
  const fetchAvailableSizes = async (articleId: number) => {
    try {
      const sql = `
        SELECT DISTINCT ms.size
        FROM measurement_sizes ms
        JOIN measurements m ON ms.measurement_id = m.id
        WHERE m.article_id = ?
        ORDER BY FIELD(ms.size, 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL')
      `
      const result = await window.database.query<{ size: string }>(sql, [articleId])
      if (result.success && result.data && result.data.length > 0) {
        const sizes = result.data.map(r => r.size)
        console.log('[SIZES] Loaded available sizes:', sizes)
        setAvailableSizes(sizes)
        // Don't auto-select - let user choose
        // If currently selected size is not valid, clear it
        if (selectedSize && !sizes.includes(selectedSize)) {
          setSelectedSize(null)
        }
      } else {
        // No sizes found - clear available sizes
        setAvailableSizes([])
        setSelectedSize(null)
      }
    } catch (err) {
      console.error('Failed to fetch available sizes:', err)
      setAvailableSizes([])
    }
  }

  const updateJobCardSummary = () => {
    // Build job card from current selections
    const brand = brands.find(b => b.id === selectedBrandId)
    const article = articles.find(a => a.id === selectedArticleId)
    const articleType = articleTypes.find(at => at.id === selectedArticleTypeId)
    const po = purchaseOrders.find(p => p.id === selectedPOId)

    if (brand || article || po) {
      setJobCardSummary({
        po_number: po?.po_number || '',
        brand_name: brand?.name || '',
        article_type_name: articleType?.name || article?.article_type_name || '',
        country: po?.country || '',
        article_description: article?.description || null,
        article_style: article?.article_style || ''
      })
    } else {
      setJobCardSummary(null)
    }
  }

  const fetchPOArticles = async () => {
    if (!selectedPOId) return
    try {
      console.log('[PO_ARTICLES] Fetching for PO ID:', selectedPOId)
      const sql = `
        SELECT 
          poa.*,
          po.po_number,
          po.brand_id,
          b.name as brand_name,
          at.name as article_type_name,
          po.country
        FROM purchase_order_articles poa
        JOIN purchase_orders po ON poa.purchase_order_id = po.id
        LEFT JOIN brands b ON po.brand_id = b.id
        LEFT JOIN article_types at ON poa.article_type_id = at.id
        WHERE poa.purchase_order_id = ?
        ORDER BY poa.article_style
      `
      const result = await window.database.query<POArticle & { brand_id: number }>(sql, [selectedPOId])
      console.log('[PO_ARTICLES] Query result:', result.data)
      if (result.success && result.data) {
        setPOArticles(result.data)
        if (result.data.length > 0) {
          console.log('[PO_ARTICLES] First PO Article:', {
            id: result.data[0].id,
            article_style: result.data[0].article_style,
            article_type_id: result.data[0].article_type_id
          })
          const firstPOArticleId = result.data[0].id
          setSelectedPOArticleId(firstPOArticleId)
          setCurrentPOArticleIndex(0)

          // CRITICAL: Directly query measurements for this PO article
          // Only fetch if a size is selected
          if (selectedSize) {
            console.log('[PO_ARTICLES] Triggering immediate measurement fetch for article:', firstPOArticleId)
            await fetchMeasurementSpecsForArticle(firstPOArticleId, selectedSize)
          } else {
            console.log('[PO_ARTICLES] No size selected yet, waiting for user to select size')
          }
        }
      }
    } catch (err) {
      console.error('[PO_ARTICLES] Failed to fetch PO articles:', err)
    }
  }

  // Main function that accepts explicit parameters - doesn't rely on state
  // Uses the directly selected article ID when available for accurate measurement loading
  const fetchMeasurementSpecsForArticle = async (poArticleId: number, size: string) => {
    if (!poArticleId || !size) {
      console.log('[SPECS] Missing required parameters:', { poArticleId, size })
      setMeasurementSpecs([])
      return
    }

    try {
      console.log('[SPECS] ========== MEASUREMENT FETCH ==========')
      console.log('[SPECS] PO Article ID:', poArticleId, 'Size:', size)
      console.log('[SPECS] Selected Article ID from state:', selectedArticleId)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any = { success: false, data: [] }

      // STRATEGY 1: If we have a directly selected article ID (from the dropdown), use it directly
      // This is the most reliable method since user already selected the exact article
      if (selectedArticleId) {
        console.log('[SPECS] Using directly selected article ID:', selectedArticleId)
        const directQuery = `
          SELECT 
            m.id,
            m.code,
            m.measurement,
            COALESCE(m.tol_plus, 0) as tol_plus,
            COALESCE(m.tol_minus, 0) as tol_minus,
            ms.size,
            ms.value as expected_value,
            COALESCE(ms.unit, 'cm') as unit,
            a.id as article_id
          FROM articles a
          JOIN measurements m ON m.article_id = a.id
          JOIN measurement_sizes ms ON ms.measurement_id = m.id
          WHERE a.id = ? AND UPPER(TRIM(ms.size)) = UPPER(TRIM(?))
          ORDER BY m.code
        `
        result = await window.database.query<MeasurementSpec & { article_id?: number }>(directQuery, [selectedArticleId, size])
        console.log('[SPECS] Direct article query result:', result.data?.length || 0, 'measurements')

        if (result.data && result.data.length > 0) {
          // Load available sizes for this article
          fetchAvailableSizes(selectedArticleId)
        }
      }

      // STRATEGY 2: Match through PO article using brand + type + style
      if (!result.data || result.data.length === 0) {
        console.log('[SPECS] Trying PO article match: brand_id + article_type_id + article_style...')
        const comprehensiveQuery = `
          SELECT 
            m.id,
            m.code,
            m.measurement,
            COALESCE(m.tol_plus, 0) as tol_plus,
            COALESCE(m.tol_minus, 0) as tol_minus,
            ms.size,
            ms.value as expected_value,
            COALESCE(ms.unit, 'cm') as unit,
            a.id as article_id
          FROM purchase_order_articles poa
          JOIN purchase_orders po ON poa.purchase_order_id = po.id
          JOIN articles a ON a.brand_id = po.brand_id 
                        AND a.article_type_id = poa.article_type_id
                        AND a.article_style = poa.article_style
          JOIN measurements m ON m.article_id = a.id
          JOIN measurement_sizes ms ON ms.measurement_id = m.id
          WHERE poa.id = ? AND UPPER(TRIM(ms.size)) = UPPER(TRIM(?))
          ORDER BY m.code
        `
        result = await window.database.query<MeasurementSpec & { article_id?: number }>(comprehensiveQuery, [poArticleId, size])
        console.log('[SPECS] PO article match result:', result.data?.length || 0, 'measurements')

        if (result.data && result.data.length > 0 && result.data[0].article_id) {
          fetchAvailableSizes(result.data[0].article_id)
        }
      }

      // STRATEGY 3: Match by brand + type only (style might differ slightly)
      if (!result.data || result.data.length === 0) {
        console.log('[SPECS] Trying fallback: brand_id + article_type_id match...')
        const fallback1Query = `
          SELECT 
            m.id,
            m.code,
            m.measurement,
            COALESCE(m.tol_plus, 0) as tol_plus,
            COALESCE(m.tol_minus, 0) as tol_minus,
            ms.size,
            ms.value as expected_value,
            COALESCE(ms.unit, 'cm') as unit,
            a.id as article_id
          FROM purchase_order_articles poa
          JOIN purchase_orders po ON poa.purchase_order_id = po.id
          JOIN articles a ON a.brand_id = po.brand_id AND a.article_type_id = poa.article_type_id
          JOIN measurements m ON m.article_id = a.id
          JOIN measurement_sizes ms ON ms.measurement_id = m.id
          WHERE poa.id = ? AND UPPER(TRIM(ms.size)) = UPPER(TRIM(?))
          ORDER BY m.code
          LIMIT 50
        `
        result = await window.database.query<MeasurementSpec & { article_id?: number }>(fallback1Query, [poArticleId, size])
        console.log('[SPECS] Fallback 1 result:', result.data?.length || 0, 'measurements')

        if (result.data && result.data.length > 0 && result.data[0].article_id) {
          fetchAvailableSizes(result.data[0].article_id)
        }
      }

      // STRATEGY 4: Match by article_type_id only
      if (!result.data || result.data.length === 0) {
        console.log('[SPECS] Trying fallback: article_type_id only...')
        const fallback2Query = `
          SELECT 
            m.id,
            m.code,
            m.measurement,
            COALESCE(m.tol_plus, 0) as tol_plus,
            COALESCE(m.tol_minus, 0) as tol_minus,
            ms.size,
            ms.value as expected_value,
            COALESCE(ms.unit, 'cm') as unit,
            a.id as article_id
          FROM purchase_order_articles poa
          JOIN articles a ON a.article_type_id = poa.article_type_id
          JOIN measurements m ON m.article_id = a.id
          JOIN measurement_sizes ms ON ms.measurement_id = m.id
          WHERE poa.id = ? AND UPPER(TRIM(ms.size)) = UPPER(TRIM(?))
          ORDER BY m.code
          LIMIT 50
        `
        result = await window.database.query<MeasurementSpec & { article_id?: number }>(fallback2Query, [poArticleId, size])
        console.log('[SPECS] Fallback 2 result:', result.data?.length || 0, 'measurements')

        if (result.data && result.data.length > 0 && result.data[0].article_id) {
          fetchAvailableSizes(result.data[0].article_id)
        }
      }

      // Process results
      if (result.success && result.data && result.data.length > 0) {
        console.log('[SPECS] ✓ SUCCESS! Loaded', result.data.length, 'measurements:', result.data.map((m: MeasurementSpec) => m.code).join(', '))
        setMeasurementSpecs(result.data)
        const initialValues: Record<number, string> = {}
        result.data.forEach((spec: MeasurementSpec) => {
          initialValues[spec.id] = ''
        })
        setMeasuredValues(initialValues)
        loadExistingMeasurements(result.data)
      } else {
        console.log('[SPECS] ✗ No measurements found for any query strategy')
        setMeasurementSpecs([])
        setMeasuredValues({})
      }
    } catch (err) {
      console.error('[SPECS] ✗ FATAL ERROR:', err)
      setMeasurementSpecs([])
    }
  }

  // Wrapper function that uses current state values
  const fetchMeasurementSpecs = async () => {
    if (!selectedPOArticleId || !selectedSize) {
      console.log('[SPECS] Wrapper: Missing state values:', { selectedPOArticleId, selectedSize })
      return
    }
    await fetchMeasurementSpecsForArticle(selectedPOArticleId, selectedSize)
  }

  // Toggle measurement selection for tick indicator — VISUAL ONLY, no value changes
  const toggleMeasurementSelection = (specId: number) => {
    setSelectedMeasurementIds(prev => {
      const next = new Set(prev)
      if (next.has(specId)) {
        next.delete(specId)
      } else {
        next.add(specId)
      }
      return next
    })
  }

  const handleMeasuredValueChange = (measurementId: number, value: string) => {
    // Allow empty, numbers, and decimal points
    if (value !== '' && !/^-?\d*\.?\d*$/.test(value)) return
    setMeasuredValues(prev => ({
      ...prev,
      [measurementId]: value
    }))
  }

  // Increment/decrement handlers for numeric inputs
  const handleMeasuredValueStep = (measurementId: number, delta: number) => {
    setMeasuredValues(prev => {
      const current = parseFloat(prev[measurementId] || '0') || 0
      const newValue = Math.max(0, current + delta)
      return {
        ...prev,
        [measurementId]: newValue.toFixed(2)
      }
    })
  }


  const handleToleranceStep = (specId: number, field: 'tol_plus' | 'tol_minus', delta: number) => {
    setEditableTols(prev => {
      const current = parseFloat(prev[specId]?.[field] || '0') || 0
      const newValue = Math.max(0, current + delta)
      return {
        ...prev,
        [specId]: {
          ...prev[specId],
          [field]: newValue.toFixed(2)
        }
      }
    })
  }

  // Direct status calculation - always uses cm internally (measuredValues are always in cm)
  const calculateStatus = (spec: MeasurementSpec): 'PASS' | 'FAIL' | 'PENDING' => {
    const valueStr = measuredValues[spec.id]
    if (!valueStr || valueStr === '') return 'PENDING'
    const valueCm = parseFloat(valueStr) // Always cm
    if (isNaN(valueCm)) return 'PENDING'

    // Tolerances are always stored/edited in cm
    const tols = editableTols[spec.id]
    const tolPlus = tols ? (parseFloat(tols.tol_plus) || parseFloat(String(spec.tol_plus)) || 0) : (parseFloat(String(spec.tol_plus)) || 0)
    const tolMinus = tols ? (parseFloat(tols.tol_minus) || parseFloat(String(spec.tol_minus)) || 0) : (parseFloat(String(spec.tol_minus)) || 0)
    const expectedValue = parseFloat(String(spec.expected_value)) || 0

    const minValid = expectedValue - tolMinus
    const maxValid = expectedValue + tolPlus

    const isPass = valueCm >= minValid && valueCm <= maxValid

    return isPass ? 'PASS' : 'FAIL'
  }

  const handleToleranceChange = (specId: number, field: 'tol_plus' | 'tol_minus', value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    setEditableTols(prev => ({
      ...prev,
      [specId]: {
        ...prev[specId],
        [field]: value
      }
    }))
  }

  const handleStartMeasurement = async (side: 'front' | 'back') => {
    try {
      // Reset state for new measurement session
      setMeasurementComplete(false)
      setCurrentMeasurementSide(side)
      setError(null)

      // Initialize editable tolerances from specs
      const tols: Record<number, { tol_plus: string; tol_minus: string }> = {}
      measurementSpecs.forEach(spec => {
        tols[spec.id] = {
          tol_plus: spec.tol_plus.toString(),
          tol_minus: spec.tol_minus.toString()
        }
      })
      setEditableTols(tols)

      // Ensure a size is selected before starting
      if (!selectedSize) {
        setError('Please select a size before starting measurement')
        return
      }

      // Get article style for annotation lookup
      const articleStyle = jobCardSummary?.article_style ||
        articles.find(a => a.id === selectedArticleId)?.article_style

      if (!articleStyle) {
        setError('Article style not found. Please select an article.')
        return
      }

      // Validation passed — NOW lock auto-shift and prepare values
      setIsShiftLocked(true)

      // Auto-fill unselected measurements with expected values, clear selected for live update
      const updatedValues: Record<number, string> = { ...measuredValues }
      measurementSpecs.forEach(spec => {
        if (selectedMeasurementIds.has(spec.id)) {
          updatedValues[spec.id] = '' // Clear for live measurement
        } else {
          updatedValues[spec.id] = String(spec.expected_value) // Fill with spec value
        }
      })
      setMeasuredValues(updatedValues)

      console.log('[MEASUREMENT] Starting measurement for:', articleStyle, 'size:', selectedSize, 'side:', side)

      // ============== COLOR-AWARE annotation fetch from database ==============
      // Color code mapping: white → 'w', black → 'b', other/null → 'z'
      const colorCodeMap: Record<string, string> = { white: 'w', black: 'b', other: 'z' }
      const garmentColor = selectedColor || 'other'
      const colorCode = colorCodeMap[garmentColor] || 'z'
      const colorSuffixedStyle = `${articleStyle}-${colorCode}`

      console.log(`[MEASUREMENT] Garment color: ${garmentColor} → code: ${colorCode}`)
      console.log(`[MEASUREMENT] Color-suffixed style: ${colorSuffixedStyle}`)

      let keypointsPixels: number[][] = []
      let targetDistances: Record<string, number> = {}
      let placementBox: number[] | null = null
      let imageData: string | null = null
      let imageMimeType = 'image/jpeg'
      let imageWidth = 5472  // Default to camera native resolution
      let imageHeight = 2752
      let useLocalFiles = false
      let matchedColorCode = colorCode  // Track which color was actually matched

      type AnnotationRow = {
        id: number
        article_style: string
        size: string
        annotation_data: string
        image_width: number
        image_height: number
        reference_image_data: string
        reference_image_mime_type: string
      }

      try {
        let dbAnnotation: AnnotationRow | null = null

        // --- TIER 1: Exact color match (e.g. article_style = 'ML-4455-w') ---
        console.log(`[FETCH T1] Trying exact color match: article_style='${colorSuffixedStyle}', size='${selectedSize}', side='${side}'`)
        const tier1 = await window.database.query<AnnotationRow>(
          `SELECT id, article_style, size, annotation_data, image_width, image_height, reference_image_data, reference_image_mime_type
           FROM uploaded_annotations
           WHERE article_style = ? AND size = ? AND side = ?
           LIMIT 1`,
          [colorSuffixedStyle, selectedSize, side]
        )
        if (tier1.success && tier1.data && tier1.data.length > 0) {
          dbAnnotation = tier1.data[0]
          console.log(`[FETCH T1] ✓ Exact color match found, DB ID: ${dbAnnotation.id}`)
        }

        // --- TIER 2: Any color variant for same base style ---
        if (!dbAnnotation) {
          console.log(`[FETCH T2] Trying any color variant for base style '${articleStyle}'`)
          // Try all 3 color suffixes in preference order: requested → others
          const allCodes = ['w', 'b', 'z']
          const orderedCodes = [colorCode, ...allCodes.filter(c => c !== colorCode)]
          for (const tryCode of orderedCodes) {
            const tryStyle = `${articleStyle}-${tryCode}`
            const tier2 = await window.database.query<AnnotationRow>(
              `SELECT id, article_style, size, annotation_data, image_width, image_height, reference_image_data, reference_image_mime_type
               FROM uploaded_annotations
               WHERE article_style = ? AND size = ? AND side = ?
               LIMIT 1`,
              [tryStyle, selectedSize, side]
            )
            if (tier2.success && tier2.data && tier2.data.length > 0) {
              dbAnnotation = tier2.data[0]
              matchedColorCode = tryCode
              console.log(`[FETCH T2] ✓ Color variant '${tryCode}' matched, DB ID: ${dbAnnotation.id}`)
              break
            }
          }
        }

        // --- TIER 2.5: Try base style without any color suffix (legacy records) ---
        if (!dbAnnotation) {
          console.log(`[FETCH T2.5] Trying base style without color suffix: '${articleStyle}'`)
          const tier25 = await window.database.query<AnnotationRow>(
            `SELECT id, article_style, size, annotation_data, image_width, image_height, reference_image_data, reference_image_mime_type
             FROM uploaded_annotations
             WHERE article_style = ? AND size = ? AND side = ?
             LIMIT 1`,
            [articleStyle, selectedSize, side]
          )
          if (tier25.success && tier25.data && tier25.data.length > 0) {
            dbAnnotation = tier25.data[0]
            matchedColorCode = colorCode  // Use selected color for file naming
            console.log(`[FETCH T2.5] ✓ Legacy (no-color) record found, DB ID: ${dbAnnotation.id}`)
          }
        }

        // --- TIER 3: No DB record → fall back to local/camera annotation files ---
        if (!dbAnnotation) {
          console.log('[FETCH T3] No annotation in database for any color variant, will use local files')
          useLocalFiles = true
        }

        // Parse the matched DB annotation
        if (dbAnnotation) {
          console.log('[MEASUREMENT] Using DB annotation ID:', dbAnnotation.id, 'style:', dbAnnotation.article_style)

          // Parse annotation_data
          const annotationData = typeof dbAnnotation.annotation_data === 'string'
            ? JSON.parse(dbAnnotation.annotation_data)
            : dbAnnotation.annotation_data

          // Parse keypoints
          if (annotationData.keypoints) {
            if (typeof annotationData.keypoints === 'string') {
              const kpStr = annotationData.keypoints.trim()
              if (kpStr.startsWith('[')) {
                const parsed = JSON.parse(kpStr)
                keypointsPixels = parsed.map((kp: any) =>
                  Array.isArray(kp) ? [Number(kp[0]), Number(kp[1])] : [Number(kp.x), Number(kp.y)]
                )
              } else {
                const nums = kpStr.split(/\s+/).map(Number)
                for (let i = 0; i < nums.length - 1; i += 2) {
                  keypointsPixels.push([nums[i], nums[i + 1]])
                }
              }
            } else if (Array.isArray(annotationData.keypoints)) {
              keypointsPixels = annotationData.keypoints.map((kp: any) => {
                if (Array.isArray(kp)) return [Number(kp[0]), Number(kp[1])]
                if (typeof kp === 'object' && kp !== null) return [Number(kp.x), Number(kp.y)]
                return [0, 0]
              })
            }
          }

          // Parse target_distances
          const td = annotationData.target_distances
          if (typeof td === 'string') {
            try { targetDistances = JSON.parse(td) } catch { targetDistances = {} }
          } else if (td && typeof td === 'object') {
            targetDistances = td
          }

          // Parse placement_box
          if (annotationData.placement_box) {
            const pb = annotationData.placement_box
            if (typeof pb === 'string') {
              const nums = pb.trim().split(/\s+/).map(Number)
              if (nums.length >= 4) placementBox = nums.slice(0, 4)
            } else if (Array.isArray(pb)) {
              placementBox = pb.map(Number)
            } else if (typeof pb === 'object' && 'width' in pb) {
              placementBox = [pb.x, pb.y, pb.x + pb.width, pb.y + pb.height]
            }
          }

          // Get image
          if (dbAnnotation.reference_image_data) {
            imageData = dbAnnotation.reference_image_data
            imageMimeType = dbAnnotation.reference_image_mime_type || 'image/jpeg'
            if (!imageData.startsWith('data:image/')) {
              imageData = `data:${imageMimeType};base64,${imageData}`
            }
          }

          imageWidth = dbAnnotation.image_width || 5472
          imageHeight = dbAnnotation.image_height || 2752

          console.log('[MEASUREMENT] Parsed from DB:', keypointsPixels.length, 'keypoints,', Object.keys(targetDistances).length, 'targets')
        }
      } catch (err) {
        console.warn('[MEASUREMENT] Database query error:', err)
        useLocalFiles = true
      }

      // ============== Start measurement ==============
      console.log('[MEASUREMENT] Starting camera with:')
      console.log('  - Keypoints:', keypointsPixels.length)
      console.log('  - Target distances:', Object.keys(targetDistances).length)
      console.log('  - Use local files:', useLocalFiles)
      console.log('  - Measurement specs:', measurementSpecs.length)
      console.log('  - Color code:', matchedColorCode, `(requested: ${colorCode})`)

      // Build measurement_specs array so the CV engine can tag each pair with the correct spec info
      const specsForEngine = measurementSpecs.map((s, idx) => ({
        index: idx,
        db_id: s.id,
        code: s.code,
        name: s.measurement,
        expected_value: parseFloat(String(s.expected_value)) || 0
      }))

      const result = await window.measurement.start({
        annotation_name: selectedSize,
        article_style: articleStyle,
        side: side,
        garment_color: garmentColor,
        color_code: matchedColorCode,
        keypoints_pixels: keypointsPixels.length > 0 ? JSON.stringify(keypointsPixels) : undefined,
        target_distances: Object.keys(targetDistances).length > 0 ? JSON.stringify(targetDistances) : undefined,
        placement_box: placementBox ? JSON.stringify(placementBox) : undefined,
        image_width: imageWidth,
        image_height: imageHeight,
        image_data: imageData || undefined,
        image_mime_type: imageMimeType,
        measurement_specs: JSON.stringify(specsForEngine)
      })

      if (result.status === 'success') {
        setIsMeasurementEnabled(true)
        setIsPollingActive(true) // Start live polling
        setError(null)
        console.log('[MEASUREMENT] Camera started successfully! Fullscreen window should open.')
      } else {
        console.error('[MEASUREMENT] Failed to start:', result.message)
        setError(result.message || 'Failed to start camera. Check if annotation exists for this article/size.')
        setIsShiftLocked(false) // Reset shift on failure
      }
    } catch (err) {
      console.error('[MEASUREMENT] Start measurement error:', err)
      setError('Measurement service not responding. Is Python API running?')
      setIsShiftLocked(false) // Reset shift on error
    }
  }

  // TEST ANNOTATION: Start measurement with test annotation file from testjson folder
  const handleTestAnnotationMeasurement = async () => {
    try {
      console.log('[TEST] Starting measurement with TEST ANNOTATION from testjson folder...')

      // Keypoints and target distances from testjson/annotation_test.json
      // These are for the 5472x2752 reference image (matches camera native resolution)
      const TEST_WIDTH = 5472
      const TEST_HEIGHT = 2752

      // Keypoints and target distances from testjson/annotation_data.json (SYNCED!)
      const testKeypoints = [
        [1806, 1318], [1710, 2024], [3395, 1359], [3465, 2045],
        [2280, 1144], [2895, 1173], [1809, 2924], [3308, 2945],
        [2268, 1062], [2225, 3073], [229, 1917], [323, 2135],
        [3410, 1285], [4849, 2061]
      ]

      const testTargetDistances = {
        "1": 20.8524686252755,
        "2": 20.181240578402498,
        "3": 18.019047989259654,
        "4": 43.87601480642671,
        "5": 58.90287103526992,
        "6": 6.9748861675833,
        "7": 47.87395450078443
      }

      const testPlacementBox = [133, 995, 4903, 3197]

      console.log('[TEST] Test annotation:', testKeypoints.length, 'keypoints,', Object.keys(testTargetDistances).length, 'target distances')
      console.log('[TEST] Designed for image dimensions:', TEST_WIDTH, 'x', TEST_HEIGHT)

      // Load reference image from testjson folder via IPC
      let imageData: string | null = null
      const imageMimeType = 'image/jpeg'

      // Request the test image from Electron main process
      const testImageResult = await window.measurement.loadTestImage('testjson/reference_image.jpg')

      if (testImageResult.status === 'success' && testImageResult.data) {
        imageData = testImageResult.data
        console.log('[TEST] Loaded test reference image from testjson/reference_image.jpg')
        console.log('[TEST] Image base64 length:', imageData.length)
      } else {
        console.log('[TEST] Could not load test image:', testImageResult.message)
        console.log('[TEST] Falling back to database image...')

        // Fallback: try to get image from database (if any article is selected)
        const articleStyle = jobCardSummary?.article_style ||
          articles.find(a => a.id === selectedArticleId)?.article_style

        if (articleStyle && selectedSize) {
          const imageResult = await window.database.query<{
            image_data: string
            image_mime_type: string
          }>(
            `SELECT image_data, image_mime_type FROM article_annotations WHERE article_style = ? AND size = ? LIMIT 1`,
            [articleStyle, selectedSize]
          )
          if (imageResult.success && imageResult.data && imageResult.data.length > 0 && imageResult.data[0].image_data) {
            imageData = imageResult.data[0].image_data
            console.log('[TEST] Using fallback reference image from database')
            console.log('[TEST] WARNING: Database image dimensions may not match test annotation!')
          }
        }
      }

      if (!imageData) {
        setError('Could not load test reference image. Ensure testjson/reference_image.jpg exists.')
        return
      }

      // Start measurement with test annotation and test image
      // Since test image is 5472x2752 (same as camera), live frame will resize to match
      const result = await window.measurement.start({
        annotation_name: 'TEST',
        article_style: 'TEST-ANNOTATION',
        side: 'front',
        keypoints_pixels: JSON.stringify(testKeypoints),
        target_distances: JSON.stringify(testTargetDistances),
        placement_box: JSON.stringify(testPlacementBox),
        image_width: TEST_WIDTH,
        image_height: TEST_HEIGHT,
        annotation_data: undefined,
        image_data: imageData,
        image_mime_type: imageMimeType
      })

      if (result.status === 'success') {
        setIsMeasurementEnabled(true)
        setIsPollingActive(true)
        setError(null)
        console.log('[TEST] Test annotation measurement started successfully!')
        console.log('[TEST] Using', testKeypoints.length, 'keypoints for', TEST_WIDTH, 'x', TEST_HEIGHT, 'image')
        console.log('[TEST] Live frame will be resized to match reference image dimensions')
      } else {
        setError(result.message || 'Failed to start test measurement')
      }
    } catch (err) {
      console.error('[TEST] Test annotation measurement error:', err)
      setError('Test measurement failed: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleCompleteMeasurement = async () => {
    try {
      console.log('[COMPLETE] Completing measurement...')

      // Fetch final live measurements before stopping
      const finalResult = await window.measurement.getLiveResults()
      if (finalResult.status === 'success' && finalResult.data && finalResult.data.measurements) {
        const liveData = finalResult.data.measurements as Array<{
          id: number
          actual_cm: number
        }>

        // Update measured values with final readings — ONLY for selected (checked) POMs
        // liveMeasurement.id is 1-based index (1,2,3...), map to measurementSpecs array
        setMeasuredValues(prev => {
          const newValues = { ...prev }
          liveData.forEach((liveMeasurement) => {
            // Live measurement ID is 1-based, so index = id - 1
            const specIndex = liveMeasurement.id - 1
            if (specIndex >= 0 && specIndex < measurementSpecs.length) {
              const spec = measurementSpecs[specIndex]
              if (!selectedMeasurementIds.has(spec.id)) return // STRICT: skip unchecked
              newValues[spec.id] = liveMeasurement.actual_cm.toFixed(2)
              console.log(`[COMPLETE] Spec[${specIndex}] "${spec.code}" (DB id=${spec.id}): ${liveMeasurement.actual_cm.toFixed(2)} cm`)
            } else {
              console.warn(`[COMPLETE] No spec at index ${specIndex} for live measurement id ${liveMeasurement.id}`)
            }
          })
          return newValues
        })
      }

      // Stop the camera system
      await window.measurement.stop()
      setIsPollingActive(false)

      // Mark measurement as complete (allows editing and shows status)
      setMeasurementComplete(true)
      setIsMeasurementEnabled(false)
      setIsShiftLocked(false)

      // Final save with all current values
      await saveMeasurements()

      // Calculate QC result after a brief delay to ensure state is updated
      setTimeout(() => {
        const failed: { code: string, measurement: string, expected: number, actual: number }[] = []

        measurementSpecs.forEach(spec => {
          const valueStr = measuredValues[spec.id]
          if (!valueStr) return

          const value = parseFloat(valueStr)
          const expected = parseFloat(String(spec.expected_value)) || 0
          const tolPlus = parseFloat(String(spec.tol_plus)) || 0
          const tolMinus = parseFloat(String(spec.tol_minus)) || 0

          const minValid = expected - tolMinus
          const maxValid = expected + tolPlus

          if (value < minValid || value > maxValid) {
            failed.push({
              code: spec.code,
              measurement: spec.measurement,
              expected: expected,
              actual: value
            })
          }
        })

        setFailedMeasurements(failed)
        setQcPassed(failed.length === 0)
        setShowQCResult(true)
      }, 100)

      console.log('[COMPLETE] Measurement completed and saved')
      setError(null)
    } catch (err) {
      console.error('Complete measurement error:', err)
      setError('Failed to complete measurement')
    }
  }

  // Front Side Measurement - starts measurement with front annotation
  const handleFrontSideMeasurement = () => {
    handleStartMeasurement('front')
  }

  // Back Side Measurement - starts measurement with back annotation
  const handleBackSideMeasurement = () => {
    handleStartMeasurement('back')
  }

  // Stop measurement - stops camera, calculates QC, and shows result
  const handleStopMeasurement = async () => {
    try {
      console.log(`[STOP] Stopping ${currentMeasurementSide} side measurement...`)

      // Fetch final live measurements before stopping
      const finalResult = await window.measurement.getLiveResults()
      let finalMeasuredValues = { ...measuredValues }
      
      if (finalResult.status === 'success' && finalResult.data && finalResult.data.measurements) {
        const liveData = finalResult.data.measurements as Array<{
          id: number
          actual_cm: number
          spec_id?: number
          spec_code?: string
        }>

        // Update measured values with final readings — ONLY for selected (checked) POMs
        liveData.forEach((liveMeasurement) => {
          let spec: typeof measurementSpecs[0] | undefined

          // PRIMARY: match by spec_id
          if (liveMeasurement.spec_id) {
            spec = measurementSpecs.find(s => s.id === liveMeasurement.spec_id)
          }
          // SECONDARY: match by spec_code
          if (!spec && liveMeasurement.spec_code) {
            spec = measurementSpecs.find(s => s.code === liveMeasurement.spec_code)
          }
          // FALLBACK: match by position
          if (!spec) {
            const specIndex = liveMeasurement.id - 1
            if (specIndex >= 0 && specIndex < measurementSpecs.length) {
              spec = measurementSpecs[specIndex]
            }
          }

          // STRICT: only update checked measurements; unchecked rows keep their original value
          if (spec && selectedMeasurementIds.has(spec.id)) {
            finalMeasuredValues[spec.id] = liveMeasurement.actual_cm.toFixed(2)
            console.log(`[STOP] ✓ ${spec.code} "${spec.measurement}": ${liveMeasurement.actual_cm.toFixed(2)} cm (selected)`)
          } else if (spec) {
            console.log(`[STOP] ✗ ${spec.code} skipped (unchecked) — keeping original value: ${finalMeasuredValues[spec.id] || spec.expected_value}`)
          }
        })
        
        setMeasuredValues(finalMeasuredValues)
      }

      // Stop the camera system completely
      await window.measurement.stop()
      setIsPollingActive(false)
      setIsMeasurementEnabled(false)
      setIsShiftLocked(false)

      // Track which side was completed and store measurements separately
      const completedSide = currentMeasurementSide
      setCurrentMeasurementSide(null)

      if (completedSide === 'front') {
        console.log('[STOP] Front side measurement complete')
        setFrontMeasuredValues({ ...finalMeasuredValues })
        setFrontSelectedIds(new Set(selectedMeasurementIds))
        setFrontSideComplete(true)
      } else if (completedSide === 'back') {
        console.log('[STOP] Back side measurement complete')
        setBackMeasuredValues({ ...finalMeasuredValues })
        setBackSelectedIds(new Set(selectedMeasurementIds))
        setBackSideComplete(true)
      }

      // Save measurements to database with side information
      await saveMeasurementsWithSide(completedSide || 'front', finalMeasuredValues, selectedMeasurementIds)

      setMeasurementComplete(true)
      console.log(`[STOP] ${completedSide} side measurement stopped. Press Start QC to check results.`)

      setError(null)
    } catch (err) {
      console.error('[STOP] Error stopping measurement:', err)
      setError('Failed to stop measurement')
    }
  }

  // Handle QC popup close - just close popup, allow user to continue with other side
  const handleQCClose = () => {
    console.log('[QC] Closing QC popup - user can continue measuring other side')
    setShowQCResult(false)
    setMeasurementComplete(false) // Allow further measurements
  }

  // Handle Next Article - robust atomic save + verification before navigating
  const handleNextArticle = async () => {
    console.log('[NEXT] Moving to next article - saving measurements...')
    setIsSavingNextArticle(true)
    setError(null)

    const MAX_RETRIES = 2
    let saveSucceeded = false

    try {
      const articleStyle = jobCardSummary?.article_style ||
        articles.find(a => a.id === selectedArticleId)?.article_style

      // ── Step 1: Save per-side detailed measurements (only checked POMs) ──
      for (let attempt = 0; attempt <= MAX_RETRIES && !saveSucceeded; attempt++) {
        try {
          if (attempt > 0) console.log(`[NEXT] Retry attempt ${attempt}/${MAX_RETRIES}...`)

          // Save front side measurements if complete (uses per-side checked ID snapshot)
          if (frontSideComplete && Object.keys(frontMeasuredValues).length > 0) {
            const frontOk = await saveMeasurementsWithSide('front', frontMeasuredValues, frontSelectedIds)
            if (!frontOk) throw new Error('Front side save failed')
            console.log('[NEXT] Front side measurements persisted')
          }

          // Save back side measurements if complete (uses per-side checked ID snapshot)
          if (backSideComplete && Object.keys(backMeasuredValues).length > 0) {
            const backOk = await saveMeasurementsWithSide('back', backMeasuredValues, backSelectedIds)
            if (!backOk) throw new Error('Back side save failed')
            console.log('[NEXT] Back side measurements persisted')
          }

          // ── Step 2: Save measurement session record for analytics ──
          if (selectedPOArticleId && selectedSize && operator?.id) {
            const frontQCResult = frontSideComplete && frontQCChecked
              ? (failedMeasurements.length === 0 && qcPassed ? 'PASS' : 'FAIL') : null
            const backQCResult = backSideComplete && backQCChecked
              ? (failedMeasurements.length === 0 && qcPassed ? 'PASS' : 'FAIL') : null

            await window.database.execute(`
              INSERT INTO measurement_sessions 
                (purchase_order_article_id, size, article_style, operator_id, 
                 front_side_complete, back_side_complete, 
                 front_qc_result, back_qc_result,
                 completed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
              ON DUPLICATE KEY UPDATE
                front_side_complete = VALUES(front_side_complete),
                back_side_complete = VALUES(back_side_complete),
                front_qc_result = VALUES(front_qc_result),
                back_qc_result = VALUES(back_qc_result),
                completed_at = NOW()
            `, [
              selectedPOArticleId,
              selectedSize,
              articleStyle,
              operator.id,
              frontSideComplete ? 1 : 0,
              backSideComplete ? 1 : 0,
              frontQCResult,
              backQCResult
            ])
            console.log('[NEXT] Session record saved')
          }

          // ── Step 3: Verification — read back from BOTH tables to confirm persistence ──
          if (selectedPOArticleId && selectedSize) {
            // Verify measurement_results (backward-compatible table)
            const verifyBasic = await window.database.execute(`
              SELECT COUNT(*) as cnt FROM measurement_results 
              WHERE purchase_order_article_id = ? AND size = ?
            `, [selectedPOArticleId, selectedSize]) as any
            const basicRows = verifyBasic?.[0]?.[0]?.cnt ?? verifyBasic?.[0]?.cnt ?? 0

            // Verify measurement_results_detailed (primary table)
            let detailedRows = 0
            try {
              const verifyDetailed = await window.database.execute(`
                SELECT COUNT(*) as cnt FROM measurement_results_detailed 
                WHERE purchase_order_article_id = ? AND size = ?
              `, [selectedPOArticleId, selectedSize]) as any
              detailedRows = verifyDetailed?.[0]?.[0]?.cnt ?? verifyDetailed?.[0]?.cnt ?? 0
            } catch {
              // Table may not exist yet — basic table is sufficient
              detailedRows = -1
            }

            // Verify measurement_sessions
            const verifySession = await window.database.execute(`
              SELECT COUNT(*) as cnt FROM measurement_sessions 
              WHERE purchase_order_article_id = ? AND size = ?
            `, [selectedPOArticleId, selectedSize]) as any
            const sessionRows = verifySession?.[0]?.[0]?.cnt ?? verifySession?.[0]?.cnt ?? 0

            console.log(`[NEXT] Verification: measurement_results=${basicRows}, measurement_results_detailed=${detailedRows}, measurement_sessions=${sessionRows}`)

            const hasCompletedSide = frontSideComplete || backSideComplete
            if (hasCompletedSide && basicRows === 0) {
              throw new Error(`Verification failed — 0 rows in measurement_results after save`)
            }
            if (hasCompletedSide && sessionRows === 0 && operator?.id) {
              throw new Error(`Verification failed — 0 rows in measurement_sessions after save`)
            }
          }

          saveSucceeded = true
          console.log('[NEXT] All data saved and verified successfully')
        } catch (retryErr) {
          console.error(`[NEXT] Save attempt ${attempt + 1} failed:`, retryErr)
          if (attempt === MAX_RETRIES) {
            throw retryErr // Final attempt failed → propagate
          }
          // Brief pause before retry
          await new Promise(r => setTimeout(r, 500))
        }
      }

      // ── Step 4: Navigation allowed — reset panel ──
      console.log('[NEXT] Resetting panel for next article...')

      setShowQCResult(false)

      setSelectedBrandId(null)
      setSelectedArticleTypeId(null)
      setSelectedArticleId(null)
      setSelectedPOId(null)
      setSelectedPOArticleId(null)
      setSelectedSize(null)
      setSelectedColor(null)

      setMeasurementSpecs([])
      setMeasuredValues({})
      setEditableTols({})
      setFrontMeasuredValues({})
      setBackMeasuredValues({})
      setFrontSideComplete(false)
      setBackSideComplete(false)
      setFrontSelectedIds(new Set())
      setBackSelectedIds(new Set())
      setFrontQCChecked(false)
      setBackQCChecked(false)
      setLastQCSide(null)
      setCurrentMeasurementSide(null)
      setMeasurementComplete(false)
      setIsMeasurementEnabled(false)
      setIsPollingActive(false)
      setIsShiftLocked(false)
      setSelectedMeasurementIds(new Set())
      selectedMeasurementIdsRef.current = new Set()
      setDisplayUnit('cm')

      setArticleTypes([])
      setArticles([])
      setPurchaseOrders([])
      setPOArticles([])
      setAvailableSizes([])
      setJobCardSummary(null)

      setQcPassed(true)
      setFailedMeasurements([])

      setError(null)
      console.log('[NEXT] Panel reset complete - ready for next article')
    } catch (err) {
      console.error('[NEXT] Error during next article transition:', err)
      setError('Save failed — measurements not confirmed in database. Please try again before proceeding.')
    } finally {
      setIsSavingNextArticle(false)
    }
  }

  // Check QC for specific side measurements
  const handleCheckQC = async (side?: 'front' | 'back') => {
    // Determine which measurements to check
    const targetSide = side || lastQCSide || (frontSideComplete ? 'front' : backSideComplete ? 'back' : null)
    
    if (!targetSide) {
      setError('Please complete at least one side measurement before checking QC')
      return
    }
    
    const valuesToCheck = targetSide === 'front' ? frontMeasuredValues : backMeasuredValues
    
    console.log(`[QC] Checking QC for ${targetSide} side with ${Object.keys(valuesToCheck).length} measurements`)
    
    // Calculate QC result
    const failed: { code: string, measurement: string, expected: number, actual: number }[] = []

    measurementSpecs.forEach(spec => {
      const valueStr = valuesToCheck[spec.id]
      if (!valueStr) return

      const value = parseFloat(valueStr) // Always in cm
      const expected = parseFloat(String(spec.expected_value)) || 0
      // Use editable tolerances if available, otherwise spec defaults
      const tols = editableTols[spec.id]
      const tolPlus = tols ? (parseFloat(tols.tol_plus) || parseFloat(String(spec.tol_plus)) || 0) : (parseFloat(String(spec.tol_plus)) || 0)
      const tolMinus = tols ? (parseFloat(tols.tol_minus) || parseFloat(String(spec.tol_minus)) || 0) : (parseFloat(String(spec.tol_minus)) || 0)

      const minValid = expected - tolMinus
      const maxValid = expected + tolPlus

      if (value < minValid || value > maxValid) {
        failed.push({
          code: spec.code,
          measurement: spec.measurement,
          expected: expected,
          actual: value
        })
      }
    })

    setFailedMeasurements(failed)
    setQcPassed(failed.length === 0)
    setLastQCSide(targetSide)
    setShowQCResult(true)
    
    if (targetSide === 'front') {
      setFrontQCChecked(true)
    } else {
      setBackQCChecked(true)
    }
    
    console.log(`[QC] ${targetSide} side QC Result: ${failed.length === 0 ? 'PASSED ✓' : 'FAILED ✗'}`)
  }

  // Final Complete - calculate QC and show result (3rd button)
  const handleFinalComplete = async () => {
    try {
      console.log('[FINAL] Completing measurement and calculating QC...')

      // Verify both sides are complete
      if (!frontSideComplete || !backSideComplete) {
        setError('Both front and back sides must be measured before final completion')
        return
      }

      setMeasurementComplete(true)

      // Save measurements to database
      await saveMeasurements()

      // Calculate QC result
      setTimeout(() => {
        const failed: { code: string, measurement: string, expected: number, actual: number }[] = []

        measurementSpecs.forEach(spec => {
          const valueStr = measuredValues[spec.id]
          if (!valueStr) return

          const value = parseFloat(valueStr)
          const expected = parseFloat(String(spec.expected_value)) || 0
          const tolPlus = parseFloat(String(spec.tol_plus)) || 0
          const tolMinus = parseFloat(String(spec.tol_minus)) || 0

          const minValid = expected - tolMinus
          const maxValid = expected + tolPlus

          if (value < minValid || value > maxValid) {
            failed.push({
              code: spec.code,
              measurement: spec.measurement,
              expected: expected,
              actual: value
            })
          }
        })

        setFailedMeasurements(failed)
        setQcPassed(failed.length === 0)
        setShowQCResult(true)
        console.log(`[FINAL] QC Result: ${failed.length === 0 ? 'PASSED' : 'FAILED'}`)
      }, 100)

      setError(null)
    } catch (err) {
      console.error('[FINAL] Error completing measurement:', err)
      setError('Failed to complete final measurement')
    }
  }

  const saveMeasurements = async (): Promise<boolean> => {
    if (!selectedPOArticleId || !selectedSize) {
      console.log('[SAVE] Missing PO article ID or size')
      return false
    }

    setIsSaving(true)
    console.log('[SAVE] Saving measurements for PO Article:', selectedPOArticleId, 'Size:', selectedSize)

    try {
      let savedCount = 0
      for (const spec of measurementSpecs) {
        const valueStr = measuredValues[spec.id]
        const value = valueStr ? parseFloat(valueStr) : null
        const status = calculateStatus(spec)

        const sql = `
          INSERT INTO measurement_results 
            (purchase_order_article_id, measurement_id, size, measured_value, status, operator_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            measured_value = VALUES(measured_value),
            status = VALUES(status),
            operator_id = VALUES(operator_id),
            updated_at = CURRENT_TIMESTAMP
        `
        await window.database.execute(sql, [
          selectedPOArticleId,
          spec.id,
          selectedSize,
          value,
          status,
          operator?.id || null
        ])
        savedCount++
        console.log(`[SAVE] Saved ${spec.code}: value=${value}, status=${status}`)
      }

      console.log(`[SAVE] Successfully saved ${savedCount} measurements`)
      return true
    } catch (err) {
      console.error('[SAVE] Failed to save measurements:', err)
      setError('Failed to save measurements')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  // Save measurements with side information for analytics
  // Only saves checked/selected POM rows; uses operator-edited tolerances.
  // All values are stored in cm (internal source of truth).
  const saveMeasurementsWithSide = async (
    side: 'front' | 'back',
    measurements: Record<number, string>,
    checkedIds: Set<number>
  ): Promise<boolean> => {
    if (!selectedPOArticleId || !selectedSize) {
      console.log('[SAVE] Missing PO article ID or size')
      return false
    }

    const articleStyle = jobCardSummary?.article_style ||
      articles.find(a => a.id === selectedArticleId)?.article_style

    setIsSaving(true)
    console.log(`[SAVE] Saving ${side} side measurements for PO Article:`, selectedPOArticleId, 'Size:', selectedSize, 'Color:', selectedColor || 'other')
    console.log(`[SAVE] Checked POM IDs: [${[...checkedIds].join(', ')}]`)

    try {
      // Delete previous measurements for this article/size/side (remeasure logic)
      await window.database.execute(`
        DELETE FROM measurement_results_detailed 
        WHERE purchase_order_article_id = ? AND size = ? AND side = ?
      `, [selectedPOArticleId, selectedSize, side])
      console.log(`[SAVE] Cleared old ${side} side measurements`)

      let savedCount = 0
      for (const spec of measurementSpecs) {
        // STRICT: only persist rows the operator explicitly checked
        if (!checkedIds.has(spec.id)) {
          console.log(`[SAVE] Skipping unchecked POM ${spec.code} (id=${spec.id})`)
          continue
        }

        const valueStr = measurements[spec.id]
        const value = valueStr ? parseFloat(valueStr) : null
        if (value === null || isNaN(value)) continue // Skip empty / invalid

        // Use operator-edited tolerances if available, otherwise spec defaults
        const tols = editableTols[spec.id]
        const tolPlus = tols ? (parseFloat(tols.tol_plus) || parseFloat(String(spec.tol_plus)) || 0) : (parseFloat(String(spec.tol_plus)) || 0)
        const tolMinus = tols ? (parseFloat(tols.tol_minus) || parseFloat(String(spec.tol_minus)) || 0) : (parseFloat(String(spec.tol_minus)) || 0)
        const expected = parseFloat(String(spec.expected_value)) || 0
        const minValid = expected - tolMinus
        const maxValid = expected + tolPlus
        const status = (value >= minValid && value <= maxValid) ? 'PASS' : 'FAIL'

        // Save to detailed results table with side info + garment_color
        await window.database.execute(`
          INSERT INTO measurement_results_detailed 
            (purchase_order_article_id, measurement_id, size, side, article_style,
             measured_value, expected_value, tol_plus, tol_minus, status, operator_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          selectedPOArticleId,
          spec.id,
          selectedSize,
          side,
          articleStyle,
          value,      // Always cm
          expected,   // Always cm
          tolPlus,    // Always cm
          tolMinus,   // Always cm
          status,
          operator?.id || null
        ])
        savedCount++
      }

      // Also update backward-compatible measurement_results table (checked rows only)
      for (const spec of measurementSpecs) {
        if (!checkedIds.has(spec.id)) continue

        const valueStr = measurements[spec.id]
        const value = valueStr ? parseFloat(valueStr) : null
        if (value === null || isNaN(value)) continue

        const tols = editableTols[spec.id]
        const tolPlus = tols ? (parseFloat(tols.tol_plus) || parseFloat(String(spec.tol_plus)) || 0) : (parseFloat(String(spec.tol_plus)) || 0)
        const tolMinus = tols ? (parseFloat(tols.tol_minus) || parseFloat(String(spec.tol_minus)) || 0) : (parseFloat(String(spec.tol_minus)) || 0)
        const expected = parseFloat(String(spec.expected_value)) || 0
        const minValid = expected - tolMinus
        const maxValid = expected + tolPlus
        const status = (value >= minValid && value <= maxValid) ? 'PASS' : 'FAIL'

        await window.database.execute(`
          INSERT INTO measurement_results 
            (purchase_order_article_id, measurement_id, size, measured_value, status, operator_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            measured_value = VALUES(measured_value),
            status = VALUES(status),
            operator_id = VALUES(operator_id),
            updated_at = CURRENT_TIMESTAMP
        `, [
          selectedPOArticleId,
          spec.id,
          selectedSize,
          value,
          status,
          operator?.id || null
        ])
      }

      console.log(`[SAVE] Successfully saved ${savedCount} checked ${side} side measurements (of ${measurementSpecs.length} total specs)`)
      return true
    } catch (err) {
      console.error(`[SAVE] Failed to save ${side} side measurements:`, err)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  // This function is now replaced by the one defined earlier with analytics saving
  const handleNextArticleOld = async () => {
    const allComplete = measurementSpecs.every(spec => {
      const valueStr = measuredValues[spec.id]
      return valueStr && valueStr !== ''
    })

    if (!allComplete) {
      setError('Please complete all measurements before proceeding')
      return
    }

    // Stop any active measurement process
    if (isPollingActive) {
      try {
        await window.measurement.stop()
      } catch (err) {
        console.error('Failed to stop measurement:', err)
      }
    }

    const saved = await saveMeasurements()
    if (!saved) return

    // Reset all lifecycle states but keep operator session active
    setIsPollingActive(false)
    setMeasurementComplete(false)
    setIsMeasurementEnabled(false)
    setIsShiftLocked(false)
    setEditableTols({})

    if (currentPOArticleIndex < poArticles.length - 1) {
      // Move to next article in same PO
      const nextIndex = currentPOArticleIndex + 1
      const nextArticle = poArticles[nextIndex]

      setCurrentPOArticleIndex(nextIndex)
      setSelectedPOArticleId(nextArticle.id)
      setMeasuredValues({})
      setError(null)

      console.log('[NEXT] Moving to next PO article:', nextArticle.article_style)

      // Check if this article already has measurements
      await loadExistingMeasurements(nextArticle.id)
    } else {
      // Last article in PO - offer to select new article or finish
      console.log('[NEXT] Completed all articles in PO, resetting for new selection')
      handleResetForNewArticle()
    }
  }

  // Reset the entire page state for selecting a new article while keeping operator session
  const handleResetForNewArticle = () => {
    console.log('[RESET] Resetting ALL selections for new article')

    // Stop any active measurement
    if (isPollingActive) {
      window.measurement.stop().catch(console.error)
    }

    // Reset ALL selection states
    setSelectedBrandId(null)
    setSelectedArticleTypeId(null)
    setSelectedArticleId(null)
    setSelectedPOId(null)
    setSelectedPOArticleId(null)
    setSelectedSize(null)

    // Reset lists
    setArticleTypes([])
    setArticles([])
    setPurchaseOrders([])
    setPOArticles([])
    setAvailableSizes([])
    setCurrentPOArticleIndex(0)

    // Reset job card
    setJobCardSummary(null)

    // Reset measurement states
    setMeasurementSpecs([])
    setMeasuredValues({})
    setEditableTols({})

    // Reset lifecycle states
    setIsPollingActive(false)
    setMeasurementComplete(false)
    setIsMeasurementEnabled(false)

    // Clear errors
    setError(null)

    // Notify user
    console.log('[RESET] ALL selections cleared - Ready for new article selection')
  }

  const handlePreviousArticle = async () => {
    console.log('[BACK] Going to previous article...')

    // Stop any active measurement
    if (isPollingActive) {
      try {
        await window.measurement.stop()
      } catch (err) {
        console.error('Failed to stop measurement:', err)
      }
    }

    // Save current measurements before navigating
    const saved = await saveMeasurements()
    console.log('[BACK] Current measurements saved:', saved)

    // Reset lifecycle states
    setIsPollingActive(false)
    setMeasurementComplete(false)
    setIsMeasurementEnabled(false)
    setEditableTols({})

    if (currentPOArticleIndex > 0) {
      const prevIndex = currentPOArticleIndex - 1
      const prevArticle = poArticles[prevIndex]

      setCurrentPOArticleIndex(prevIndex)
      setSelectedPOArticleId(prevArticle.id)
      setMeasuredValues({})
      setError(null)

      console.log('[BACK] Navigating to previous article:', prevArticle.article_style)

      // Load existing measurements for the previous article
      await loadExistingMeasurements(prevArticle.id)
    }
  }

  // Load existing measurement results from database
  const loadExistingMeasurements = async (poArticleId: number) => {
    if (!selectedSize) return

    try {
      console.log('[LOAD] Loading existing measurements for PO Article:', poArticleId, 'Size:', selectedSize)

      const sql = `
        SELECT mr.measurement_id, mr.measured_value, mr.status, mr.tol_plus, mr.tol_minus
        FROM measurement_results mr
        WHERE mr.purchase_order_article_id = ?
        AND mr.size = ?
      `
      const result = await window.database.query<{
        measurement_id: number
        measured_value: number | null
        status: string
      }>(sql, [poArticleId, selectedSize])

      if (result.success && result.data && result.data.length > 0) {
        console.log('[LOAD] Found', result.data.length, 'existing measurements')

        // Restore measured values
        const values: Record<number, string> = {}

        result.data.forEach(row => {
          if (row.measured_value !== null) {
            values[row.measurement_id] = row.measured_value.toFixed(2)
          }
        })

        setMeasuredValues(values)

        // Mark as complete if all measurements have values
        const allComplete = measurementSpecs.every(spec => values[spec.id] && values[spec.id] !== '')
        if (allComplete) {
          setMeasurementComplete(true)
          console.log('[LOAD] All measurements complete - marking as finished')
        }
      } else {
        console.log('[LOAD] No existing measurements found')
      }
    } catch (err) {
      console.error('[LOAD] Failed to load existing measurements:', err)
    }
  }

  const handleBack = async () => {
    // Stop any active measurement
    if (isPollingActive) {
      try {
        await window.measurement.stop()
      } catch (err) {
        console.error('Failed to stop measurement:', err)
      }
    }

    // Save before going back
    await saveMeasurements()

    // Reset all states
    setIsPollingActive(false)
    setMeasurementComplete(false)
    setIsMeasurementEnabled(false)
    setEditableTols({})
    setSelectedPOId(null)
    setSelectedPOArticleId(null)
    setMeasurementSpecs([])
    setMeasuredValues({})
    setIsMeasurementEnabled(false)
    setError(null)
  }

  const handleBrandChange = (brandId: number | null) => {
    console.log('[SELECTION] Brand changed to:', brandId)
    setSelectedBrandId(brandId)
    setSelectedArticleId(null)
    setSelectedArticleTypeId(null)
    setSelectedPOId(null)
    setSelectedPOArticleId(null)
    setPurchaseOrders([])
    setMeasurementSpecs([])
    setMeasuredValues({})
    setAvailableSizes(['S', 'M', 'L', 'XL', 'XXL']) // Reset to defaults
  }

  const handleArticleChange = async (articleId: number | null) => {
    console.log('[SELECTION] Article changed to:', articleId)
    setSelectedArticleId(articleId)
    setSelectedPOId(null)
    setSelectedPOArticleId(null)
    setMeasurementSpecs([])
    setMeasuredValues({})

    const article = articles.find(a => a.id === articleId)
    if (article) {
      setSelectedArticleTypeId(article.article_type_id)
      // Load available sizes for this article from database
      const sizesLoaded = await fetchAvailableSizesAndReturn(article.id)

      // Don't auto-select size or auto-load measurements - let user choose
      // Just show available sizes and wait for user to select
      if (sizesLoaded && sizesLoaded.length > 0) {
        // If current size is valid, load measurements for it
        if (selectedSize && sizesLoaded.includes(selectedSize)) {
          console.log('[ARTICLE_CHANGE] Loading measurements for existing size selection:', selectedSize)
          await loadMeasurementsDirectlyFromArticle(article.id, selectedSize)
        } else {
          // Clear size selection - user needs to choose
          setSelectedSize(null)
          console.log('[ARTICLE_CHANGE] Sizes loaded, waiting for user to select size')
        }
      }
    } else {
      // Clear available sizes when no article selected
      setAvailableSizes([])
      setSelectedSize(null)
    }
  }

  // Helper function to fetch sizes and return them
  const fetchAvailableSizesAndReturn = async (articleId: number): Promise<string[]> => {
    try {
      const sql = `
        SELECT DISTINCT ms.size
        FROM measurement_sizes ms
        JOIN measurements m ON ms.measurement_id = m.id
        WHERE m.article_id = ?
        ORDER BY FIELD(ms.size, 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL')
      `
      const result = await window.database.query<{ size: string }>(sql, [articleId])
      if (result.success && result.data && result.data.length > 0) {
        const sizes = result.data.map(r => r.size)
        console.log('[SIZES] Loaded available sizes:', sizes)
        setAvailableSizes(sizes)
        return sizes
      }
    } catch (err) {
      console.error('Failed to fetch available sizes:', err)
    }
    setAvailableSizes(['S', 'M', 'L', 'XL', 'XXL'])
    return ['S', 'M', 'L', 'XL', 'XXL']
  }

  // Load measurements directly from article (without going through PO article)
  const loadMeasurementsDirectlyFromArticle = async (articleId: number, size: string) => {
    try {
      console.log('[DIRECT_LOAD] Loading measurements for article:', articleId, 'size:', size)
      const directQuery = `
        SELECT 
          m.id,
          m.code,
          m.measurement,
          COALESCE(m.tol_plus, 0) as tol_plus,
          COALESCE(m.tol_minus, 0) as tol_minus,
          ms.size,
          ms.value as expected_value,
          COALESCE(ms.unit, 'cm') as unit,
          a.id as article_id
        FROM articles a
        JOIN measurements m ON m.article_id = a.id
        JOIN measurement_sizes ms ON ms.measurement_id = m.id
        WHERE a.id = ? AND UPPER(TRIM(ms.size)) = UPPER(TRIM(?))
        ORDER BY m.code
      `
      const result = await window.database.query<MeasurementSpec & { article_id?: number }>(directQuery, [articleId, size])
      console.log('[DIRECT_LOAD] Query result:', result.data?.length || 0, 'measurements')

      if (result.success && result.data && result.data.length > 0) {
        console.log('[DIRECT_LOAD] ✓ Loaded measurements:', result.data.map((m: MeasurementSpec) => m.code).join(', '))
        setMeasurementSpecs(result.data as MeasurementSpec[])
        const initialValues: Record<number, string> = {}
        result.data.forEach((spec: MeasurementSpec) => {
          initialValues[spec.id] = ''
        })
        setMeasuredValues(initialValues)
      } else {
        console.log('[DIRECT_LOAD] ✗ No measurements found')
        setMeasurementSpecs([])
        setMeasuredValues({})
      }
    } catch (err) {
      console.error('[DIRECT_LOAD] Error:', err)
      setMeasurementSpecs([])
    }
  }

  const handleArticleTypeChange = (articleTypeId: number | null) => {
    console.log('[SELECTION] Article Type changed to:', articleTypeId)
    setSelectedArticleTypeId(articleTypeId)
    // Reset article selection when type changes
    setSelectedArticleId(null)
    setSelectedPOId(null)
    setSelectedPOArticleId(null)
    setPurchaseOrders([])
    setMeasurementSpecs([])
    setMeasuredValues({})
    setAvailableSizes(['S', 'M', 'L', 'XL', 'XXL']) // Reset to defaults
  }

  // Handle size change - reload measurements for new size
  const handleSizeChange = async (size: string) => {
    console.log('[SELECTION] Size changed to:', size)
    console.log('[SELECTION] Current selectedArticleId:', selectedArticleId)
    console.log('[SELECTION] Current selectedPOArticleId:', selectedPOArticleId)
    setSelectedSize(size)
    setMeasuredValues({})

    // Load measurements for the new size
    // Priority: use selectedArticleId if available (most reliable), otherwise use selectedPOArticleId
    if (selectedArticleId) {
      // Directly load measurements from the selected article
      console.log('[SIZE_CHANGE] Loading measurements directly from article:', selectedArticleId)
      await loadMeasurementsDirectlyFromArticle(selectedArticleId, size)
    } else if (selectedPOArticleId) {
      // Fall back to PO article based query
      await fetchMeasurementSpecsForArticle(selectedPOArticleId, size)
    }
  }

  // Fetch calibration status from Python API
  const fetchCalibrationStatus = async () => {
    try {
      const result = await window.measurement.getCalibrationStatus()
      if (result.status === 'success' && result.data) {
        setCalibrationStatus(result.data)
        console.log('[CALIBRATION] Status:', result.data.calibrated ? 'Calibrated' : 'Not calibrated')
        if (result.data.pixels_per_cm) {
          console.log('[CALIBRATION] Scale:', result.data.pixels_per_cm.toFixed(2), 'px/cm')
        }
      }
    } catch (err) {
      console.error('[CALIBRATION] Failed to fetch status:', err)
    }
  }

  // Start camera calibration
  const handleStartCalibration = async () => {
    try {
      setIsCalibrating(true)
      setError(null)
      console.log('[CALIBRATION] Starting calibration process...')

      const result = await window.measurement.startCalibration()

      if (result.status === 'success') {
        console.log('[CALIBRATION] Calibration window opened. Follow on-screen instructions.')
        // Poll for calibration status every 2 seconds
        const pollInterval = setInterval(async () => {
          const statusResult = await window.measurement.getCalibrationStatus()
          if (statusResult.status === 'success' && statusResult.data) {
            setCalibrationStatus(statusResult.data)
            if (statusResult.data.calibrated) {
              console.log('[CALIBRATION] Calibration completed successfully!')
              setIsCalibrating(false)
              clearInterval(pollInterval)
            }
          }
        }, 2000)

        // Stop polling after 5 minutes (timeout)
        setTimeout(() => {
          clearInterval(pollInterval)
          setIsCalibrating(false)
        }, 300000)
      } else {
        setError(result.message || 'Failed to start calibration')
        setIsCalibrating(false)
      }
    } catch (err) {
      console.error('[CALIBRATION] Error:', err)
      setError('Calibration service unavailable')
      setIsCalibrating(false)
    }
  }

  // Fetch calibration status on mount
  useEffect(() => {
    fetchCalibrationStatus()
  }, [])

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-surface">
      {/* Error Notification - Professional Industrial Toast */}
      {error && (
        <div className="fixed top-4 right-4 z-[200] max-w-md animate-[slideIn_0.3s_ease-out] shadow-2xl">
          <div className="bg-white border border-error/20 rounded-2xl overflow-hidden shadow-xl">
            <div className="bg-error h-1.5 w-full"></div>
            <div className="px-5 py-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-error uppercase tracking-wider mb-1">System Alert</p>
                <p className="text-[14px] text-slate-700 font-medium leading-snug">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-error hover:bg-error/5 transition-all shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main 2-Column Layout - No Scroll Except Measurement Table */}
      <div className="flex gap-4 flex-1 min-h-0 p-4 overflow-hidden">

        {/* LEFT SIDE - Brand + Article Selection + Size */}
        <div className="w-[50%] flex flex-col gap-4 overflow-hidden">

          {/* Brand Selection - Main Section */}
          <div className="card p-6 shrink-0">
            <h3 className="text-touch-2xl font-bold text-primary mb-5 flex items-center gap-3">
              <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Brand / Client
            </h3>
            <div className="flex gap-4 overflow-x-auto scrollbar-hide py-2 px-2 -mx-2">
              {brands.map((brand) => {
                // Map brand names to logo files
                const logoMap: Record<string, string> = {
                  'nike': '/company logo/black-nike-logo-transparent-background-701751694777156f3ewilq1js.png',
                  'adidas': '/company logo/Adidas_Logo.svg.png',
                  'puma': '/company logo/puma.png',
                  'reebok': '/company logo/Reebok_logo19.png',
                  'new balance': '/company logo/New_Balance_logo.svg.png',
                  'under armour': '/company logo/Under_Armour-Logo.wine.png',
                  'champion': '/company logo/champian.jpg',
                  'fila': '/company logo/fila-logo-design-history-and-evolution-kreafolk_94ed6bf4-6bfd-44f9-a60c-fd3f570e120e.webp',
                  'lckr': '/company logo/Lckr-logo.jpg',
                  'bass pro': '/company logo/basspro.jpg',
                  'bass pro shops': '/company logo/basspro.jpg',
                  'basspro': '/company logo/basspro.jpg',
                  'basspro shops': '/company logo/basspro.jpg',
                  'bass': '/company logo/basspro.jpg',
                  'kiabi': '/company logo/kiabi-logo.png',
                  'pull & bear': '/company logo/pullandbear.png',
                  'pull and bear': '/company logo/pullandbear.png',
                  'us polo': '/company logo/us-polo.jpg',
                  'u.s. polo': '/company logo/us-polo.jpg',
                  'us polo assn': '/company logo/us-polo.jpg',
                  'zara': '/company logo/zara.png',
                }
                const logoPath = logoMap[brand.name.toLowerCase()] || null

                return (
                  <button
                    key={brand.id}
                    onClick={() => handleBrandChange(brand.id)}
                    className={`flex-shrink-0 h-28 w-36 p-3 rounded-xl border-3 transition-all duration-200 flex items-center justify-center bg-white brand-logo-bg ${selectedBrandId === brand.id
                      ? 'border-secondary shadow-xl shadow-secondary/40 scale-105 ring-4 ring-secondary/30'
                      : 'border-slate-200 hover:border-secondary hover:shadow-lg hover:scale-102'
                      }`}
                    title={brand.name}
                  >
                    {logoPath && !failedLogos.has(brand.id) ? (
                      <img
                        src={logoPath}
                        alt={brand.name}
                        className="w-full h-full object-contain"
                        onError={() => setFailedLogos(prev => new Set([...prev, brand.id]))}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-white rounded-lg px-2 py-1">
                        <span className={`font-extrabold text-primary text-center leading-tight break-words uppercase tracking-wide ${
                          brand.name.length <= 4 ? 'text-2xl' : brand.name.length <= 8 ? 'text-lg' : brand.name.length <= 14 ? 'text-base' : 'text-sm'
                        }`}>
                          {brand.name}
                        </span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Article Type Selection - Button Pills */}
          <div className="card p-6">
            <h3 className="text-touch-2xl font-bold text-primary mb-5 flex items-center gap-3">
              <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Article Type
            </h3>
            {!selectedBrandId ? (
              <div className="text-center py-6 text-slate-400 text-touch-lg italic">Select a brand first</div>
            ) : articleTypes.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-touch-lg">No article types available</div>
            ) : (
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {articleTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => handleArticleTypeChange(type.id)}
                    className={`flex-shrink-0 px-6 py-4 rounded-xl text-touch-lg font-bold transition-all duration-200 border-2 ${selectedArticleTypeId === type.id
                      ? 'bg-secondary text-white border-secondary shadow-lg shadow-secondary/30'
                      : 'bg-white text-primary border-slate-200 hover:border-secondary hover:text-secondary'
                      }`}
                  >
                    {type.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Article Style Selection - Button Pills */}
          <div className="card p-6">
            <h3 className="text-touch-2xl font-bold text-primary mb-5 flex items-center gap-3">
              <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Article Style
            </h3>
            {!selectedBrandId ? (
              <div className="text-center py-6 text-slate-400 text-touch-lg italic">Select a brand first</div>
            ) : articles.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-touch-lg">No articles available</div>
            ) : (
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {articles.map((article) => (
                  <button
                    key={article.id}
                    onClick={() => handleArticleChange(article.id)}
                    className={`flex-shrink-0 px-6 py-4 rounded-xl text-touch-lg font-bold transition-all duration-200 border-2 ${selectedArticleId === article.id
                      ? 'bg-secondary text-white border-secondary shadow-lg shadow-secondary/30'
                      : 'bg-white text-primary border-slate-200 hover:border-secondary hover:bg-surface-teal'
                      }`}
                  >
                    {article.article_style}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Size Selection - Large Button Pills */}
          <div className="card p-6 flex-1">
            <h3 className="text-touch-2xl font-bold text-primary mb-5 flex items-center gap-3">
              <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              Article Size
            </h3>
            {availableSizes.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-touch-lg italic">
                Select an article to load sizes
              </div>
            ) : (
              <div className="flex gap-4 overflow-x-auto scrollbar-hide py-2 px-2 -mx-2">
                {availableSizes.map((size) => (
                  <button
                    key={size}
                    onClick={() => handleSizeChange(size)}
                    className={`flex-shrink-0 min-w-[80px] px-6 py-4 rounded-xl text-touch-xl font-black transition-all duration-200 border-3 ${selectedSize === size
                      ? 'bg-secondary text-white border-secondary shadow-xl shadow-secondary/40 scale-110'
                      : 'bg-white text-primary border-slate-200 hover:border-secondary hover:shadow-lg'
                      }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT SIDE - Live Measurement Table - NO HORIZONTAL SCROLL */}
        <div className="w-[50%] card overflow-hidden flex flex-col">
          <div className="px-4 py-1 border-b border-slate-200 bg-white shrink-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[16px] font-bold text-primary flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${isPollingActive ? 'bg-success animate-pulse' : 'bg-slate-300'}`}></span>
                Live Measurement
              </h3>

              {/* Garment Color Section */}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Garment Color</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelectedColor(prev => prev === 'white' ? null : 'white')}
                    className={`px-3 py-1.5 text-[12px] font-bold rounded-md border active:scale-95 transition-all whitespace-nowrap ${
                      selectedColor === 'white'
                        ? 'bg-white text-primary border-primary shadow-md ring-2 ring-primary/30'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    White
                  </button>
                  <button
                    onClick={() => setSelectedColor(prev => prev === 'black' ? null : 'black')}
                    className={`px-3 py-1.5 text-[12px] font-bold rounded-md border active:scale-95 transition-all whitespace-nowrap ${
                      selectedColor === 'black'
                        ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-800'
                    }`}
                  >
                    Black
                  </button>
                  <button
                    onClick={() => setSelectedColor(prev => prev === 'other' ? null : 'other')}
                    className={`px-3 py-1.5 text-[12px] font-bold rounded-md border active:scale-95 transition-all whitespace-nowrap ${
                      selectedColor === 'other'
                        ? 'bg-gradient-to-r from-rose-400 via-amber-400 to-teal-400 text-white border-transparent shadow-md'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    Other
                  </button>
                </div>
              </div>

              <span className="text-[15px] font-bold text-white bg-accent px-3 py-1.5 rounded-lg">
                {selectedSize || 'No Size'}
              </span>
            </div>
          </div>
          <div className="overflow-y-auto overflow-x-hidden flex-1">
            <table className="w-full text-touch-base">
              <thead className="bg-surface-teal sticky top-0 z-10 border-b-2 border-primary/10">
                <tr>
                  <th className="px-1 py-4 text-center w-10">
                    <button
                      onClick={() => {
                        if (selectedMeasurementIds.size === measurementSpecs.length && measurementSpecs.length > 0) {
                          const newVals = { ...measuredValues }
                          measurementSpecs.forEach(s => { newVals[s.id] = String(s.expected_value) })
                          setMeasuredValues(newVals)
                          setSelectedMeasurementIds(new Set())
                        } else {
                          const newVals = { ...measuredValues }
                          measurementSpecs.forEach(s => { newVals[s.id] = '' })
                          setMeasuredValues(newVals)
                          setSelectedMeasurementIds(new Set(measurementSpecs.map(s => s.id)))
                        }
                      }}
                      className="w-7 h-7 rounded-md border-2 border-primary/30 flex items-center justify-center hover:bg-primary/10 transition-all mx-auto"
                      title="Select/Deselect All"
                    >
                      {selectedMeasurementIds.size === measurementSpecs.length && measurementSpecs.length > 0 ? (
                        <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : null}
                    </button>
                  </th>
                  <th className="px-3 py-4 text-left text-touch-sm font-bold text-primary uppercase tracking-wide w-14">POM</th>
                  <th className="px-3 py-4 text-left text-touch-sm font-bold text-primary uppercase tracking-wide">Measurement</th>
                  <th className="px-3 py-3 text-center text-touch-sm font-bold text-primary uppercase tracking-wide w-19">
                    <div className="flex flex-col items-center leading-tight">
                      <span>Value</span>
                      <div className="flex items-center gap-0.5 mt-0.5">
                        <button
                          onClick={() => setDisplayUnit('cm')}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${
                            displayUnit === 'cm'
                              ? 'bg-primary text-white shadow-sm'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >CM</button>
                        <button
                          onClick={() => setDisplayUnit('inch')}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${
                            displayUnit === 'inch'
                              ? 'bg-primary text-white shadow-sm'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >INCH</button>
                      </div>
                    </div>
                  </th>
                  <th className="px-3 py-4 text-center text-touch-sm font-bold text-primary uppercase tracking-wide w-28">Tol ±</th>
                  <th className="px-3 py-4 text-center text-touch-sm font-bold text-primary uppercase tracking-wide w-18">Result</th>
                  <th className="px-3 py-4 text-center text-touch-sm font-bold text-primary uppercase tracking-wide w-14">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* Render measurement specs - auto-shift only when measurement mode active (Front/Back pressed) */}
                {measurementSpecs.length > 0 ? (
                  (isShiftLocked
                    ? [...measurementSpecs].sort((a, b) => {
                        const aSelected = selectedMeasurementIds.has(a.id) ? 0 : 1
                        const bSelected = selectedMeasurementIds.has(b.id) ? 0 : 1
                        return aSelected - bSelected
                      })
                    : measurementSpecs
                  ).map((spec) => {
                    const status = calculateStatus(spec)
                    return (
                      <tr key={spec.id} className={`transition-colors ${
                        isShiftLocked
                          ? (selectedMeasurementIds.has(spec.id) ? 'hover:bg-slate-50/80' : 'bg-slate-50/30 opacity-50 border-l-2 border-l-slate-200')
                          : (selectedMeasurementIds.has(spec.id) ? 'bg-success/5' : 'hover:bg-slate-50/80')
                      }`}>
                        <td className="px-1 py-3 text-center">
                          <button
                            onClick={() => toggleMeasurementSelection(spec.id)}
                            className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-all active:scale-90 mx-auto ${
                              selectedMeasurementIds.has(spec.id)
                                ? 'border-success bg-success/10'
                                : 'border-slate-300 bg-white hover:border-slate-400'
                            }`}
                          >
                            {selectedMeasurementIds.has(spec.id) && (
                              <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        </td>
                        <td className="px-2 py-3 font-mono text-touch-sm font-bold text-primary">{spec.code}</td>
                        <td className="px-2 py-3 text-touch-sm text-slate-600 truncate max-w-[120px]" title={spec.measurement}>{spec.measurement}</td>
                        <td className="px-2 py-3 text-center font-bold text-slate-800 text-touch-base">{toDisplayUnit(parseFloat(String(spec.expected_value)) || 0)}</td>

                        {/* Tol± Column - SINGLE INPUT with touch arrows, applies to BOTH +/- */}
                        <td className="px-2 py-3 text-center">
                          {measurementComplete || !isPollingActive ? (
                            <div className="inline-flex items-center gap-1 bg-surface-teal rounded-xl p-1">
                              {/* Down Arrow */}
                              <button
                                type="button"
                                onClick={() => {
                                  const currentVal = parseFloat(editableTols[spec.id]?.tol_plus ?? spec.tol_plus.toString()) || 0
                                  const newVal = Math.max(0, currentVal - 0.1).toFixed(1)
                                  handleToleranceChange(spec.id, 'tol_plus', newVal)
                                  handleToleranceChange(spec.id, 'tol_minus', newVal)
                                }}
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-white text-primary font-bold hover:bg-primary hover:text-white active:bg-primary-dark transition-all shadow-sm"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {/* Single Input */}
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={editableTols[spec.id]?.tol_plus ?? spec.tol_plus.toString()}
                                onChange={(e) => {
                                  handleToleranceChange(spec.id, 'tol_plus', e.target.value)
                                  handleToleranceChange(spec.id, 'tol_minus', e.target.value)
                                }}
                                className="w-14 h-9 px-2 text-center text-touch-base font-bold text-primary bg-white border-2 border-primary/20 rounded-lg focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              {/* Up Arrow */}
                              <button
                                type="button"
                                onClick={() => {
                                  const currentVal = parseFloat(editableTols[spec.id]?.tol_plus ?? spec.tol_plus.toString()) || 0
                                  const newVal = (currentVal + 0.1).toFixed(1)
                                  handleToleranceChange(spec.id, 'tol_plus', newVal)
                                  handleToleranceChange(spec.id, 'tol_minus', newVal)
                                }}
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-white text-primary font-bold hover:bg-primary hover:text-white active:bg-primary-dark transition-all shadow-sm"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <span className="inline-block px-3 py-1.5 bg-surface-teal rounded-lg text-touch-base font-bold text-primary">
                              ±{tolDisplay(parseFloat(String(spec.tol_plus)) || 0)}
                            </span>
                          )}
                        </td>

                        {/* Result - READ ONLY, display-converted from internal cm value */}
                        <td className="px-2 py-3 text-center">
                          <div className={`px-2 py-1.5 rounded text-touch-base font-bold ${measuredValues[spec.id]
                            ? status === 'PASS' ? 'bg-success/10 text-success' : status === 'FAIL' ? 'bg-error/10 text-error' : 'bg-slate-100 text-primary'
                            : 'bg-slate-50 text-slate-300'
                            }`}>
                            {measuredValues[spec.id] ? toDisplayUnit(parseFloat(measuredValues[spec.id])) : '--'}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-2 py-3 text-center">
                          {status === 'PASS' && (
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-success/10 text-success">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          )}
                          {status === 'FAIL' && (
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-error/10 text-error">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </span>
                          )}
                          {status === 'PENDING' && isPollingActive && (
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-500">
                              <span className="w-3 h-3 bg-current rounded-full animate-pulse"></span>
                            </span>
                          )}
                          {status === 'PENDING' && !isPollingActive && (
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-300">
                              <span className="w-2 h-0.5 bg-current rounded-full"></span>
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  [...Array(12)].map((_, index) => (
                    <tr key={`empty-${index}`} className="opacity-30">
                      <td className="px-1 py-3"><div className="h-7 w-7 bg-slate-100 rounded-md mx-auto"></div></td>
                      <td className="px-2 py-3"><div className="h-5 bg-slate-100 rounded w-10"></div></td>
                      <td className="px-2 py-3"><div className="h-5 bg-slate-100 rounded w-20"></div></td>
                      <td className="px-2 py-3 text-center"><div className="h-5 bg-slate-100 rounded w-10 mx-auto"></div></td>
                      <td className="px-2 py-3 text-center"><div className="h-10 bg-slate-100 rounded w-12 mx-auto"></div></td>
                      <td className="px-2 py-3 text-center"><div className="h-8 bg-slate-100 rounded w-12 mx-auto"></div></td>
                      <td className="px-2 py-3 text-center"><div className="h-8 w-8 bg-slate-100 rounded-full mx-auto"></div></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Measurement Action Buttons - All 4 Visible */}
          <div className="px-4 py-3 border-t border-slate-200 bg-white shrink-0">
            {/* Row 1: Front Side | Back Side | Stop */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              {/* Front Side Button - shows check when complete, allows remeasure */}
              <button
                onClick={() => {
                  if (frontSideComplete) {
                    // Remeasure - reset front side
                    setFrontSideComplete(false)
                    setFrontQCChecked(false)
                    setFrontMeasuredValues({})
                    setFrontSelectedIds(new Set())
                    setMeasuredValues({})
                  }
                  handleFrontSideMeasurement()
                }}
                disabled={!selectedSize || isPollingActive}
                className={`py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1 ${!selectedSize || isPollingActive
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : frontSideComplete 
                    ? 'bg-success/20 text-success border-2 border-success hover:bg-success hover:text-white shadow-md'
                    : 'bg-primary text-white hover:bg-primary-dark shadow-md'
                  }`}
              >
                {frontSideComplete ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                Front Side
              </button>

              {/* Back Side Button - shows check when complete, allows remeasure */}
              <button
                onClick={() => {
                  if (backSideComplete) {
                    // Remeasure - reset back side
                    setBackSideComplete(false)
                    setBackQCChecked(false)
                    setBackMeasuredValues({})
                    setBackSelectedIds(new Set())
                    setMeasuredValues({})
                  }
                  handleBackSideMeasurement()
                }}
                disabled={!selectedSize || isPollingActive}
                className={`py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1 ${!selectedSize || isPollingActive
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : backSideComplete 
                    ? 'bg-success/20 text-success border-2 border-success hover:bg-success hover:text-white shadow-md'
                    : 'bg-success text-white hover:bg-success/90 shadow-md'
                  }`}
              >
                {backSideComplete ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                Back Side
              </button>

              {/* Stop Button */}
              <button
                onClick={handleStopMeasurement}
                disabled={!isPollingActive}
                className={`py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1 ${!isPollingActive
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-error text-white hover:bg-error/90 shadow-md'
                  }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                Stop
              </button>
            </div>

            {/* Row 2: Start QC | Next Article */}
            <div className="grid grid-cols-2 gap-2">
              {/* Start QC - enabled when at least one side is complete */}
              <button
                onClick={() => handleCheckQC()}
                disabled={!frontSideComplete && !backSideComplete}
                className={`py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${!frontSideComplete && !backSideComplete
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-warning text-white hover:bg-warning/90 shadow-md'
                  }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Start QC
              </button>

              {/* Next Article - robust save + verification before navigation */}
              <button
                onClick={handleNextArticle}
                disabled={(!frontSideComplete && !backSideComplete) || isSavingNextArticle}
                className={`py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${(!frontSideComplete && !backSideComplete) || isSavingNextArticle
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-primary text-white hover:bg-primary-dark shadow-md'
                  }`}
              >
                {isSavingNextArticle ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    Next Article
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* QC Result Popup Modal */}
      {showQCResult && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[500px] max-h-[80vh] overflow-y-auto">
            {/* Header - Show which side was checked */}
            <div className={`px-6 py-5 flex flex-col items-center justify-center gap-2 rounded-t-2xl ${qcPassed ? 'bg-success' : 'bg-error'}`}>
              {lastQCSide && (
                <span className="px-3 py-1 bg-white/20 rounded-full text-white text-xs font-semibold uppercase tracking-wide">
                  {lastQCSide} Side
                </span>
              )}
              {qcPassed ? (
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-touch-2xl font-bold text-white">QC PASSED</h2>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h2 className="text-touch-2xl font-bold text-white">QC FAILED</h2>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="p-6">
              {qcPassed ? (
                <div className="text-center py-4">
                  <div className="w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-touch-lg text-slate-700 font-medium">
                    All measurements are within tolerance.
                  </p>
                  <p className="text-touch-sm text-slate-500 mt-2">
                    {lastQCSide === 'front' ? 'Front' : 'Back'} side has passed quality control inspection.
                  </p>
                </div>
              ) : (
                /* QC FAILED — clean spacer only, no diagnostic text */
                <div className="py-2" />
              )}
            </div>

            {/* Footer - with Remeasure option for failed QC */}
            <div className="px-6 pb-6 space-y-3">
              {!qcPassed && (
                <button
                  onClick={() => {
                    // Allow remeasure of the side that failed
                    if (lastQCSide === 'front') {
                      setFrontSideComplete(false)
                      setFrontQCChecked(false)
                      setFrontMeasuredValues({})
                      setFrontSelectedIds(new Set())
                    } else if (lastQCSide === 'back') {
                      setBackSideComplete(false)
                      setBackQCChecked(false)
                      setBackMeasuredValues({})
                      setBackSelectedIds(new Set())
                    }
                    setMeasuredValues({})
                    setShowQCResult(false)
                    setMeasurementComplete(false)
                  }}
                  className="w-full py-4 font-bold text-touch-lg rounded-xl transition-colors bg-warning text-white hover:bg-warning/90"
                >
                  Remeasure {lastQCSide === 'front' ? 'Front' : 'Back'} Side
                </button>
              )}
              <button
                onClick={handleQCClose}
                className={`w-full py-4 font-bold text-touch-lg rounded-xl transition-colors ${qcPassed
                  ? 'bg-success text-white hover:bg-success/90'
                  : 'bg-slate-300 text-slate-700 hover:bg-slate-400'
                  }`}
              >
                {qcPassed ? 'Continue' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

