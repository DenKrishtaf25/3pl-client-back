import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import * as cookieParser from 'cookie-parser'
import { AppModule } from './app.module'

async function bootstrap() {
	const app = await NestFactory.create(AppModule)
	const configService = app.get(ConfigService)
	
	// Настраиваем Express для поддержки длинных URL (до 100KB для query строки)
	const expressApp = app.getHttpAdapter().getInstance()
	expressApp.set('query parser', 'extended')
	expressApp.set('query parser fn', (str: string) => {
		const qs = require('qs')
		return qs.parse(str, { 
			allowPrototypes: true,
			arrayLimit: Infinity,
			parameterLimit: 100000 
		})
	})

	// Поддержка нескольких origins через запятую или одного origin
	const frontendUrls = configService.get<string>('FRONTEND_URL', 'http://localhost:3000')
	const allowedOrigins = frontendUrls.split(',').map(url => url.trim())
	
	console.log('=== CORS Configuration ===')
	console.log('FRONTEND_URL from env:', configService.get<string>('FRONTEND_URL'))
	console.log('Allowed CORS origins:', allowedOrigins)
	console.log('========================')
	
	// Настраиваем CORS ПЕРЕД другими middleware
	app.enableCors({
		origin: (origin, callback) => {
			// Разрешаем запросы без origin (например, Postman, мобильные приложения)
			if (!origin) {
				console.log('CORS: Request without origin allowed')
				return callback(null, true)
			}
			
			// Проверяем, есть ли origin в списке разрешенных
			if (allowedOrigins.includes(origin)) {
				console.log('CORS: Origin allowed:', origin)
				return callback(null, true)
			}
			
			// Логируем отклоненные origins для отладки
			console.log('CORS: BLOCKED origin:', origin)
			console.log('CORS: Allowed origins:', allowedOrigins)
			
			return callback(new Error('Not allowed by CORS'))
		},
		credentials: true,
		exposedHeaders: ['set-cookie'],
		methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
		allowedHeaders: [
			'Content-Type',
			'Authorization',
			'Accept',
			'Origin',
			'X-Requested-With',
			'Access-Control-Request-Method',
			'Access-Control-Request-Headers'
		],
		preflightContinue: false,
		optionsSuccessStatus: 204
	})

	app.setGlobalPrefix('api')
	app.use(cookieParser())

	const port = configService.get<number>('PORT', 4200)
	console.log(`Server starting on port ${port}`)
	console.log(`CORS configured for: ${allowedOrigins.join(', ')}`)
	await app.listen(port)
}
bootstrap()
