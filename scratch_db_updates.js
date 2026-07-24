require('dotenv').config();
const mysql = require('mysql2');
const db = mysql.createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false }
});

const sql = `ALTER TABLE teacher_slots 
    ADD COLUMN status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved',
    ADD COLUMN created_by ENUM('teacher', 'admin') DEFAULT 'teacher',
    ADD COLUMN reject_reason TEXT;`;

db.query(sql, (err, result) => {
    if (err) {
        console.error("Error updating schema:", err);
    } else {
        console.log("Schema updated successfully:", result);
    }
    process.exit();
});
