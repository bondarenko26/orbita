# Сторонние компоненты

Зависимости устанавливаются через npm ci из package-lock.json. Браузер не обращается к CDN. Полные тексты лицензий поставляются с установленными npm-пакетами; node_modules не включён в исходный архив.

- ExcelJS 4.4.0 — чтение и создание XLSX, лицензия MIT: https://github.com/exceljs/exceljs/blob/master/LICENSE . Документация: https://github.com/exceljs/exceljs .
- yauzl 3.4.0 — проверка ZIP-контейнера XLSX и размеров распакованных файлов, лицензия MIT: https://github.com/thejoshwolfe/yauzl/blob/master/LICENSE . Документация: https://github.com/thejoshwolfe/yauzl .
- uuid 11.1.1 — транзитивная зависимость ExcelJS, зафиксированная override из-за исправления проверки границ буфера; лицензия MIT: https://github.com/uuidjs/uuid . Прикладные логины, пароли и сессии генерируются встроенным node:crypto, а не uuid.

Версии остальных транзитивных зависимостей и integrity-суммы находятся в package-lock.json. После установки проверены npm audit и прикладные интеграционные тесты.

- Nodemailer 10.5.0 — отправка SMTP с TLS, MIT-0: https://github.com/nodemailer/nodemailer/blob/master/LICENSE .

- JSZip 3.10.2 — настройка quotePrefix в сформированном XLSX, MIT (выбранная лицензия из MIT/GPLv3): https://github.com/Stuk/jszip . Ранее транзитивная зависимость ExcelJS, теперь объявлена явно.
Значки из предоставленных SVG основаны на Lucide. В проект включён оригинальный текст лицензий Lucide и Feather в LUCIDE-LICENSE.txt и в SVG-спрайте страницы. Источник: https://github.com/lucide-icons/lucide/blob/main/LICENSE .
