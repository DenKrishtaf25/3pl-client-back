import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

async function checkTable(tableLabel: string, tableSql: 'orders_save' | 'orders_online') {
  const total =
    tableSql === 'orders_save' ? await prisma.orderSave.count() : await prisma.orderOnline.count()
  console.log(`\n--- ${tableLabel} (${tableSql}): всего записей ${total} ---`)

  const duplicates = await prisma.$queryRaw<
    Array<{
      branch: string
      order_type: string
      order_number: string
      client_tin: string
      count: bigint
    }>
  >`
      SELECT branch, order_type, order_number, client_tin, COUNT(*) as count
      FROM ${Prisma.raw(`"${tableSql}"`)}
      GROUP BY branch, order_type, order_number, client_tin
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `

  console.log(`Групп дубликатов (первые 20): ${duplicates.length}`)
  duplicates.forEach((dup, i) => {
    console.log(
      `${i + 1}. branch="${dup.branch}", orderType="${dup.order_type}", orderNumber="${dup.order_number}", clientTIN="${dup.client_tin}" — ${dup.count} записей`,
    )
  })

  const totalDuplicates = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT SUM(count - 1) as total
      FROM (
        SELECT COUNT(*) as count
        FROM ${Prisma.raw(`"${tableSql}"`)}
        GROUP BY branch, order_type, order_number, client_tin
        HAVING COUNT(*) > 1
      ) as duplicates
    `
  console.log(`Дубликатов сверх первой записи в группе: ${totalDuplicates[0]?.total || 0}`)
}

async function checkDuplicates() {
  try {
    console.log('Проверка дубликатов в orders_save и orders_online')

    await checkTable('Архив', 'orders_save')
    await checkTable('Онлайн', 'orders_online')

    const kisOrdersSave = await prisma.orderSave.findMany({
      where: {
        OR: [
          { kisNumber: { contains: 'ЮБА0502021_20230502' } },
          { kisNumber: { contains: 'ЮБА0502021_2023050244' } },
        ],
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
      take: 10,
    })

    const kisOrdersOnline = await prisma.orderOnline.findMany({
      where: {
        OR: [
          { kisNumber: { contains: 'ЮБА0502021_20230502' } },
          { kisNumber: { contains: 'ЮБА0502021_2023050244' } },
        ],
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
      take: 10,
    })

    const kisOrders = [...kisOrdersSave, ...kisOrdersOnline]

    console.log(`\nНайдено ${kisOrders.length} записей с КИС, содержащим шаблон (обе таблицы, до 10+10):`)
    kisOrders.forEach((order, i) => {
      console.log(
        `${i + 1}. ID=${order.id}, branch="${order.branch}", orderType="${order.orderType}", orderNumber="${order.orderNumber}", clientTIN="${order.clientTIN}", kisNumber="${order.kisNumber}", createdAt=${order.createdAt}`,
      )
    })
  } catch (error) {
    console.error('Ошибка:', error)
    throw error
  }
}

checkDuplicates()
  .then(() => prisma.$disconnect())
  .catch(async e => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
