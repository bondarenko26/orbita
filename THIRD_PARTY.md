# Сторонние компоненты

## Локальная проверка анкет

Для изображений используется Marqo/nsfw-image-detection-384 в формате ONNX int8, лицензия Apache-2.0. Установщик кладёт полный текст лицензии рядом с весами. [Исходная модель](https://huggingface.co/Marqo/nsfw-image-detection-384) · [ONNX-версия](https://huggingface.co/kasimtmc/nsfw-image-detection-384-onnx).

Для русского текста используется cointegrated/rubert-tiny-toxicity в формате ONNX int8, лицензия MIT. Список версий, хешей и исходные адреса загрузки находятся в moderation/setup-ubuntu.sh. [Исходная модель](https://huggingface.co/cointegrated/rubert-tiny-toxicity) · [ONNX-версия](https://huggingface.co/onnx-community/rubert-tiny-toxicity-ONNX).

Средства обработки изображений, OCR и инференса устанавливаются отдельно. Pillow поставляется под MIT-CMU, NumPy под BSD-3-Clause, ONNX Runtime под MIT, Hugging Face Tokenizers и ZXing-C++ под Apache-2.0. Лицензии Python-пакетов входят в установленные дистрибутивы. Для Tesseract и пакетов Ubuntu сведения о лицензиях сохраняются в sysroot/usr/share/doc.

Зависимости устанавливаются через npm ci из package-lock.json. Браузер не обращается к CDN. Полные тексты лицензий поставляются с установленными npm-пакетами; node_modules не включён в исходный архив.

- ExcelJS 4.4.0 — чтение и создание XLSX, лицензия MIT: https://github.com/exceljs/exceljs/blob/master/LICENSE . Документация: https://github.com/exceljs/exceljs .
- yauzl 3.4.0 — проверка ZIP-контейнера XLSX и размеров распакованных файлов, лицензия MIT: https://github.com/thejoshwolfe/yauzl/blob/master/LICENSE . Документация: https://github.com/thejoshwolfe/yauzl .
- uuid 11.1.1 — транзитивная зависимость ExcelJS, зафиксированная override из-за исправления проверки границ буфера; лицензия MIT: https://github.com/uuidjs/uuid . Прикладные логины, пароли и сессии генерируются встроенным node:crypto, а не uuid.

Версии остальных транзитивных зависимостей и integrity-суммы находятся в package-lock.json. После установки проверены npm audit и прикладные интеграционные тесты.

- Nodemailer 10.5.0 — отправка SMTP с TLS, MIT-0: https://github.com/nodemailer/nodemailer/blob/master/LICENSE .

- JSZip 3.10.2 — настройка quotePrefix в сформированном XLSX, MIT (выбранная лицензия из MIT/GPLv3): https://github.com/Stuk/jszip . Ранее транзитивная зависимость ExcelJS, теперь объявлена явно.
Значки из предоставленных SVG основаны на Lucide. В проект включён оригинальный текст лицензий Lucide и Feather в LUCIDE-LICENSE.txt и в SVG-спрайте страницы. Источник: https://github.com/lucide-icons/lucide/blob/main/LICENSE .
