# MySQL Database Setup Guide - MagicQC Operator Panel

This guide explains how to connect your Electron application to the MagicQC MySQL database.

## 📋 Prerequisites

- MySQL server running (via XAMPP, WAMP, MAMP, or standalone MySQL)
- phpMyAdmin access to your database
- MagicQC database already created and populated

## 🔧 Setup Instructions

### 1. Database Information

The MagicQC database (`magicQC`) contains the following main tables:
- **brands** - Clothing brands (Nike, Adidas, Puma, etc.)
- **article_types** - Types of articles (T-Shirt, Polo Shirt, Trouser, etc.)
- **articles** - Individual articles with style codes
- **measurements** - Measurement specifications for articles
- **measurement_sizes** - Size-specific measurement values
- **purchase_orders** - Purchase order records
- **purchase_order_articles** - Articles in purchase orders
- **purchase_order_client_references** - Client reference information
- **operators** - Operator/employee records
- **users** - System users

### 2. Configure Environment Variables

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file with your database credentials:
   ```env
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_mysql_password
   DB_NAME=magicQC
   ```

   **Important Notes:**
   - `DB_HOST`: Usually `localhost` for local development
   - `DB_PORT`: Default MySQL port is `3306`
   - `DB_USER`: Default is `root` for XAMPP/WAMP
   - `DB_PASSWORD`: Your MySQL root password (leave empty if no password)
   - `DB_NAME`: Must be `magicQC` (case-sensitive)

## 🚀 Usage in Your React Components

### Fetching Purchase Orders

```typescript
import { useState, useEffect } from 'react'
import type { PurchaseOrderWithRelations } from '../types/database'

function PurchaseOrdersComponent() {
  const [orders, setOrders] = useState<PurchaseOrderWithRelations[]>([])

  useEffect(() => {
    fetchOrders()
  }, [])

  const fetchOrders = async () => {
    const result = await window.database.query<PurchaseOrderWithRelations>(
      `SELECT 
        po.*,
        b.name as brand_name
       FROM purchase_orders po
       LEFT JOIN brands b ON po.brand_id = b.id
       WHERE po.status = ?
       ORDER BY po.date DESC`,
      ['Active']
    )
    
    if (result.success && result.data) {
      setOrders(result.data)
    }
  }

  return <div>{/* Your UI */}</div>
}
```

### Fetching Articles with Relations

```typescript
const fetchArticles = async (brandId?: number) => {
  let sql = `
    SELECT 
      a.*,
      b.name as brand_name,
      at.name as article_type_name
    FROM articles a
    LEFT JOIN brands b ON a.brand_id = b.id
    LEFT JOIN article_types at ON a.article_type_id = at.id
  `
  const params: any[] = []

  if (brandId) {
    sql += ' WHERE a.brand_id = ?'
    params.push(brandId)
  }

  sql += ' ORDER BY a.article_style'

  const result = await window.database.query<ArticleWithRelations>(sql, params)
  return result
}
```

### Fetching Measurements for an Article

```typescript
const fetchArticleMeasurements = async (articleId: number) => {
  const result = await window.database.query<MeasurementWithSizes>(
    `SELECT 
      m.*,
      GROUP_CONCAT(
        CONCAT(ms.size, ':', ms.value, ms.unit) 
        SEPARATOR ','
      ) as sizes
    FROM measurements m
    LEFT JOIN measurement_sizes ms ON m.id = ms.measurement_id
    WHERE m.article_id = ?
    GROUP BY m.id`,
    [articleId]
  )
  return result
}
```

### Creating a Purchase Order

```typescript
const createPurchaseOrder = async (
  poNumber: string,
  date: string,
  brandId: number,
  country: string
) => {
  const result = await window.database.execute(
    `INSERT INTO purchase_orders (po_number, date, brand_id, country, status)
     VALUES (?, ?, ?, ?, 'Pending')`,
    [poNumber, date, brandId, country]
  )
  
  if (result.success && result.data) {
    return result.data.insertId
  }
  return null
}
```

### Using Prepared Statements (Recommended for Security)

```typescript
// Fetch purchase order by PO number
const result = await window.database.queryOne<PurchaseOrder>(
  'SELECT * FROM purchase_orders WHERE po_number = ?',
  [poNumber]
)

// Update purchase order status
const updateResult = await window.database.execute(
  'UPDATE purchase_orders SET status = ? WHERE id = ?',
  ['Completed', orderId]
)

// Add article to purchase order
const addArticleResult = await window.database.execute(
  `INSERT INTO purchase_order_articles 
   (purchase_order_id, article_type_id, article_style, article_description, article_color, order_quantity)
   VALUES (?, ?, ?, ?, ?, ?)`,
  [orderId, articleTypeId, style, description, color, quantity]
)
```

## 📚 Available Database Methods

### `window.database.query<T>(sql, params?)`
Execute a SELECT query and return an array of results.

**Returns:** `{ success: boolean, data?: T[], error?: string }`

**Example:**
```typescript
const result = await window.database.query<User>(
  'SELECT * FROM users WHERE active = ?',
  [true]
)
```

### `window.database.queryOne<T>(sql, params?)`
Execute a SELECT query and return a single result.

**Returns:** `{ success: boolean, data?: T | null, error?: string }`

**Example:**
```typescript
const result = await window.database.queryOne<User>(
  'SELECT * FROM users WHERE id = ?',
  [userId]
)
```

### `window.database.execute(sql, params?)`
Execute INSERT, UPDATE, or DELETE queries.

**Returns:** `{ success: boolean, data?: { affectedRows: number, insertId?: number }, error?: string }`

**Example:**
```typescript
const result = await window.database.execute(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  [name, email]
)

if (result.success && result.data) {
  console.log('New user ID:', result.data.insertId)
  console.log('Rows affected:', result.data.affectedRows)
}
```

### `window.database.testConnection()`
Test the database connection.

**Returns:** `{ success: boolean, message?: string, error?: string }`

**Example:**
```typescript
const result = await window.database.testConnection()
if (result.success) {
  console.log('Database connected!')
} else {
  console.error('Connection failed:', result.error)
}
```

## 🔒 Security Best Practices

1. **Always use prepared statements** - Never concatenate user input directly into SQL queries
   ```typescript
   // ❌ BAD - SQL Injection vulnerability
   const sql = `SELECT * FROM users WHERE id = ${userId}`
   
   // ✅ GOOD - Using prepared statements
   const result = await window.database.query('SELECT * FROM users WHERE id = ?', [userId])
   ```

2. **Keep credentials secure** - Never commit `.env` file to version control
   - The `.env` file is already in `.gitignore`

3. **Validate input** - Always validate user input before passing to database queries

4. **Handle errors gracefully** - Always check the `success` property before using `data`

## 🐛 Troubleshooting

### Connection Refused
- Verify MySQL server is running
- Check `DB_HOST` and `DB_PORT` in `.env`
- Ensure MySQL is listening on the correct port

### Access Denied
- Verify `DB_USER` and `DB_PASSWORD` in `.env`
- Check MySQL user permissions in phpMyAdmin

### Database Not Found
- Verify `DB_NAME` matches your database name in phpMyAdmin
- Ensure the database exists

### Module Not Found
- Run `npm install` to ensure all dependencies are installed
- Verify `mysql2` and `dotenv` are in `package.json`

## 📝 Example Component

See `src/examples/DatabaseExample.tsx` for a complete working example with all CRUD operations.

## 🎯 Next Steps

1. Create your database tables in phpMyAdmin
2. Configure your `.env` file
3. Test the connection using `window.database.testConnection()`
4. Start building your application with database queries!

