import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    console.log('Проверка дубликатов в таблице stock...\n')
    
    // Подсчитываем общее количество записей
    const totalCount = await prisma.stock.count()
    console.log(`Всего записей в таблице stock: ${totalCount}`)

    // Находим дубликаты по комбинации полей
    const duplicates = await prisma.$queryRaw<Array<{
      warehouse: string
      nomenclature: string
      article: string
      client_tin: string
      count: bigint
    }>>`
      SELECT warehouse, nomenclature, article, client_tin, COUNT(*) as count
      FROM stock
      GROUP BY warehouse, nomenclature, article, client_tin
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `

    if (duplicates.length === 0) {
      console.log('\n✅ Дубликатов не найдено!')
      return
    }

    console.log(`\n⚠️  Найдено ${duplicates.length} групп дубликатов:\n`)

    let totalDuplicates = 0
    duplicates.forEach((dup, index) => {
      const count = Number(dup.count)
      totalDuplicates += (count - 1) // Минус одна запись, которую оставим
      console.log(`${index + 1}. ${dup.warehouse} | ${dup.nomenclature} | ${dup.article} | ${dup.client_tin}`)
      console.log(`   Дубликатов: ${count} (нужно удалить ${count - 1})`)
    })

    console.log(`\n📊 Статистика:`)
    console.log(`   Всего записей: ${totalCount}`)
    console.log(`   Групп с дубликатами: ${duplicates.length}`)
    console.log(`   Записей для удаления: ${totalDuplicates}`)
    console.log(`   Записей останется: ${totalCount - totalDuplicates}`)

    // Спрашиваем, удалять ли дубликаты
    console.log(`\n⚠️  Для удаления дубликатов запустите скрипт с флагом --delete`)
  } catch (error) {
    console.error('Ошибка при проверке дубликатов:', error)
    throw error
  }
}

// Проверяем аргументы командной строки
const shouldDelete = process.argv.includes('--delete')

if (shouldDelete) {
  // Удаляем дубликаты
  async function deleteDuplicates() {
    try {
      const duplicates = await prisma.$queryRaw<Array<{
        warehouse: string
        nomenclature: string
        article: string
        client_tin: string
        count: bigint
      }>>`
        SELECT warehouse, nomenclature, article, client_tin, COUNT(*) as count
        FROM stock
        GROUP BY warehouse, nomenclature, article, client_tin
        HAVING COUNT(*) > 1
      `

      let totalDeleted = 0

      for (const dup of duplicates) {
        const records = await prisma.stock.findMany({
          where: {
            warehouse: dup.warehouse,
            nomenclature: dup.nomenclature,
            article: dup.article,
            clientTIN: dup.client_tin,
          },
          orderBy: {
            createdAt: 'desc', // Оставляем самую новую запись
          }
        })

        if (records.length > 1) {
          const idsToDelete = records.slice(1).map(r => r.id)
          const deleted = await prisma.stock.deleteMany({
            where: {
              id: {
                in: idsToDelete,
              }
            }
          })
          totalDeleted += deleted.count
        }
      }

      console.log(`\n✅ Удалено ${totalDeleted} дубликатов`)
    } catch (error) {
      console.error('Ошибка при удалении дубликатов:', error)
      throw error
    }
  }

  main()
    .then(() => deleteDuplicates())
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e)
      await prisma.$disconnect()
      process.exit(1)
    })
} else {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e)
      await prisma.$disconnect()
      process.exit(1)
    })
}

