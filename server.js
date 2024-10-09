// server.js

const express = require('express');
const mariadb = require('mariadb'); // Используем mariadb вместо mysql2
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const flash = require('connect-flash');
const { body, validationResult } = require('express-validator');
const csrf = require('csurf');
const fs = require('fs').promises; // Перенесено наверх для использования в delete handler
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------- Настройка EJS ---------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --------------------- Middleware --------------------------

// CORS (если требуется)
app.use(cors());

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

// --------------------- Настройка Multer ---------------------
// Настройка хранилища для загрузки изображений
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Папка для сохранения изображений
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

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

// --------------------- Middleware для проверки аутентификации ---------------------
// Проверяет, авторизован ли пользователь как администратор
function isAuthenticated(req, res, next) {
    if (req.session.user && req.session.user.isAdmin) {
        return next();
    }
    req.flash('error_msg', 'Пожалуйста, войдите в административную панель.');
    res.redirect('/admin/login');
}

// --------------------- Функция для Преобразования BigInt ---------------------
function replaceBigInt(obj) {
    if (typeof obj === 'bigint') {
        return obj.toString();
    } else if (Array.isArray(obj)) {
        return obj.map(replaceBigInt);
    } else if (obj !== null && typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, replaceBigInt(v)])
        );
    }
    return obj;
}

// --------------------- API Маршруты ------------------------------

// Получение всех товаров для каталога с поддержкой пагинации
app.get('/api/products', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const offset = (page - 1) * limit;

        console.log(`Fetching products: page=${page}, limit=${limit}, offset=${offset}`);

        const conn = await pool.getConnection();

        // SELECT запрос возвращает массив объектов
        const products = await conn.query(
            'SELECT id, name, price, image, description FROM products ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [limit, offset]
        );

        // COUNT запрос возвращает массив с одним объектом
        const countResult = await conn.query('SELECT COUNT(*) as total FROM products');
        const total = countResult[0].total;

        conn.release();

        console.log(`Total products: ${total}`);

        // Преобразуем данные, чтобы избежать BigInt
        const safeProducts = replaceBigInt(products);
        const safeTotal = replaceBigInt(total);

        res.json({
            products: safeProducts,
            total: safeTotal
        });
    } catch (err) {
        console.error('Ошибка при получении продуктов:', err);
        res.status(500).json({ 
            error: 'Ошибка сервера',
            details: err.message // Отправляем подробности ошибки
        });
    }
});

// --------------------- Публичные Маршруты ----------------------------

// Перенаправление на каталог
app.get('/', (req, res) => {
    res.redirect('/catalog.html');
});

// Отображение отдельного товара
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

// --------------------- Административные Маршруты ----------------------

// Отображение страницы входа в админ-панель
app.get('/admin/login', csrfProtection, (req, res) => {
    const loggedOut = req.query.logged_out === '1'; // Проверяем наличие параметра
    res.render('admin_login', { 
        errors: [], 
        username: '', 
        csrfToken: req.csrfToken(), // Передаём CSRF-токен
        loggedOut // Передаём флаг выхода
    });
});

// Обработка входа в админ-панель
app.post('/admin/login',
    csrfProtection, // Применяем csurf
    [
        body('username').notEmpty().withMessage('Имя пользователя обязательно'),
        body('password').notEmpty().withMessage('Пароль обязателен')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('admin_login', {
                errors: errors.array(),
                username: req.body.username,
                csrfToken: req.csrfToken(), // Обновляем CSRF-токен
                loggedOut: false
            });
        }

        let { username, password } = req.body;
        console.log('Попытка входа с именем пользователя:', username); // Добавлено для отладки

        try {
            const result = await pool.query('SELECT * FROM admin WHERE username = ?', [username]);
            console.log('Результаты запроса:', result); // Добавлено для отладки

            if (result.length === 0) {
                req.flash('error_msg', 'Неверное имя пользователя или пароль');
                return res.redirect('/admin/login');
            }

            const admin = result[0];
            console.log('Полученный администратор:', admin); // Добавлено для отладки

            const isMatch = await bcrypt.compare(password, admin.password);
            if (isMatch) {
                req.session.user = {
                    id: admin.id,
                    username: admin.username,
                    isAdmin: true
                };
                req.flash('success_msg', 'Вы успешно вошли в админ-панель');
                res.redirect('/admin');
            } else {
                req.flash('error_msg', 'Неверное имя пользователя или пароль');
                res.redirect('/admin/login');
            }
        } catch (err) {
            console.error('Ошибка при обработке входа администратора:', err);
            req.flash('error_msg', 'Ошибка сервера');
            res.redirect('/admin/login');
        }
    }
);

// Обработка выхода из админ-панели
app.get('/admin/logout', isAuthenticated, csrfProtection, (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Ошибка при выходе:', err);
            return res.redirect('/admin');
        }
        res.clearCookie('connect.sid');
        // Перенаправляем с параметром logged_out=1
        res.redirect('/admin/login?logged_out=1');
    });
});

// Отображение административной панели
app.get('/admin', isAuthenticated, csrfProtection, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, price FROM products ORDER BY id DESC');
        console.log('Полученные товары для админ-панели:', result);
        res.render('admin_dashboard', { 
            products: result,
            csrfToken: req.csrfToken() // Передаём CSRF-токен
        });
    } catch (err) {
        console.error('Ошибка при получении товаров для админ-панели:', err);
        req.flash('error_msg', 'Не удалось получить список товаров.');
        res.redirect('/admin');
    }
});

// Отображение формы добавления нового товара
app.get('/admin/products/add', isAuthenticated, csrfProtection, (req, res) => {
    res.render('admin_add_product', { 
        errors: [], 
        name: '', 
        price: '', 
        description: '', 
        characteristics: '',
        csrfToken: req.csrfToken() // Передаём CSRF-токен
    });
});

// Обработка добавления нового товара
app.post('/admin/products/add',
    isAuthenticated,
    upload.single('image'),    // Сначала обрабатываем файл
    csrfProtection,            // Затем проверяем CSRF-токен
    [
        body('name').notEmpty().withMessage('Название обязательно'),
        body('price').notEmpty().withMessage('Цена обязательна').custom(value => {
            // Проверка валидности формата цены
            const normalizedValue = value.replace(',', '.');
            if (isNaN(normalizedValue)) {
                throw new Error('Цена должна быть числом');
            }
            return true;
        }),
        body('description').notEmpty().withMessage('Описание обязательно'),
        body('characteristics').notEmpty().withMessage('Характеристики обязательны')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('admin_add_product', {
                errors: errors.array(),
                name: req.body.name,
                price: req.body.price,
                description: req.body.description,
                characteristics: req.body.characteristics,
                csrfToken: req.csrfToken() // Обновляем CSRF-токен
            });
        }

        try {
            let { name, description, price, characteristics } = req.body;
            // Заменяем запятую на точку для корректного сохранения
            price = price.replace(',', '.');

            const image = req.file ? req.file.filename : null;

            if (!image) {
                req.flash('error_msg', 'Изображение обязательно');
                return res.redirect('/admin/products/add');
            }

            // Используйте переменную без деструктуризации, так как pool.query не возвращает массив для INSERT
            const result = await pool.query(
                'INSERT INTO products (name, description, price, image, characteristics) VALUES (?, ?, ?, ?, ?)',
                [name, description, price, image, characteristics]
            );

            console.log('Добавлен новый товар, результат запроса:', result); // Добавлено для отладки

            req.flash('success_msg', 'Товар успешно добавлен!');
            res.redirect('/admin');
        } catch (err) {
            console.error('Ошибка при добавлении товара через админ-панель:', err);
            req.flash('error_msg', 'Не удалось добавить товар.');
            res.redirect('/admin/products/add');
        }
    }
);

// Отображение формы редактирования товара
app.get('/admin/products/edit/:id', isAuthenticated, csrfProtection, async (req, res) => {
    const productId = req.params.id;
    try {
        const result = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);

        if (result.length === 0) {
            req.flash('error_msg', 'Товар не найден.');
            return res.redirect('/admin');
        }

        const product = result[0];
        res.render('admin_edit_product', { 
            product, 
            errors: [], 
            csrfToken: req.csrfToken() // Передаём CSRF-токен
        });
    } catch (err) {
        console.error('Ошибка при получении товара для редактирования:', err);
        req.flash('error_msg', 'Не удалось получить данные товара.');
        res.redirect('/admin');
    }
});

// Обработка редактирования товара
app.post('/admin/products/edit/:id',
    isAuthenticated,
    upload.single('image'),    // Сначала обрабатываем файл
    csrfProtection,            // Затем проверяем CSRF-токен
    [
        body('name').notEmpty().withMessage('Название обязательно'),
        body('price').notEmpty().withMessage('Цена обязательна').custom(value => {
            // Проверка валидности формата цены
            const normalizedValue = value.replace(',', '.');
            if (isNaN(normalizedValue)) {
                throw new Error('Цена должна быть числом');
            }
            return true;
        }),
        body('description').notEmpty().withMessage('Описание обязательно'),
        body('characteristics').notEmpty().withMessage('Характеристики обязательны')
    ],
    async (req, res) => {
        const productId = req.params.id;
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // Получение текущих данных для отображения в форме
            const product = {
                id: productId,
                name: req.body.name,
                price: req.body.price,
                description: req.body.description,
                characteristics: req.body.characteristics,
                image: req.body.current_image // Предполагается, что форма передаёт текущее изображение
            };
            return res.render('admin_edit_product', {
                errors: errors.array(),
                product,
                csrfToken: req.csrfToken() // Обновляем CSRF-токен
            });
        }

        try {
            let { name, description, price, characteristics } = req.body;
            // Заменяем запятую на точку для корректного сохранения
            price = price.replace(',', '.');

            let image = req.body.current_image; // Текущее изображение

            if (req.file) {
                image = req.file.filename;
            }

            // Обработка обновления товара
            await pool.query(
                'UPDATE products SET name = ?, description = ?, price = ?, image = ?, characteristics = ? WHERE id = ?',
                [name, description, price, image, characteristics, productId]
            );

            console.log(`Товар с ID ${productId} обновлен`);

            req.flash('success_msg', 'Товар успешно обновлён!');
            res.redirect('/admin');
        } catch (err) {
            console.error('Ошибка при редактировании товара через админ-панель:', err);
            req.flash('error_msg', 'Не удалось обновить товар.');
            res.redirect(`/admin/products/edit/${productId}`);
        }
    }
);

// Обработка удаления товара
app.post('/admin/products/delete/:id', isAuthenticated, csrfProtection, async (req, res) => {
    const productId = req.params.id;

    try {
        // Сначала получить имя изображения для удаления файла
        const result = await pool.query('SELECT image FROM products WHERE id = ?', [productId]);

        if (result.length === 0) {
            req.flash('error_msg', 'Товар не найден.');
            return res.redirect('/admin');
        }

        const image = result[0].image;
        const imagePath = path.join(__dirname, 'uploads', image);

        // Удаление записи из базы данных
        await pool.query('DELETE FROM products WHERE id = ?', [productId]);

        // Удаление файла изображения
        try {
            await fs.unlink(imagePath);
            console.log(`Изображение ${image} успешно удалено.`);
        } catch (err) {
            console.error('Ошибка при удалении изображения:', err);
            // Не останавливаем выполнение, так как запись уже удалена
        }

        req.flash('success_msg', 'Товар успешно удалён!');
        res.redirect('/admin');
    } catch (err) {
        console.error('Ошибка при удалении товара:', err);
        req.flash('error_msg', 'Не удалось удалить товар.');
        res.redirect('/admin');
    }
});

// Отображение формы изменения пароля администратора
app.get('/admin/settings/change-password', isAuthenticated, csrfProtection, (req, res) => {
    res.render('admin_change_password', { 
        errors: [], 
        csrfToken: req.csrfToken() // Передаём CSRF-токен
    });
});

// Обработка изменения пароля администратора
app.post('/admin/settings/change-password',
    isAuthenticated,
    csrfProtection, // Применяем csurf
    [
        body('current_password').notEmpty().withMessage('Текущий пароль обязателен'),
        body('new_password').notEmpty().withMessage('Новый пароль обязателен').isLength({ min: 6 }).withMessage('Пароль должен содержать минимум 6 символов'),
        body('confirm_new_password').custom((value, { req }) => {
            if (value !== req.body.new_password) {
                throw new Error('Пароли не совпадают');
            }
            return true;
        })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('admin_change_password', {
                errors: errors.array(),
                csrfToken: req.csrfToken() // Обновляем CSRF-токен
            });
        }

        try {
            const { current_password, new_password } = req.body;
            const adminId = req.session.user.id;

            const result = await pool.query('SELECT * FROM admin WHERE id = ?', [adminId]);

            if (result.length === 0) {
                req.flash('error_msg', 'Администратор не найден');
                return res.redirect('/admin/settings/change-password');
            }

            const admin = result[0];
            const isMatch = await bcrypt.compare(current_password, admin.password);
            if (!isMatch) {
                req.flash('error_msg', 'Текущий пароль неверен');
                return res.redirect('/admin/settings/change-password');
            }

            // Хеширование нового пароля
            const hashedNewPassword = await bcrypt.hash(new_password, 10);

            await pool.query('UPDATE admin SET password = ? WHERE id = ?', [hashedNewPassword, adminId]);

            console.log(`Пароль администратора с ID ${adminId} изменен`);

            req.flash('success_msg', 'Пароль успешно изменён');
            res.redirect('/admin');
        } catch (err) {
            console.error('Ошибка при обновлении пароля:', err);
            req.flash('error_msg', 'Не удалось обновить пароль');
            res.redirect('/admin/settings/change-password');
        }
    }
);

// --------------------- Обработчик ошибок ----------------------------

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
