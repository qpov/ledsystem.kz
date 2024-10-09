// public/js/index.js

document.addEventListener('DOMContentLoaded', () => {
    const slides = document.querySelectorAll('.slide');
    const prevButton = document.querySelector('.prev');
    const nextButton = document.querySelector('.next');
    const indicators = document.querySelectorAll('.indicator'); // Выборка индикаторов
    let currentIndex = 0;
    const totalSlides = slides.length;
    let slideInterval;

    // Функция для отображения слайда по индексу
    function showSlide(index) {
        // Убираем активный класс со всех слайдов
        slides.forEach((slide, i) => {
            slide.classList.remove('active');
        });

        // Добавляем активный класс к текущему слайду
        slides[index].classList.add('active');

        // Убираем активный класс со всех индикаторов
        indicators.forEach((indicator, i) => {
            indicator.classList.remove('active');
        });

        // Добавляем активный класс к текущему индикатору
        indicators[index].classList.add('active');

        // Обновляем текущий индекс
        currentIndex = index;
    }

    // Функция для переключения на следующий слайд
    function nextSlide() {
        let index = (currentIndex + 1) % totalSlides;
        showSlide(index);
    }

    // Функция для переключения на предыдущий слайд
    function prevSlide() {
        let index = (currentIndex - 1 + totalSlides) % totalSlides;
        showSlide(index);
    }

    // Автоматическое переключение слайдов каждые 5 секунд
    function startSlideShow() {
        slideInterval = setInterval(nextSlide, 5000);
    }

    // Остановка автоматического переключения
    function stopSlideShow() {
        clearInterval(slideInterval);
    }

    // Обработчики событий для кнопок
    nextButton.addEventListener('click', () => {
        nextSlide();
        stopSlideShow();
        startSlideShow();
    });

    prevButton.addEventListener('click', () => {
        prevSlide();
        stopSlideShow();
        startSlideShow();
    });

    // Обработчики событий для индикаторов
    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            showSlide(index);
            stopSlideShow();
            startSlideShow();
        });
    });

    // Инициализация карусели
    showSlide(currentIndex);
    startSlideShow();
});
