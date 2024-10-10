// public/js/custom.js

document.addEventListener('DOMContentLoaded', () => {
    const toasts = document.querySelectorAll('.toast');
    toasts.forEach(toast => {
        if (toast) {
            // Показать уведомление
            toast.classList.add('show');

            // Скрыть уведомление через 3 секунды
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }
    });

    // Обработчик подтверждения удаления
    const deleteButtons = document.querySelectorAll('.confirm-delete');
    deleteButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const message = button.getAttribute('data-message') || 'Вы уверены?';
            if (!confirm(message)) {
                event.preventDefault(); // Отменить отправку формы
            }
        });
    });
});
