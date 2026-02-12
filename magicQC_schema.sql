-- MagicQC Database Schema
-- Created to match TypeScript definitions in src/types/database.ts

CREATE DATABASE IF NOT EXISTS magicQC;
USE magicQC;

-- 1. Brands
CREATE TABLE IF NOT EXISTS brands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Article Types
CREATE TABLE IF NOT EXISTS article_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. Articles
CREATE TABLE IF NOT EXISTS articles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    brand_id INT NOT NULL,
    article_type_id INT NOT NULL,
    article_style VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id),
    FOREIGN KEY (article_type_id) REFERENCES article_types(id)
);

-- 4. Measurements
CREATE TABLE IF NOT EXISTS measurements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    article_id INT NOT NULL,
    code VARCHAR(100) NOT NULL,
    measurement VARCHAR(255) NOT NULL,
    tol_plus DECIMAL(10, 2),
    tol_minus DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id)
);

-- 5. Measurement Sizes
CREATE TABLE IF NOT EXISTS measurement_sizes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    measurement_id INT NOT NULL,
    size VARCHAR(50) NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (measurement_id) REFERENCES measurements(id)
);

-- 6. Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    po_number VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    brand_id INT NOT NULL,
    country VARCHAR(100) NOT NULL,
    status ENUM('Active', 'Pending', 'Completed') DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id)
);

-- 7. Purchase Order Articles
CREATE TABLE IF NOT EXISTS purchase_order_articles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_order_id INT NOT NULL,
    article_type_id INT NOT NULL,
    article_style VARCHAR(255) NOT NULL,
    article_description TEXT,
    article_color VARCHAR(100),
    order_quantity INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
    FOREIGN KEY (article_type_id) REFERENCES article_types(id)
);

-- 8. Purchase Order Client References
CREATE TABLE IF NOT EXISTS purchase_order_client_references (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_order_id INT NOT NULL,
    reference_name VARCHAR(255) NOT NULL,
    reference_number VARCHAR(100),
    reference_email_address VARCHAR(255),
    email_subject VARCHAR(255),
    email_date DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
);

-- 9. Operators
CREATE TABLE IF NOT EXISTS operators (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    employee_id VARCHAR(100) NOT NULL UNIQUE,
    department VARCHAR(255),
    login_pin VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 10. Users
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    email_verified_at TIMESTAMP NULL,
    password VARCHAR(255) NOT NULL,
    remember_token VARCHAR(100),
    avatar VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 11. Measurement Results (stores actual measured values from operators)
CREATE TABLE IF NOT EXISTS measurement_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_order_article_id INT NOT NULL,
    measurement_id INT NOT NULL,
    size VARCHAR(50) NOT NULL,
    measured_value DECIMAL(10, 2),
    status ENUM('PASS', 'FAIL', 'PENDING') DEFAULT 'PENDING',
    operator_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_article_id) REFERENCES purchase_order_articles(id),
    FOREIGN KEY (measurement_id) REFERENCES measurements(id),
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    UNIQUE KEY unique_measurement (purchase_order_article_id, measurement_id, size)
);

-- 12. Measurement Results Detailed (stores detailed measurements with side info for analytics)
CREATE TABLE IF NOT EXISTS measurement_results_detailed (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_order_article_id INT NOT NULL,
    measurement_id INT NOT NULL,
    size VARCHAR(50) NOT NULL,
    side ENUM('front', 'back') NOT NULL,
    article_style VARCHAR(255),
    measured_value DECIMAL(10, 2),
    expected_value DECIMAL(10, 2),
    tol_plus DECIMAL(10, 2),
    tol_minus DECIMAL(10, 2),
    status ENUM('PASS', 'FAIL', 'PENDING') DEFAULT 'PENDING',
    operator_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_article_id) REFERENCES purchase_order_articles(id),
    FOREIGN KEY (measurement_id) REFERENCES measurements(id),
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    INDEX idx_article_size_side (purchase_order_article_id, size, side),
    INDEX idx_article_style (article_style)
);

-- 13. Measurement Sessions (tracks complete measurement sessions for analytics)
CREATE TABLE IF NOT EXISTS measurement_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_order_article_id INT NOT NULL,
    size VARCHAR(50) NOT NULL,
    article_style VARCHAR(255),
    operator_id INT,
    front_side_complete TINYINT(1) DEFAULT 0,
    back_side_complete TINYINT(1) DEFAULT 0,
    front_qc_result ENUM('PASS', 'FAIL') NULL,
    back_qc_result ENUM('PASS', 'FAIL') NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_order_article_id) REFERENCES purchase_order_articles(id),
    FOREIGN KEY (operator_id) REFERENCES operators(id),
    UNIQUE KEY unique_session (purchase_order_article_id, size)
);

-- Seed some initial data for testing
INSERT INTO brands (name) VALUES ('Nike'), ('Adidas'), ('Puma'), ('Uniqlo');
INSERT INTO article_types (name) VALUES ('T-Shirt'), ('Polo Shirt'), ('Trouser'), ('Jacket');

