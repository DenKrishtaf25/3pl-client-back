import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function removeDuplicates() {
  try {
    const checkOnly = process.argv.includes('--check')
    
    if (checkOnly) {
      console.log('Проверка дубликатов в таблице order...\n')
      
      // Показываем статистику
      const total = await prisma.order.count()
      console.log(`Всего записей в таблице order: ${total}`)
      
      const totalDuplicates = await prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT SUM(count - 1) as total
        FROM (
          SELECT COUNT(*) as count
          FROM "order"
          GROUP BY TRIM(branch), TRIM(order_type), TRIM(order_number), TRIM(client_tin)
          HAVING COUNT(*) > 1
        ) as duplicates
      `
      
      const duplicatesCount = Number(totalDuplicates[0]?.total || 0)
      console.log(`Записей для удаления (дубликаты): ${duplicatesCount}`)
      console.log(`Записей останется: ${total - duplicatesCount}`)
      
      return
    }
    
    console.log('Начинаем удаление дубликатов...\n')
    
    // Шаг 1: Находим все группы дубликатов
    console.log('Шаг 1: Поиск групп дубликатов...')
    const duplicateGroups = await prisma.$queryRaw<Array<{
      branch: string
      order_type: string
      order_number: string
      client_tin: string
      count: bigint
    }>>`
      SELECT 
        TRIM(branch) as branch,
        TRIM(order_type) as order_type,
        TRIM(order_number) as order_number,
        TRIM(client_tin) as client_tin,
        COUNT(*) as count
      FROM "order"
      GROUP BY TRIM(branch), TRIM(order_type), TRIM(order_number), TRIM(client_tin)
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `
    
    console.log(`Найдено ${duplicateGroups.length} групп дубликатов\n`)
    
    // Шаг 2: Для каждой группы находим ID записей, которые нужно удалить (оставляем самую новую)
    console.log('Шаг 2: Определение записей для удаления...')
    let totalToDelete = 0
    const idsToDelete: string[] = []
    const batchSize = 1000
    let processedGroups = 0
    
    for (const group of duplicateGroups) {
      processedGroups++
      if (processedGroups % 100 === 0) {
        console.log(`Обработано групп: ${processedGroups}/${duplicateGroups.length}, собрано для удаления: ${idsToDelete.length}`)
      }
      
      // Находим все записи этой группы, отсортированные по updatedAt (самая новая первая)
      const orders = await prisma.$queryRaw<Array<{
        id: string
        updated_at: Date
      }>>`
        SELECT id, updated_at
        FROM "order"
        WHERE TRIM(branch) = ${group.branch}
          AND TRIM(order_type) = ${group.order_type}
          AND TRIM(order_number) = ${group.order_number}
          AND TRIM(client_tin) = ${group.client_tin}
        ORDER BY updated_at DESC, created_at DESC
      `
      
      // Оставляем первую (самую новую), остальные добавляем в список на удаление
      if (orders.length > 1) {
        const toDelete = orders.slice(1).map(o => o.id)
        idsToDelete.push(...toDelete)
        totalToDelete += toDelete.length
        
        // Удаляем батчами для экономии памяти
        if (idsToDelete.length >= batchSize) {
          console.log(`Удаляем батч из ${idsToDelete.length} записей...`)
          const result = await prisma.order.deleteMany({
            where: { id: { in: idsToDelete } }
          })
          console.log(`Удалено ${result.count} записей (всего удалено: ${totalToDelete - idsToDelete.length + result.count})`)
          idsToDelete.length = 0
        }
      }
    }
    
    console.log(`\nОбработано всех групп: ${processedGroups}`)
    console.log(`Всего записей собрано для удаления: ${totalToDelete}`)
    
    // Удаляем оставшиеся записи
    if (idsToDelete.length > 0) {
      console.log(`Удаляем финальный батч из ${idsToDelete.length} записей...`)
      await prisma.order.deleteMany({
        where: { id: { in: idsToDelete } }
      })
      console.log(`Удалено ${idsToDelete.length} записей`)
    }
    
    console.log(`\n✅ Удаление завершено!`)
    console.log(`Всего удалено дубликатов: ${totalToDelete}`)
    
    // Проверяем результат
    const remaining = await prisma.order.count()
    console.log(`Записей осталось: ${remaining}`)
    
    // Проверяем, остались ли дубликаты
    const remainingDuplicates = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM (
        SELECT COUNT(*) as cnt
        FROM "order"
        GROUP BY TRIM(branch), TRIM(order_type), TRIM(order_number), TRIM(client_tin)
        HAVING COUNT(*) > 1
      ) as duplicates
    `
    
    const duplicatesCount = Number(remainingDuplicates[0]?.count || 0)
    if (duplicatesCount > 0) {
      console.log(`⚠️  Внимание: осталось ${duplicatesCount} групп дубликатов`)
    } else {
      console.log(`✅ Дубликаты полностью удалены!`)
    }
    
  } catch (error) {
    console.error('Ошибка при удалении дубликатов:', error)
    throw error
  }
}

removeDuplicates()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

