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

// Middleware для проверки роли superadmin
function isSuperAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'superadmin') {
        return next();
    }
    req.flash('error_msg', 'У вас нет прав для выполнения этого действия.');
    res.redirect('/admin');
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
                    role: admin.role, // Добавляем роль пользователя
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
 * GET /admin/products/edit/:id
 * Отображает форму редактирования товара
 */
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

/**
 * POST /admin/products/edit/:id
 * Обрабатывает редактирование товара
 */
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
 * Отображает страницу управления администраторами
 */
router.get('/users', isAuthenticated, isSuperAdmin, csrfProtection, async (req, res) => {
    try {
        const admins = await req.app.locals.pool.query('SELECT id, username, role FROM admin ORDER BY id DESC');
        res.render('admin/manage_users', {
            users: admins,
            success_msg: req.flash('success_msg'),
            error_msg: req.flash('error_msg'),
            csrfToken: req.csrfToken()
        });
    } catch (err) {
        console.error('Ошибка при получении администраторов:', err);
        req.flash('error_msg', 'Не удалось получить список администраторов.');
        res.redirect('/admin');
    }
});

/**
 * GET /admin/users/add
 * Отображает форму добавления нового администратора
 */
router.get('/users/add', isAuthenticated, isSuperAdmin, csrfProtection, (req, res) => {
    res.render('admin/add_user', { 
        errors: [], 
        username: '', 
        role: '',
        password: '',
        csrfToken: req.csrfToken() 
    });
});

/**
 * POST /admin/users/add
 * Обрабатывает добавление нового администратора
 */
router.post('/users/add',
    isAuthenticated,
    isSuperAdmin, // Только superadmin может добавлять пользователей
    csrfProtection,
    [
        body('username').notEmpty().withMessage('Имя пользователя обязательно'),
        body('role').notEmpty().withMessage('Роль обязательна').isIn(['admin']).withMessage('Неверная роль'), // Только создание администраторов
        body('password').isLength({ min: 6 }).withMessage('Пароль должен содержать минимум 6 символов'),
        body('confirm_password').custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error('Пароли не совпадают');
            }
            return true;
        })
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('admin/add_user', {
                errors: errors.array(),
                username: req.body.username,
                role: req.body.role,
                password: req.body.password,
                csrfToken: req.csrfToken()
            });
        }

        try {
            const { username, role, password } = req.body;
            const hashedPassword = await bcrypt.hash(password, 10);

            // Проверка существования пользователя с таким именем
            const existingUser = await req.app.locals.pool.query('SELECT id FROM admin WHERE username = ?', [username]);
            if (existingUser.length > 0) {
                req.flash('error_msg', 'Пользователь с таким именем уже существует.');
                return res.redirect('/admin/users/add');
            }

            await req.app.locals.pool.query(
                'INSERT INTO admin (username, password, role) VALUES (?, ?, ?)',
                [username, hashedPassword, role]
            );

            req.flash('success_msg', 'Администратор успешно добавлен!');
            res.redirect('/admin/users');
        } catch (err) {
            console.error('Ошибка при добавлении администратора через админ-панель:', err);
            req.flash('error_msg', 'Не удалось добавить администратора.');
            res.redirect('/admin/users/add');
        }
    }
);

/**
 * GET /admin/users/edit/:id
 * Отображает форму редактирования администратора
 */
router.get('/users/edit/:id', isAuthenticated, isSuperAdmin, csrfProtection, async (req, res) => {
    const adminId = req.params.id;
    try {
        const result = await req.app.locals.pool.query('SELECT id, username, role FROM admin WHERE id = ?', [adminId]);

        if (result.length === 0) {
            req.flash('error_msg', 'Администратор не найден.');
            return res.redirect('/admin/users');
        }

        const admin = result[0];
        res.render('admin/edit_user', { 
            user: admin, 
            errors: [], 
            csrfToken: req.csrfToken() 
        });
    } catch (err) {
        console.error('Ошибка при получении администратора для редактирования:', err);
        req.flash('error_msg', 'Не удалось получить данные администратора.');
        res.redirect('/admin/users');
    }
});

/**
 * POST /admin/users/edit/:id
 * Обрабатывает редактирование администратора
 */
router.post('/users/edit/:id',
    isAuthenticated,
    isSuperAdmin, // Только superadmin может редактировать администраторов
    csrfProtection,
    [
        body('username').notEmpty().withMessage('Имя пользователя обязательно'),
        body('role').notEmpty().withMessage('Роль обязательна').isIn(['admin']).withMessage('Неверная роль') // Только администраторы
    ],
    async (req, res) => {
        const adminId = req.params.id;
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const user = {
                id: adminId,
                username: req.body.username,
                role: req.body.role
            };
            return res.render('admin/edit_user', {
                errors: errors.array(),
                user,
                csrfToken: req.csrfToken()
            });
        }

        try {
            const { username, role } = req.body;

            // Проверка существования другого администратора с таким именем
            const existingAdmin = await req.app.locals.pool.query('SELECT id FROM admin WHERE username = ? AND id != ?', [username, adminId]);
            if (existingAdmin.length > 0) {
                req.flash('error_msg', 'Администратор с таким именем уже существует.');
                return res.redirect(`/admin/users/edit/${adminId}`);
            }

            await req.app.locals.pool.query(
                'UPDATE admin SET username = ?, role = ? WHERE id = ?',
                [username, role, adminId]
            );

            req.flash('success_msg', 'Администратор успешно обновлён!');
            res.redirect('/admin/users');
        } catch (err) {
            console.error('Ошибка при редактировании администратора через админ-панель:', err);
            req.flash('error_msg', 'Не удалось обновить администратора.');
            res.redirect(`/admin/users/edit/${adminId}`);
        }
    }
);

/**
 * POST /admin/users/delete/:id
 * Обрабатывает удаление администратора
 */
router.post('/users/delete/:id', isAuthenticated, isSuperAdmin, csrfProtection, async (req, res) => {
    const adminId = req.params.id;

    try {
        // Получение роли администратора, которого пытаются удалить
        const admin = await req.app.locals.pool.query('SELECT role FROM admin WHERE id = ?', [adminId]);

        if (admin.length === 0) {
            req.flash('error_msg', 'Администратор не найден.');
            return res.redirect('/admin/users');
        }

        if (admin[0].role === 'superadmin') {
            req.flash('error_msg', 'Невозможно удалить супер-администратора.');
            return res.redirect('/admin/users');
        }

        // Не разрешаем удаление самого себя
        if (req.session.user.id === parseInt(adminId)) {
            req.flash('error_msg', 'Вы не можете удалить себя.');
            return res.redirect('/admin/users');
        }

        await req.app.locals.pool.query('DELETE FROM admin WHERE id = ?', [adminId]);

        req.flash('success_msg', 'Администратор успешно удалён!');
        res.redirect('/admin/users');
    } catch (err) {
        console.error('Ошибка при удалении администратора:', err);
        req.flash('error_msg', 'Не удалось удалить администратора.');
        res.redirect('/admin/users');
    }
});

// --------------------- Управление Паролем Главного Администратора ---------------------

/**
 * GET /admin/change-password
 * Отображает форму изменения пароля супер администратора
 */
router.get('/change-password', isAuthenticated, csrfProtection, async (req, res) => {
    // Проверяем, что пользователь является superadmin
    if (req.session.user.role !== 'superadmin') {
        req.flash('error_msg', 'У вас нет прав для выполнения этого действия.');
        return res.redirect('/admin');
    }

    res.render('admin/change_password', { 
        errors: [], 
        csrfToken: req.csrfToken() 
    });
});

/**
 * POST /admin/change-password
 * Обрабатывает изменение пароля супер администратора
 */
router.post('/change-password',
    isAuthenticated,
    csrfProtection,
    [
        body('current_password').notEmpty().withMessage('Текущий пароль обязателен'),
        body('new_password').isLength({ min: 6 }).withMessage('Новый пароль должен содержать минимум 6 символов'),
        body('confirm_new_password').custom((value, { req }) => {
            if (value !== req.body.new_password) {
                throw new Error('Пароли не совпадают');
            }
            return true;
        })
    ],
    async (req, res) => {
        // Проверяем, что пользователь является superadmin
        if (req.session.user.role !== 'superadmin') {
            req.flash('error_msg', 'У вас нет прав для выполнения этого действия.');
            return res.redirect('/admin');
        }

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
                return res.redirect('/admin/change-password');
            }

            const admin = result[0];
            const isMatch = await bcrypt.compare(current_password, admin.password);
            if (!isMatch) {
                req.flash('error_msg', 'Текущий пароль неверен');
                return res.redirect('/admin/change-password');
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
            res.redirect('/admin/change-password');
        }
    }
);

// --------------------- Настройки Сайта (Скрыто) ---------------------

// Так как вы хотите сделать кнопку "Настройка сайта" неактивной, мы не добавляем маршруты для неё.
// Однако, если вы решите добавить её позже, можете использовать следующий код:

/**
 * GET /admin/settings
 * Отображает страницу настройки сайта (в разработке)
 */
router.get('/settings', isAuthenticated, isSuperAdmin, csrfProtection, (req, res) => {
    req.flash('error_msg', 'Настройка сайта находится в разработке.');
    res.redirect('/admin');
});

// --------------------- Экспорт Маршрутов ---------------------
module.exports = router;
