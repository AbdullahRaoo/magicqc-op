/**
 * TypeScript types for MagicQC Database Schema
 * Generated from MySQL database structure
 */

// Brand types
export interface Brand {
  id: number
  name: string
  description?: string | null
  created_at?: string | null
  updated_at?: string | null
}

// Article Type types
export interface ArticleType {
  id: number
  name: string
  created_at: string | null
  updated_at: string | null
}

// Article types
export interface Article {
  id: number
  brand_id: number
  article_type_id: number
  article_style: string
  description: string | null
  created_at: string | null
  updated_at: string | null
}

// Article with relations (extended for measurement workflow)
export interface ArticleWithRelations extends Article {
  brand?: Brand
  article_type?: ArticleType
  brand_name?: string
  brand_description?: string | null
  article_type_name?: string
}

// Measurement types
export interface Measurement {
  id: number
  article_id: number
  code: string
  measurement: string
  tol_plus: number | null
  tol_minus: number | null
  created_at: string | null
  updated_at: string | null
}

// Measurement Size types
export interface MeasurementSize {
  id: number
  measurement_id: number
  size: string
  value: number
  unit: string
  created_at: string | null
  updated_at: string | null
}

// Measurement with sizes
export interface MeasurementWithSizes extends Measurement {
  sizes?: MeasurementSize[]
}

// Purchase Order types
export type PurchaseOrderStatus = 'Active' | 'Pending' | 'Completed'

export interface PurchaseOrder {
  id: number
  po_number: string
  date: string
  brand_id: number
  country: string
  status: PurchaseOrderStatus
  created_at: string | null
  updated_at: string | null
}

// Purchase Order with relations
export interface PurchaseOrderWithRelations extends PurchaseOrder {
  brand?: Brand
  brand_name?: string
  brand_description?: string | null
  articles?: PurchaseOrderArticle[]
  client_references?: PurchaseOrderClientReference[]
}

// Purchase Order Article types
export interface PurchaseOrderArticle {
  id: number
  purchase_order_id: number
  article_type_id: number
  article_style: string
  article_description: string | null
  article_color: string | null
  order_quantity: number
  created_at: string | null
  updated_at: string | null
}

// Purchase Order Article with relations
export interface PurchaseOrderArticleWithRelations extends PurchaseOrderArticle {
  article_type?: ArticleType
}

// Purchase Order Client Reference types
export interface PurchaseOrderClientReference {
  id: number
  purchase_order_id: number
  reference_name: string
  reference_number: string | null
  reference_email_address: string | null
  email_subject: string | null
  email_date: string | null
  created_at: string | null
  updated_at: string | null
}

// Operator types
export interface Operator {
  id: number
  full_name: string
  employee_id: string
  department: string | null
  contact_number?: string | null
  login_pin?: string
  created_at?: string | null
  updated_at?: string | null
}

// User types
export interface User {
  id: number
  name: string
  email: string
  email_verified_at: string | null
  password: string
  remember_token: string | null
  avatar: string | null
  created_at: string | null
  updated_at: string | null
}

// Database query result types
export interface DatabaseResult<T> {
  success: boolean
  data?: T
  error?: string
}

export interface DatabaseQueryResult<T> extends DatabaseResult<T[]> {
  data?: T[]
}

export interface DatabaseExecuteResult extends DatabaseResult<{
  affectedRows: number
  insertId?: number
}> { }

// Measurement Result types (stores actual measured values)
export type MeasurementStatus = 'PASS' | 'FAIL' | 'PENDING'

export interface MeasurementResult {
  id: number
  purchase_order_article_id: number
  measurement_id: number
  size: string
  measured_value: number | null
  status: MeasurementStatus
  operator_id: number | null
  created_at: string | null
  updated_at: string | null
}

// Combined spec data for measurement table display
export interface MeasurementSpec {
  id: number
  code: string
  measurement: string
  tol_plus: number
  tol_minus: number
  size: string
  expected_value: number
  unit: string
}

// Job Card Summary (read-only display)
export interface JobCardSummary {
  po_number: string
  brand_name: string
  article_type_name: string
  country: string
  article_description: string | null
  article_style: string
}

// Article Annotation from database
export interface ArticleAnnotation {
  id: number
  article_id: number | null
  article_image_id: number | null
  article_style: string
  size: string
  name: string
  annotations: string  // JSON string of annotation points [{x, y, label}] (percentages)
  keypoints_pixels: string | null  // JSON string [[x, y], ...] (pixel coordinates for measurement)
  target_distances: string | null  // JSON string {"1": 3.81, "2": 19.56} (distances in cm)
  placement_box: string | null  // JSON string [x1, y1, x2, y2] (pixels)
  image_width: number | null
  image_height: number | null
  reference_image_path: string | null
  image_data: string | null  // Base64 encoded image
  image_mime_type: string | null
  json_file_path: string | null
  created_at: string | null
  updated_at: string | null
}

// Parsed annotation point (percentage format for web UI)
export interface AnnotationPoint {
  x: number
  y: number
  label: string
}

// Keypoint in pixel format for measurement system
export type KeypointPixel = [number, number]

// Target distances map (pair index -> distance in cm)
export interface TargetDistances {
  [key: string]: number
}
