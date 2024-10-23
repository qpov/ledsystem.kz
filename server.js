// server.js

const express = require('express');
const mariadb = require('mariadb');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const flash = require('connect-flash');
const { body, validationResult } = require('express-validator');
const csrf = require('csurf');
const fs = require('fs').promises;
const helmet = require('helmet');
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
            scriptSrc: ["'self'"], // Разрешаем скрипты только с самого сайта
            styleSrc: ["'self'", "'unsafe-inline'"], // Разрешаем стили с самого сайта и inline-стили
            imgSrc: ["'self'", "data:"], // Разрешаем изображения с самого сайта и data URIs
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        }
    },
    // Другие настройки Helmet по необходимости
}));

// Заголовки для предотвращения кеширования
app.use((req, res, next) => {
    res.header('Cache-Control', 'no-store');
    next();
});

// Парсинг JSON и URL-encoded данных
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Настройка express-session
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key', // Замените на надёжный секрет в .env
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Установите `true` при использовании HTTPS
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
            charset: 'utf8mb4', // Установить charset
            bigIntAsNumber: true // Добавлено для обработки BIGINT как Number
        });
        // Тестирование соединения
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

// --------------------- Подключение Маршрутов ----------------------
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// --------------------- API Маршруты ----------------------------

/**
 * GET /api/products?page=1&limit=12
 * Возвращает список продуктов с пагинацией
 */
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

/**
 * GET /api/products/:id
 * Возвращает информацию о конкретном продукте
 */
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

/**
 * Главная страница перенаправляет на каталог
 */
app.get('/', (req, res) => {
    res.redirect('/catalog.html');
});

/**
 * Отображение отдельного товара через EJS
 */
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

// Этот обработчик ошибок перехватывает все необработанные ошибки
// и отправляет подробную информацию об ошибках на клиентскую сторону
// Только для отладки. Удалите или закомментируйте этот код в продакшн-среде
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({ 
        error: 'Внутренняя ошибка сервера',
        details: err.message // Отправляем подробности ошибки
    });
});

// --------------------- Запуск сервера ----------------------------
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});

// --------------------- Установка Переменной Версии ----------------------------
const crypto = require('crypto');

// Генерация уникального хеша при запуске сервера
app.locals.assetVersion = crypto.randomBytes(8).toString('hex');