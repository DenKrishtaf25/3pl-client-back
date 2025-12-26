import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkDuplicates() {
  try {
    const total = await prisma.order.count()
    console.log(`Всего записей в таблице order: ${total}`)
    
    // Проверяем дубликаты по ключу (branch, orderType, orderNumber, clientTIN)
    const duplicates = await prisma.$queryRaw<Array<{
      branch: string
      order_type: string
      order_number: string
      client_tin: string
      count: bigint
    }>>`
      SELECT branch, order_type, order_number, client_tin, COUNT(*) as count
      FROM "order"
      GROUP BY branch, order_type, order_number, client_tin
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `
    
    console.log(`\nНайдено ${duplicates.length} групп дубликатов (показываем первые 20):`)
    duplicates.forEach((dup, i) => {
      console.log(`${i + 1}. branch="${dup.branch}", orderType="${dup.order_type}", orderNumber="${dup.order_number}", clientTIN="${dup.client_tin}" - ${dup.count} записей`)
    })
    
    // Проверяем записи с нужным КИС номером
    const kisOrders = await prisma.order.findMany({
      where: {
        OR: [
          { kisNumber: { contains: 'ЮБА0502021_20230502' } },
          { kisNumber: { contains: 'ЮБА0502021_2023050244' } },
        ]
      },
      select: {
        id: true,
        branch: true,
        orderType: true,
        orderNumber: true,
        clientTIN: true,
        kisNumber: true,
        createdAt: true,
      },
      take: 10
    })
    
    console.log(`\nНайдено ${kisOrders.length} записей с КИС номером, содержащим "ЮБА0502021_20230502":`)
    kisOrders.forEach((order, i) => {
      console.log(`${i + 1}. ID=${order.id}, branch="${order.branch}", orderType="${order.orderType}", orderNumber="${order.orderNumber}", clientTIN="${order.clientTIN}", kisNumber="${order.kisNumber}", createdAt=${order.createdAt}`)
    })
    
    // Проверяем общее количество дубликатов
    const totalDuplicates = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT SUM(count - 1) as total
      FROM (
        SELECT COUNT(*) as count
        FROM "order"
        GROUP BY branch, order_type, order_number, client_tin
        HAVING COUNT(*) > 1
      ) as duplicates
    `
    
    console.log(`\nВсего дубликатов (записей сверх первой): ${totalDuplicates[0]?.total || 0}`)
    
  } catch (error) {
    console.error('Ошибка:', error)
    throw error
  }
}

checkDuplicates()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

