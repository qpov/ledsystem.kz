// server.js

const express = require('express');
const mariadb = require('mariadb');
const path = require('path');
const cors = require('cors');
const ejs = require('ejs');
const session = require('express-session');
const flash = require('connect-flash');
const csrf = require('csurf');
const helmet = require('helmet');
const crypto = require('crypto'); // Для генерации assetVersion
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------- Настройка EJS ---------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --------------------- Middleware --------------------------

// CORS (если требуется)
app.use(cors());

// Helmet для безопасности, включая настройку CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        }
    },
}));

// Парсинг JSON и URL-encoded данных
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Настройка express-session
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Настройка connect-flash
app.use(flash());

// Настройка CSRF защиты
const csrfProtection = csrf();

// Middleware для передачи сообщений и информации о пользователе в шаблоны
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    res.locals.user = req.session.user || null;
    next();
});

// --------------------- Установка Переменной Версии ----------------------------
// Генерация уникального хеша при запуске сервера
app.locals.assetVersion = crypto.randomBytes(8).toString('hex');
// Альтернативный вариант: использование timestamp
// app.locals.assetVersion = Date.now();

// --------------------- Подключение к БД ----------------------
let pool;
(async () => {
    try {
        pool = mariadb.createPool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'p-344906_site',
            password: process.env.DB_PASSWORD || '%5yP604cj',
            database: process.env.DB_NAME || 'p-344906_site',
            connectionLimit: 5,
            charset: 'utf8mb4',
            bigIntAsNumber: true
        });
        const conn = await pool.getConnection();
        console.log('Подключено к базе данных MariaDB');
        conn.release();
    } catch (err) {
        console.error('Ошибка подключения к базе данных:', err);
        process.exit(1);
    }
})();

// --------------------- Передача Pool в Middleware ---------------------
app.use((req, res, next) => {
    req.app.locals.pool = pool;
    next();
});

// --------------------- Статические Файлы с Настройкой Кэширования ----------------------------

// Функция для установки заголовков кэширования
const setNoCacheHeaders = (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
};

// Обслуживание статических файлов с отключением кэширования
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    etag: false,
    maxAge: 0,
    setHeaders: setNoCacheHeaders
}));

app.use('/css', express.static(path.join(__dirname, 'public/css'), {
    etag: false,
    maxAge: 0,
    setHeaders: setNoCacheHeaders
}));

app.use('/js', express.static(path.join(__dirname, 'public/js'), {
    etag: false,
    maxAge: 0,
    setHeaders: setNoCacheHeaders
}));

app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    maxAge: 0,
    setHeaders: setNoCacheHeaders
}));

// --------------------- Подключение Маршрутов ----------------------
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// --------------------- API Маршруты ----------------------------

app.get('/api/products', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const offset = (page - 1) * limit;

    try {
        const products = await pool.query('SELECT * FROM products LIMIT ? OFFSET ?', [limit, offset]);
        const totalResult = await pool.query('SELECT COUNT(*) as count FROM products');
        const total = totalResult[0].count;

        res.json({
            products: products,
            total: total,
            page: page,
            limit: limit
        });
    } catch (err) {
        console.error('Ошибка при получении продуктов:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    const productId = req.params.id;

    try {
        const productResult = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);

        if (productResult.length === 0) {
            return res.status(404).json({ error: 'Продукт не найден' });
        }

        res.json(productResult[0]);
    } catch (err) {
        console.error('Ошибка при получении продукта:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --------------------- Публичные Маршруты ----------------------------

app.get('/', (req, res) => {
    res.redirect('/catalog.html');
});

app.get('/product/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        console.log(`Fetching product with ID: ${productId}`);
        const products = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);

        if (products.length === 0) {
            console.warn(`Product with ID ${productId} not found.`);
            return res.status(404).send('Товар не найден');
        }

        const product = products[0];
        const displayPrice = parseFloat(product.price).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        res.render('product', { product, displayPrice });
    } catch (err) {
        console.error('Ошибка при получении товара:', err);
        res.status(500).send('Ошибка сервера');
    }
});

// --------------------- Обработчик Ошибок ----------------------------

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({ 
        error: 'Внутренняя ошибка сервера',
        details: err.message
    });
});

// --------------------- Запуск сервера ----------------------------
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
