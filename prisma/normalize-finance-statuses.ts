import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Функция для нормализации статуса (та же, что в import-finance.ts)
function normalizeStatus(status: string): string {
  if (!status) return ''
  // Убираем пробелы в начале и конце, а также множественные пробелы
  let normalized = status.trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  
  // Приводим к нижнему регистру для единообразия
  normalized = normalized.toLowerCase()
  
  // Затем делаем первую букву каждого слова заглавной
  // Обрабатываем слова разделенные пробелами и "/"
  return normalized
    .split(/(\s+|\/)/)
    .map(segment => {
      // Сохраняем разделители как есть
      if (segment.match(/^\s*$|\//)) return segment
      
      // Если слово начинается с цифры (например, "3pl"), оставляем как есть
      if (/^\d/.test(segment)) {
        return segment
      }
      
      // Для обычных слов: первая буква заглавная, остальные строчные
      if (segment.length > 0) {
        return segment.charAt(0).toUpperCase() + segment.slice(1)
      }
      return segment
    })
    .join('')
    .replace(/\s+/g, ' ') // Убираем множественные пробелы
    .trim()
}

async function main() {
  try {
    console.log('Начинаем нормализацию статусов в таблице finance...\n')
    
    // Получаем все уникальные статусы
    const allFinances = await prisma.finance.findMany({
      select: {
        id: true,
        status: true,
      }
    })
    
    console.log(`Всего записей: ${allFinances.length}`)
    
    // Группируем по нормализованным статусам
    const statusMap = new Map<string, { original: string; ids: string[] }>()
    
    allFinances.forEach(finance => {
      const originalStatus = finance.status || 'Без статуса'
      const normalizedStatus = normalizeStatus(originalStatus)
      
      if (statusMap.has(normalizedStatus)) {
        const existing = statusMap.get(normalizedStatus)!
        if (!existing.ids.includes(finance.id)) {
          existing.ids.push(finance.id)
        }
      } else {
        statusMap.set(normalizedStatus, {
          original: normalizedStatus,
          ids: [finance.id]
        })
      }
    })
    
    console.log(`Уникальных нормализованных статусов: ${statusMap.size}\n`)
    
    // Показываем статусы, которые нужно обновить
    let totalToUpdate = 0
    const updates: Array<{ id: string; oldStatus: string; newStatus: string }> = []
    
    for (const finance of allFinances) {
      const originalStatus = finance.status || 'Без статуса'
      const normalizedStatus = normalizeStatus(originalStatus)
      
      if (originalStatus !== normalizedStatus) {
        totalToUpdate++
        updates.push({
          id: finance.id,
          oldStatus: originalStatus,
          newStatus: normalizedStatus
        })
      }
    }
    
    console.log(`Записей, требующих обновления: ${totalToUpdate}\n`)
    
    if (totalToUpdate > 0) {
      console.log('Примеры обновлений (первые 10):')
      updates.slice(0, 10).forEach((update, i) => {
        console.log(`${i + 1}. "${update.oldStatus}" -> "${update.newStatus}"`)
      })
      if (updates.length > 10) {
        console.log(`... и еще ${updates.length - 10} записей\n`)
      }
      
      // Обновляем записи батчами
      const BATCH_SIZE = 100
      let updated = 0
      
      console.log('\nНачинаем обновление...')
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE)
        
        await Promise.all(
          batch.map(update =>
            prisma.finance.update({
              where: { id: update.id },
              data: { status: update.newStatus }
            })
          )
        )
        
        updated += batch.length
        console.log(`Обновлено: ${updated} / ${totalToUpdate}`)
      }
      
      console.log(`\n✅ Нормализация завершена! Обновлено записей: ${updated}`)
    } else {
      console.log('✅ Все статусы уже нормализованы!')
    }
    
    // Показываем статистику по статусам после нормализации
    console.log('\n=== Статистика по статусам после нормализации ===')
    const stats = new Map<string, number>()
    
    const allFinancesAfter = await prisma.finance.findMany({
      select: { status: true }
    })
    
    allFinancesAfter.forEach(finance => {
      const status = finance.status || 'Без статуса'
      stats.set(status, (stats.get(status) || 0) + 1)
    })
    
    const sortedStats = Array.from(stats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
    
    console.log('\nТоп-10 статусов:')
    sortedStats.forEach(([status, count], i) => {
      console.log(`${i + 1}. "${status}": ${count} записей`)
    })
    
  } catch (error) {
    console.error('Ошибка при нормализации статусов:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()

