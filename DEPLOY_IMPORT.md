# Импорт клиентов на сервере - простая инструкция

## Минимальные шаги (если на проде есть исходники):

1. **Запушите код:**
   ```bash
   git add .
   git commit -m "Add client import script"
   git push
   ```

2. **На продакшн-сервере:**
   ```bash
   git pull
   npm install  # если нужно установить новые зависимости
   ```

3. **Загрузите файл `clients.csv` на сервер** (в корень проекта):
   ```bash
   scp clients.csv user@your-server:/path/to/project/
   ```

4. **Запустите импорт:**
   ```bash
   npm run import:clients
   ```

**Всё!** ✨

## Что нужно на сервере:

✅ Исходники TypeScript  
✅ Установленные зависимости (`npm install`)  
✅ Файл `.env` с `DATABASE_URL`  
✅ Файл `clients.csv` в корне проекта

## Важно:

- Скрипт автоматически пропускает дубликаты (безопасно запускать несколько раз)
- Файл `clients.csv` должен быть в корне проекта (рядом с `package.json`)
- Скрипт покажет детальный отчет о всех импортированных и пропущенных записях

## Альтернативный способ (если нет исходников на проде):

Если на продакшене только скомпилированный код:

```bash
# На локальной машине
npm run build:import

# Загрузить на сервер
scp dist/prisma/import-clients.js user@server:/path/to/project/dist/prisma/
scp clients.csv user@server:/path/to/project/

# На сервере
node dist/prisma/import-clients.js
```
