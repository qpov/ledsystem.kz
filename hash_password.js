// hash_password.js

const bcrypt = require('bcrypt');

const password = 'admin'; // Замените на желаемый пароль

bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
        console.error('Ошибка при хэшировании пароля:', err);
        process.exit(1);
    }
    console.log(`Хэшированный пароль: ${hash}`);
    process.exit(0);
});
