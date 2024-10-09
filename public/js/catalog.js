// public/js/catalog.js

document.addEventListener('DOMContentLoaded', () => {
    const productsPerPage = 12; // Количество товаров на странице
    let currentPage = 1;
    let totalPages = 1;

    const fetchProducts = (page, limit) => {
        return fetch(`/api/products?page=${page}&limit=${limit}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            });
    };

    const renderProducts = (products) => {
        const productList = document.getElementById('product-list');
        productList.innerHTML = ''; // Очистка текущего списка

        products.forEach(product => {
            const productCard = document.createElement('div');
            productCard.classList.add('product-card');

            // Обработчик клика на всю карточку
            productCard.addEventListener('click', () => {
                window.location.href = `/product/${product.id}`;
            });

            // Изображение товара с ленивой загрузкой
            const img = document.createElement('img');
            img.src = `/uploads/${product.image}`;
            img.alt = product.name;
            img.loading = 'lazy'; // Добавляем ленивую загрузку
            productCard.appendChild(img);

            // Название товара
            const name = document.createElement('h3');
            name.textContent = product.name;
            productCard.appendChild(name);

            // Цена товара с запятой
            const price = document.createElement('p');
            // Форматирование цены с запятой
            const formattedPrice = parseFloat(product.price).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            price.innerHTML = `<strong>Цена:</strong> ${formattedPrice} ₸`;
            productCard.appendChild(price);

            // Описание товара с заголовком "Описание" и поддержкой абзацев
            const descriptionContainer = document.createElement('div');
            descriptionContainer.classList.add('description-container');

            const descriptionLabel = document.createElement('strong');
            descriptionLabel.textContent = 'Описание:';
            descriptionContainer.appendChild(descriptionLabel);

            // Разделение описания на абзацы по символам новой строки (\n или \r\n)
            const paragraphs = product.description.split(/\r?\n/);
            paragraphs.forEach(paragraph => {
                if (paragraph.trim() !== '') { // Проверяем, что абзац не пустой
                    const p = document.createElement('p');
                    p.textContent = paragraph.trim();
                    descriptionContainer.appendChild(p);
                }
            });

            productCard.appendChild(descriptionContainer);

            // Добавление карточки товара в список
            productList.appendChild(productCard);
        });
    };

    const renderPagination = () => {
        const pagination = document.getElementById('pagination');
        pagination.innerHTML = '';

        // Кнопка "Предыдущая"
        const prevButton = document.createElement('button');
        prevButton.textContent = 'Предыдущая';
        prevButton.disabled = currentPage === 1;
        prevButton.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadProducts();
            }
        });
        pagination.appendChild(prevButton);

        // Номера страниц
        for (let i = 1; i <= totalPages; i++) {
            const pageButton = document.createElement('button');
            pageButton.textContent = i;
            if (i === currentPage) {
                pageButton.classList.add('active');
            }
            pageButton.addEventListener('click', () => {
                currentPage = i;
                loadProducts();
            });
            pagination.appendChild(pageButton);
        }

        // Кнопка "Следующая"
        const nextButton = document.createElement('button');
        nextButton.textContent = 'Следующая';
        nextButton.disabled = currentPage === totalPages;
        nextButton.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                loadProducts();
            }
        });
        pagination.appendChild(nextButton);
    };

    const loadProducts = () => {
        fetchProducts(currentPage, productsPerPage)
            .then(data => {
                renderProducts(data.products);
                totalPages = Math.ceil(data.total / productsPerPage);
                renderPagination();
            })
            .catch(error => {
                console.error('Ошибка при загрузке продуктов:', error);
                const productList = document.getElementById('product-list');
                productList.innerHTML = '<p>Не удалось загрузить товары. Попробуйте позже.</p>';
            });
    };

    loadProducts();
});
