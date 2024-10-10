// routes/admin.js

const express = require('express');
const router = express.Router();
const csrf = require('csurf');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Настройка CSRF защиты
const csrfProtection = csrf({ cookie: false });

// Настройка Multer для загрузки изображений (если требуется)
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

// Middleware для проверки аутентификации администратора
function isAuthenticated(req, res, next) {
    if (req.session.user && req.session.user.isAdmin) {
        return next();
    }
    req.flash('error_msg', 'Пожалуйста, войдите в административную панель.');
    res.redirect('/admin/login');
}

// --------------------- Маршруты Админ-Панели ---------------------

/**
 * GET /admin/login
 * Отображает страницу входа в админ-панель
 */
router.get('/login', csrfProtection, (req, res) => {
    const loggedOut = req.query.logged_out === '1';
    res.render('admin/login', { 
        errors: [], 
        username: '', 
        csrfToken: req.csrfToken(),
        loggedOut 
    });
});

/**
 * POST /admin/login
 * Обрабатывает вход администратора
 */
router.post('/login',
    csrfProtection,
    [
        body('username').notEmpty().withMessage('Имя пользователя обязательно'),
        body('password').notEmpty().withMessage('Пароль обязателен')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('admin/login', {
                errors: errors.array(),
                username: req.body.username,
                csrfToken: req.csrfToken(),
                loggedOut: false
            });
        }

        const { username, password } = req.body;

        try {
            const result = await req.app.locals.pool.query('SELECT * FROM admin WHERE username = ?', [username]);

            if (result.length === 0) {
                req.flash('error_msg', 'Неверное имя пользователя или пароль');
                return res.redirect('/admin/login');
            }

            const admin = result[0];
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

/**
 * GET /admin/logout
 * Обрабатывает выход из админ-панели
 */
router.get('/logout', isAuthenticated, csrfProtection, (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Ошибка при выходе:', err);
            return res.redirect('/admin');
        }
        res.clearCookie('connect.sid');
        res.redirect('/admin/login?logged_out=1');
    });
});

/**
 * GET /admin
 * Отображает главную страницу админ-панели
 */
router.get('/', isAuthenticated, csrfProtection, async (req, res) => {
    try {
        const products = await req.app.locals.pool.query('SELECT id, name, price FROM products ORDER BY id DESC');
        res.render('admin/dashboard', { 
            products: products,
            csrfToken: req.csrfToken() 
        });
    } catch (err) {
        console.error('Ошибка при получении товаров для админ-панели:', err);
        req.flash('error_msg', 'Не удалось получить список товаров.');
        res.redirect('/admin');
    }
});

// --------------------- Управление Товарами ---------------------

/**
 * GET /admin/products
 * Отображает страницу управления товарами
 */
router.get('/products', isAuthenticated, csrfProtection, async (req, res) => {
    try {
        const products = await req.app.locals.pool.query('SELECT id, name, price FROM products ORDER BY id DESC');
        res.render('admin/manage_products', {
            products: products,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            csrfToken: req.csrfToken()
        });
    } catch (err) {
        console.error('Ошибка при получении товаров:', err);
        req.flash('error_msg', 'Не удалось получить список товаров.');
        res.redirect('/admin');
    }
});

/**
 * GET /admin/products/add
 * Отображает форму добавления нового товара
 */
router.get('/products/add', isAuthenticated, csrfProtection, (req, res) => {
    res.render('admin/add_product', { 
        errors: [], 
        name: '', 
        price: '', 
        description: '', 
        characteristics: '',
        csrfToken: req.csrfToken() 
    });
});

/**
 * POST /admin/products/add
 * Обрабатывает добавление нового товара
 */
router.post('/products/add',
    isAuthenticated,
    upload.single('image'),
    csrfProtection,
    [
        body('name').notEmpty().withMessage('Название обязательно'),
        body('price').notEmpty().withMessage('Цена обязательна').custom(value => {
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
            return res.render('admin/add_product', {
                errors: errors.array(),
                name: req.body.name,
                price: req.body.price,
                description: req.body.description,
                characteristics: req.body.characteristics,
                csrfToken: req.csrfToken()
            });
        }

        try {
            let { name, description, price, characteristics } = req.body;
            price = price.replace(',', '.');

            const image = req.file ? req.file.filename : null;

            if (!image) {
                req.flash('error_msg', 'Изображение обязательно');
                return res.redirect('/admin/products/add');
            }

            await req.app.locals.pool.query(
                'INSERT INTO products (name, description, price, image, characteristics) VALUES (?, ?, ?, ?, ?)',
                [name, description, price, image, characteristics]
            );

            req.flash('success_msg', 'Товар успешно добавлен!');
            res.redirect('/admin/products');
        } catch (err) {
            console.error('Ошибка при добавлении товара через админ-панель:', err);
            req.flash('error_msg', 'Не удалось добавить товар.');
            res.redirect('/admin/products/add');
        }
    }
);

/**
 * POST /admin/products/edit/:id
 * Обрабатывает редактирование товара
 */
// Страница редактирования товара
router.get('/products/edit/:id', isAuthenticated, csrfProtection, async (req, res) => {
    const productId = req.params.id;
    try {
        const result = await req.app.locals.pool.query('SELECT * FROM products WHERE id = ?', [productId]);

        if (result.length === 0) {
            req.flash('error_msg', 'Товар не найден.');
            return res.redirect('/admin/products');
        }

        const product = result[0];
        res.render('admin/edit_product', { 
            product, 
            errors: [], 
            csrfToken: req.csrfToken() 
        });
    } catch (err) {
        console.error('Ошибка при получении товара для редактирования:', err);
        req.flash('error_msg', 'Не удалось получить данные товара.');
        res.redirect('/admin/products');
    }
});

// Обработка редактирования товара
router.post('/products/edit/:id',
    isAuthenticated,
    upload.single('image'),
    csrfProtection,
    [
        body('name').notEmpty().withMessage('Название обязательно'),
        body('price').notEmpty().withMessage('Цена обязательна').custom(value => {
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
            const product = {
                id: productId,
                name: req.body.name,
                price: req.body.price,
                description: req.body.description,
                characteristics: req.body.characteristics,
                image: req.body.current_image // Предполагается, что форма передаёт текущее изображение
            };
            return res.render('admin/edit_product', {
                errors: errors.array(),
                product,
                csrfToken: req.csrfToken()
            });
        }

        try {
            let { name, description, price, characteristics } = req.body;
            price = price.replace(',', '.');

            let image = req.body.current_image; // Текущее изображение

            if (req.file) {
                image = req.file.filename;
                // Удаление старого изображения, если требуется
                if (req.body.current_image) {
                    const oldImagePath = path.join(__dirname, '..', 'uploads', req.body.current_image);
                    try {
                        await fs.unlink(oldImagePath);
                        console.log(`Старое изображение ${req.body.current_image} удалено.`);
                    } catch (err) {
                        console.error('Ошибка при удалении старого изображения:', err);
                    }
                }
            }

            await req.app.locals.pool.query(
                'UPDATE products SET name = ?, description = ?, price = ?, image = ?, characteristics = ? WHERE id = ?',
                [name, description, price, image, characteristics, productId]
            );

            req.flash('success_msg', 'Товар успешно обновлён!');
            res.redirect('/admin/products');
        } catch (err) {
            console.error('Ошибка при редактировании товара через админ-панель:', err);
            req.flash('error_msg', 'Не удалось обновить товар.');
            res.redirect(`/admin/products/edit/${productId}`);
        }
    }
);

/**
 * POST /admin/products/delete/:id
 * Обрабатывает удаление товара
 */
router.post('/products/delete/:id', isAuthenticated, csrfProtection, async (req, res) => {
    const productId = req.params.id;

    try {
        const result = await req.app.locals.pool.query('SELECT image FROM products WHERE id = ?', [productId]);

        if (result.length === 0) {
            req.flash('error_msg', 'Товар не найден.');
            return res.redirect('/admin/products');
        }

        const image = result[0].image;
        const imagePath = path.join(__dirname, '..', 'uploads', image);

        await req.app.locals.pool.query('DELETE FROM products WHERE id = ?', [productId]);

        try {
            await fs.unlink(imagePath);
            console.log(`Изображение ${image} успешно удалено.`);
        } catch (err) {
            console.error('Ошибка при удалении изображения:', err);
            // Не останавливаем выполнение, так как запись уже удалена
        }

        req.flash('success_msg', 'Товар успешно удалён!');
        res.redirect('/admin/products');
    } catch (err) {
        console.error('Ошибка при удалении товара:', err);
        req.flash('error_msg', 'Не удалось удалить товар.');
        res.redirect('/admin/products');
    }
});

// --------------------- Управление Пользователями ---------------------

/**
 * GET /admin/users
 * Отображает страницу управления пользователями
 */
router.get('/users', isAuthenticated, csrfProtection, async (req, res) => {
    try {
        const users = await req.app.locals.pool.query('SELECT id, name, email, role FROM users ORDER BY id DESC');
        res.render('admin/manage_users', {
            users: users,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            csrfToken: req.csrfToken()
        });
    } catch (err) {
        console.error('Ошибка при получении пользователей:', err);
        req.flash('error_msg', 'Не удалось получить список пользователей.');
        res.redirect('/admin');
    }
});

/**
 * GET /admin/users/add
 * Отображает форму добавления нового пользователя
 */
router.get('/users/add', isAuthenticated, csrfProtection, (req, res) => {
    res.render('admin/add_user', { 
        errors: [], 
        name: '', 
        email: '', 
        role: '',
        password: '',
        csrfToken: req.csrfToken() 
    });
});

/**
 * POST /admin/users/add
 * Обрабатывает добавление нового пользователя
 */
router.post('/users/add',
    isAuthenticated,
    csrfProtection,
    [
        body('name').notEmpty().withMessage('Имя обязательно'),
        body('email').isEmail().withMessage('Неверный формат email'),
        body('role').notEmpty().withMessage('Роль обязательна'),
        body('password').isLength({ min: 6 }).withMessage('Пароль должен содержать минимум 6 символов')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('admin/add_user', {
                errors: errors.array(),
                name: req.body.name,
                email: req.body.email,
                role: req.body.role,
                password: req.body.password,
                csrfToken: req.csrfToken()
            });
        }

        try {
            const { name, email, role, password } = req.body;
            const hashedPassword = await bcrypt.hash(password, 10);

            await req.app.locals.pool.query(
                'INSERT INTO users (name, email, role, password) VALUES (?, ?, ?, ?)',
                [name, email, role, hashedPassword]
            );

            req.flash('success_msg', 'Пользователь успешно добавлен!');
            res.redirect('/admin/users');
        } catch (err) {
            console.error('Ошибка при добавлении пользователя через админ-панель:', err);
            req.flash('error_msg', 'Не удалось добавить пользователя.');
            res.redirect('/admin/users/add');
        }
    }
);

/**
 * GET /admin/users/edit/:id
 * Отображает форму редактирования пользователя
 */
router.get('/users/edit/:id', isAuthenticated, csrfProtection, async (req, res) => {
    const userId = req.params.id;
    try {
        const result = await req.app.locals.pool.query('SELECT id, name, email, role FROM users WHERE id = ?', [userId]);

        if (result.length === 0) {
            req.flash('error_msg', 'Пользователь не найден.');
            return res.redirect('/admin/users');
        }

        const user = result[0];
        res.render('admin/edit_user', { 
            user: user, 
            errors: [], 
            csrfToken: req.csrfToken() 
        });
    } catch (err) {
        console.error('Ошибка при получении пользователя для редактирования:', err);
        req.flash('error_msg', 'Не удалось получить данные пользователя.');
        res.redirect('/admin/users');
    }
});

/**
 * POST /admin/users/edit/:id
 * Обрабатывает редактирование пользователя
 */
router.post('/users/edit/:id',
    isAuthenticated,
    csrfProtection,
    [
        body('name').notEmpty().withMessage('Имя обязательно'),
        body('email').isEmail().withMessage('Неверный формат email'),
        body('role').notEmpty().withMessage('Роль обязательна')
    ],
    async (req, res) => {
        const userId = req.params.id;
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const user = {
                id: userId,
                name: req.body.name,
                email: req.body.email,
                role: req.body.role
            };
            return res.render('admin/edit_user', {
                errors: errors.array(),
                user,
                csrfToken: req.csrfToken()
            });
        }

        try {
            const { name, email, role } = req.body;

            await req.app.locals.pool.query(
                'UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?',
                [name, email, role, userId]
            );

            req.flash('success_msg', 'Пользователь успешно обновлён!');
            res.redirect('/admin/users');
        } catch (err) {
            console.error('Ошибка при редактировании пользователя через админ-панель:', err);
            req.flash('error_msg', 'Не удалось обновить пользователя.');
            res.redirect(`/admin/users/edit/${userId}`);
        }
    }
);

/**
 * POST /admin/users/delete/:id
 * Обрабатывает удаление пользователя
 */
router.post('/users/delete/:id', isAuthenticated, csrfProtection, async (req, res) => {
    const userId = req.params.id;

    try {
        await req.app.locals.pool.query('DELETE FROM users WHERE id = ?', [userId]);

        req.flash('success_msg', 'Пользователь успешно удалён!');
        res.redirect('/admin/users');
    } catch (err) {
        console.error('Ошибка при удалении пользователя:', err);
        req.flash('error_msg', 'Не удалось удалить пользователя.');
        res.redirect('/admin/users');
    }
});

// --------------------- Настройки Сайта ---------------------

/**
 * GET /admin/settings
 * Отображает страницу настройки сайта
 */
router.get('/settings', isAuthenticated, csrfProtection, async (req, res) => {
    try {
        // Получите текущие настройки из базы данных
        const result = await req.app.locals.pool.query('SELECT * FROM site_settings LIMIT 1');
        let settings = {};
        if (result.length > 0) {
            settings = result[0];
        }
        res.render('admin/site_settings', {
            settings: settings,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            csrfToken: req.csrfToken()
        });
    } catch (err) {
        console.error('Ошибка при получении настроек сайта:', err);
        req.flash('error_msg', 'Не удалось получить настройки сайта.');
        res.redirect('/admin');
    }
});

/**
 * POST /admin/settings/update
 * Обрабатывает обновление настроек сайта
 */
router.post('/settings/update',
    isAuthenticated,
    csrfProtection,
    [
        body('site_title').notEmpty().withMessage('Заголовок сайта обязателен'),
        body('site_description').notEmpty().withMessage('Описание сайта обязательно')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const settings = {
                site_title: req.body.site_title,
                site_description: req.body.site_description
            };
            return res.render('admin/site_settings', {
                settings,
                errors: errors.array(),
                csrfToken: req.csrfToken()
            });
        }

        try {
            const { site_title, site_description } = req.body;

            // Проверяем, существуют ли уже настройки
            const existing = await req.app.locals.pool.query('SELECT * FROM site_settings LIMIT 1');
            if (existing.length > 0) {
                // Обновляем существующие настройки
                await req.app.locals.pool.query(
                    'UPDATE site_settings SET site_title = ?, site_description = ? WHERE id = ?',
                    [site_title, site_description, existing[0].id]
                );
            } else {
                // Вставляем новые настройки
                await req.app.locals.pool.query(
                    'INSERT INTO site_settings (site_title, site_description) VALUES (?, ?)',
                    [site_title, site_description]
                );
            }

            req.flash('success_msg', 'Настройки сайта успешно обновлены.');
            res.redirect('/admin/settings');
        } catch (err) {
            console.error('Ошибка при обновлении настроек сайта:', err);
            req.flash('error_msg', 'Не удалось обновить настройки сайта.');
            res.redirect('/admin/settings');
        }
    }
);

// --------------------- Управление Паролем Администратора ---------------------

/**
 * GET /admin/settings/change-password
 * Отображает форму изменения пароля администратора
 */
router.get('/settings/change-password', isAuthenticated, csrfProtection, (req, res) => {
    res.render('admin/change_password', { 
        errors: [], 
        csrfToken: req.csrfToken() 
    });
});

/**
 * POST /admin/settings/change-password
 * Обрабатывает изменение пароля администратора
 */
router.post('/settings/change-password',
    isAuthenticated,
    csrfProtection,
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
            return res.render('admin/change_password', {
                errors: errors.array(),
                csrfToken: req.csrfToken()
            });
        }

        try {
            const { current_password, new_password } = req.body;
            const adminId = req.session.user.id;

            const result = await req.app.locals.pool.query('SELECT * FROM admin WHERE id = ?', [adminId]);

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

            await req.app.locals.pool.query('UPDATE admin SET password = ? WHERE id = ?', [hashedNewPassword, adminId]);

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

module.exports = router;
