-- Migration: Add Measurement Analytics Tables
-- Run this migration to add detailed measurement tracking for analytics

-- 1. Measurement Results Detailed (stores detailed measurements with side info for analytics)
-- This table stores every measurement with front/back side distinction
-- Old measurements for the same article/size/side are automatically replaced
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
    INDEX idx_article_style (article_style),
    INDEX idx_created_at (created_at)
);

-- 2. Measurement Sessions (tracks complete measurement sessions for analytics)
-- This table tracks when articles are measured (front/back complete) for reporting
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
    UNIQUE KEY unique_session (purchase_order_article_id, size),
    INDEX idx_operator (operator_id),
    INDEX idx_completed_at (completed_at),
    INDEX idx_qc_results (front_qc_result, back_qc_result)
);

-- Analytics Views (optional - for reporting)

-- View: Daily QC Summary
CREATE OR REPLACE VIEW v_daily_qc_summary AS
SELECT 
    DATE(ms.completed_at) as measurement_date,
    COUNT(*) as total_articles,
    SUM(CASE WHEN ms.front_qc_result = 'PASS' THEN 1 ELSE 0 END) as front_passed,
    SUM(CASE WHEN ms.front_qc_result = 'FAIL' THEN 1 ELSE 0 END) as front_failed,
    SUM(CASE WHEN ms.back_qc_result = 'PASS' THEN 1 ELSE 0 END) as back_passed,
    SUM(CASE WHEN ms.back_qc_result = 'FAIL' THEN 1 ELSE 0 END) as back_failed,
    o.full_name as operator_name
FROM measurement_sessions ms
LEFT JOIN operators o ON ms.operator_id = o.id
WHERE ms.completed_at IS NOT NULL
GROUP BY DATE(ms.completed_at), ms.operator_id, o.full_name
ORDER BY measurement_date DESC;

-- View: Article Pass/Fail Rate
CREATE OR REPLACE VIEW v_article_qc_rates AS
SELECT 
    ms.article_style,
    COUNT(*) as total_measured,
    ROUND(100.0 * SUM(CASE WHEN ms.front_qc_result = 'PASS' AND ms.back_qc_result = 'PASS' THEN 1 ELSE 0 END) / COUNT(*), 2) as pass_rate_pct,
    ROUND(100.0 * SUM(CASE WHEN ms.front_qc_result = 'FAIL' OR ms.back_qc_result = 'FAIL' THEN 1 ELSE 0 END) / COUNT(*), 2) as fail_rate_pct
FROM measurement_sessions ms
WHERE ms.completed_at IS NOT NULL
GROUP BY ms.article_style
ORDER BY total_measured DESC;

-- View: Operator Performance
CREATE OR REPLACE VIEW v_operator_performance AS
SELECT 
    o.full_name as operator_name,
    o.employee_id,
    COUNT(DISTINCT ms.id) as articles_measured,
    ROUND(AVG(TIMESTAMPDIFF(MINUTE, ms.created_at, ms.completed_at)), 1) as avg_time_minutes,
    ROUND(100.0 * SUM(CASE WHEN ms.front_qc_result = 'PASS' AND ms.back_qc_result = 'PASS' THEN 1 ELSE 0 END) / COUNT(*), 2) as pass_rate_pct
FROM operators o
LEFT JOIN measurement_sessions ms ON o.id = ms.operator_id AND ms.completed_at IS NOT NULL
GROUP BY o.id, o.full_name, o.employee_id
ORDER BY articles_measured DESC;
