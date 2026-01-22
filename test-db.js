const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const promisePool = pool.promise();

async function testConnection() {
    try {
        const [rows] = await promisePool.execute('SELECT 1 + 1 AS result');
        console.log('Database connection successful:', rows);
        
        // Check if tables exist
        const [tables] = await promisePool.execute('SHOW TABLES');
        console.log('Tables in database:', tables);
        
        // Check users table structure
        const [usersTable] = await promisePool.execute('DESCRIBE users');
        console.log('Users table structure:', usersTable);
        
    } catch (error) {
        console.error('Database connection failed:', error);
    } finally {
        pool.end();
    }
}

testConnection();