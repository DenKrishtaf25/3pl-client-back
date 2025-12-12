import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    console.log('Проверяем наличие полей completionDate и closingDate в таблице finance...\n')
    
    // Проверяем структуру таблицы через запрос
    const sample = await prisma.finance.findFirst({
      select: {
        id: true,
        completionDate: true,
        closingDate: true,
        date: true,
        orderNumber: true,
      }
    })
    
    if (!sample) {
      console.log('В таблице finance нет записей')
      return
    }
    
    console.log('Пример записи:')
    console.log(JSON.stringify(sample, null, 2))
    console.log('\n')
    
    // Проверяем количество записей с заполненными датами
    const withCompletionDate = await prisma.finance.count({
      where: {
        completionDate: { not: null }
      }
    })
    
    const withClosingDate = await prisma.finance.count({
      where: {
        closingDate: { not: null }
      }
    })
    
    const total = await prisma.finance.count()
    
    console.log(`Всего записей: ${total}`)
    console.log(`С датой завершения (completionDate): ${withCompletionDate}`)
    console.log(`С датой закрытия (closingDate): ${withClosingDate}`)
    
    // Показываем несколько примеров с заполненными датами
    if (withCompletionDate > 0) {
      console.log('\nПримеры записей с completionDate:')
      const examples = await prisma.finance.findMany({
        where: { completionDate: { not: null } },
        select: {
          id: true,
          orderNumber: true,
          date: true,
          completionDate: true,
          closingDate: true,
        },
        take: 5
      })
      examples.forEach(ex => {
        console.log(`  ID: ${ex.id}, Заказ: ${ex.orderNumber}, Дата: ${ex.date}, Завершения: ${ex.completionDate}, Закрытия: ${ex.closingDate}`)
      })
    }
    
    if (withClosingDate > 0) {
      console.log('\nПримеры записей с closingDate:')
      const examples = await prisma.finance.findMany({
        where: { closingDate: { not: null } },
        select: {
          id: true,
          orderNumber: true,
          date: true,
          completionDate: true,
          closingDate: true,
        },
        take: 5
      })
      examples.forEach(ex => {
        console.log(`  ID: ${ex.id}, Заказ: ${ex.orderNumber}, Дата: ${ex.date}, Завершения: ${ex.completionDate}, Закрытия: ${ex.closingDate}`)
      })
    }
    
  } catch (error) {
    console.error('Ошибка:', error)
    if (error instanceof Error) {
      if (error.message.includes('completionDate') || error.message.includes('closingDate')) {
        console.error('\n⚠️  ВНИМАНИЕ: Поля completionDate или closingDate не найдены в базе данных!')
        console.error('Нужно выполнить миграцию:')
        console.error('  npx prisma generate')
        console.error('  npx prisma migrate dev --name add_completion_and_closing_dates_to_finance')
      }
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

